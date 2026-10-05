import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createResearchGraph, researchStages } from "./graph.js";
import { demoProvider, liveProvider, DEMO_QUESTION } from "./providers.js";
import { memoryStore } from "./store.js";
import { documentRouter, createEmbeddings, withDocumentRetrieval } from './documents.js';
import { EMBEDDING_MODEL } from './document-store.js';
import { verificationAppendix } from './verification.js';
import { authRouter, sessionToken } from './auth.js';

const inputSchema = z.object({
  question: z.string().trim().min(10).max(2000),
  depth: z.enum(["quick", "deep"]).default("quick"),
  mode: z.enum(["demo", "live"]),
  documentIds: z.array(z.uuid()).max(5).default([]),
  includeWeb: z.boolean().default(true),
});
export function createApp({
  env = process.env,
  providerFactory,
  demoDelay = 700,
  store = memoryStore(),
  embeddings,
  extract,
  sendMail,
} = {}) {
  const app = express();
  let activeRuns = 0;
  const configured = Boolean(env.OPENAI_API_KEY && env.TAVILY_API_KEY);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  // Reject cross-origin mutations, including requests to localhost from other sites.
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (
      req.method !== "GET" &&
      origin &&
      ![
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        `http://127.0.0.1:${env.PORT || 3001}`,
        `http://localhost:${env.PORT || 3001}`,
        "https://deepresearchbackend-production.up.railway.app",
      ].includes(origin)
    )
      return res.status(403).json({ error: "Origin not allowed." });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (req, res) => {
    await store.health();
    res.json({
      status: "ok",
      authEnabled: Boolean(store.auth),
      liveConfigured: configured,
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      tracing:
        env.LANGSMITH_TRACING === "true" && Boolean(env.LANGSMITH_API_KEY),
      storage: store.kind,
      documentsConfigured: Boolean(store.listDocuments && env.OPENAI_API_KEY),
      embeddingModel: EMBEDDING_MODEL,
      demoQuestion: DEMO_QUESTION,
    });
  });
  if (store.auth) {
    app.use('/api/auth', authRouter({ auth: store.auth, env, sendMail }));
    app.use('/api', async (req, res, next) => {
      try {
        const user = await store.auth.sessionUser(sessionToken(req));
        if (!user) return res.status(401).json({ error: 'Login required.' });
        req.user = user;
        req.dataStore = store.forUser(user.id);
        next();
      } catch (error) { next(error); }
    });
  } else app.use('/api', (req, res, next) => { req.dataStore = store; next(); });
  app.use('/api/documents', documentRouter({ store, env, embeddings, extract }));
  app.get("/api/research", async (req, res) => res.json(await req.dataStore.list()));
  app.get('/api/research/:id/export', async (req, res) => {
    const run = await req.dataStore.get(req.params.id);
    if (!run?.report) return res.status(404).json({error:'Report not found.'});
    if (run.status === 'running') return res.status(409).json({error:'Wait for the evidence check to finish before exporting.'});
    res.type('text/markdown').send(run.report + (run.verification ? verificationAppendix(run.verification) : '\n\nEvidence check: not available for this report.'));
  });
  app.get("/api/research/:id", async (req, res) => {
    const run = await req.dataStore.get(req.params.id);
    return run
      ? res.json(run)
      : res.status(404).json({ error: "Research not found." });
  });
  app.post("/api/research", async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error:
            "Enter a question of 10–2,000 characters and a valid research mode and depth.",
        });
    const { question, depth, mode, includeWeb } = parsed.data;
    if (req.user?.demo && mode !== 'demo') return res.status(403).json({ error: 'The demo account can only run sample research.' });
    const documentIds = [...new Set(parsed.data.documentIds)];
    if (mode === 'demo' && (documentIds.length || !includeWeb)) return res.status(400).json({ error: 'Document research requires live mode. Demo uses fixed sample sources.' });
    if (!includeWeb && !documentIds.length) return res.status(400).json({ error: 'Select at least one document or enable web search.' });
    if (mode === "live" && (!env.OPENAI_API_KEY || (includeWeb && !env.TAVILY_API_KEY)))
      return res
        .status(503)
        .json({
          error:
            "Configure OpenAI for live research and Tavily when web search is enabled, then restart the API.",
        });
    if (documentIds.length) {
      if (!req.dataStore.getDocument) return res.status(503).json({ error: 'Document research requires PostgreSQL.' });
      const documents = await Promise.all(documentIds.map(id => req.dataStore.getDocument(id)));
      if (documents.some(doc => !doc || doc.status !== 'ready' || doc.embeddingModel !== EMBEDDING_MODEL)) return res.status(400).json({ error: 'Every selected document must finish indexing before research starts.' });
    }
    if (activeRuns >= 2)
      return res
        .status(429)
        .json({
          error:
            "Two research runs are already active. Wait for one to finish.",
        });
    activeRuns++;
    const run = {
      id: randomUUID(),
      question: mode === "demo" ? DEMO_QUESTION : question,
      depth,
      mode,
      documentIds,
      includeWeb,
      status: "running",
      createdAt: new Date().toISOString(),
      steps: researchStages({ documentIds, includeWeb, mode }).map((id) => ({ id, status: "pending" })),
      sources: [],
      report: "",
    };
    try {
      await req.dataStore.save(run);
    } catch {
      activeRuns--;
      return res
        .status(503)
        .json({
          error:
            "Database unavailable. Research was not started. Please try again.",
        });
    }
    res.status(202).json(run);
    void (async () => {
      try {
        let provider = providerFactory
          ? providerFactory(mode)
          : mode === "demo"
            ? demoProvider(demoDelay)
            : liveProvider(env);
        if (documentIds.length) provider = withDocumentRetrieval(provider, req.dataStore, embeddings || createEmbeddings(env));
        const graph = createResearchGraph(
          provider,
          async (id, status, result) => {
            run.steps.find((step) => step.id === id).status = status;
            if (result) Object.assign(run, result);
            await req.dataStore.save(run);
          },
          run.steps.map(step => step.id),
        );
        await graph.invoke(
          { question: run.question, depth, documentIds, includeWeb },
          {
            runName: "deep-research",
            metadata: { researchId: run.id, mode },
            ...(mode === "demo" ? { callbacks: [] } : {}),
          },
        );
        run.status = "complete";
      } catch (error) {
        run.status = "failed";
        const active = run.steps.find((step) => step.status === "running");
        if (active) active.status = "failed";
        // Provider error bodies may include sensitive data; expose only safe guidance.
        run.error =
          mode === "live"
            ? "Research could not finish. Check provider keys, model access, quotas, and connectivity, then try again."
            : "The demo could not finish. Please try again.";
        console.error("Research failed:", error.name, error.status || "");
      } finally {
        run.finishedAt = new Date().toISOString();
        try {
          await req.dataStore.save(run);
        } catch {
          console.error("Could not persist final research status.");
        }
        activeRuns--;
      }
    })();
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use((err, req, res, next) =>
    res
      .status(err.status || 503)
      .json({
        error:
          err.type === "entity.too.large"
            ? "Request is too large."
            : err.status
              ? "Invalid request."
              : "Storage unavailable. Check that PostgreSQL is running and try again.",
      }),
  );
  return app;
}
