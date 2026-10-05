# Deep Research

A local AI research workspace built with React, JavaScript, Vite, Tailwind CSS, a shadcn-style Radix Button, Express, LangChain, and LangGraph.

## Run locally

Requires Node.js 22 or later and npm.

```powershell
npm install
npm run db:setup
npm run db:up
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on **http://127.0.0.1:3001**. Demo mode works without credentials and runs a fixed, clearly labeled example. Typing a question does not change that sample; select Live research to research your own question.

## PostgreSQL in Docker

Start Docker Desktop before running `npm run db:up`. The Compose service runs PostgreSQL 17 with pgvector on **127.0.0.1:5433**. `npm run db:setup` generates a random database password in the ignored root `.env` and adds `DATABASE_URL` to `backend/.env`, preserving existing provider keys. These files contain credentials; keep them private.

Research questions, progress, plans, sources, analysis, and reports are saved in the `research_runs` table. Uploaded document metadata is stored in `documents`; extracted passages and pgvector embeddings are in `document_chunks`. The database schema is created idempotently at API startup. Existing local history exported to the ignored `backend/data/history-import.json` is imported once per ID without overwriting newer records.

The named volume `deepresearch_postgres_data` keeps the database across container restarts and recreation. Use `npm run db:stop` to stop it and `npm run db:up` to start it again. **Do not run `docker compose down -v` unless you intend to delete the database volume.** A Docker volume provides persistence, not an independent backup.

Run `npm run test:db` to verify storage and restart recovery against a separate, temporary test database. This uses the local database administrator configured by Compose and never deletes workspace research. Offline tests use an in-memory store. With no `DATABASE_URL`, the app also supports temporary memory mode; with a configured but unavailable database, it fails startup instead of silently falling back to memory.

## Enable live research

```powershell
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Edit `backend/.env` and set `OPENAI_API_KEY` and `TAVILY_API_KEY`, then restart `npm run dev`. You can set `OPENAI_MODEL` to a model available to your account. The default is `gpt-4.1-mini`. Keys are server-only and ignored by Git. Never put keys in frontend variables or commit credential files.

Live runs consume your provider accounts' API quotas. Quick exploration uses one search query; deeper exploration uses up to three queries with advanced search. Each query requests up to five sources. The workflow makes four core model calls (planning, analysis, evidence review, report writing), then checks the final report in batches of up to five passages per model call, with at most twelve audit calls. Model retries can add usage.

For optional LangSmith tracing, set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, and `LANGSMITH_PROJECT`. Tracing can include questions, source excerpts, and report content. LangChain propagates traces through the graph. No custom evaluation dataset or automated quality evaluation is included yet.

## What works

- Responsive dashboard, suggested questions, light/dark appearance on desktop, and client-side navigation.
- Demo and live research modes; demo is explicit and never presented as researched evidence.
- LangGraph workflow: plan → search → analyze → review → write.
- Progress polling while each stage runs, research focus and queries, source links, Markdown report viewing and export.
- PostgreSQL research history, search, input validation, run limits, and failure states.
- PDF, TXT, and Markdown uploads; persistent document indexing; document-only or combined web/document research; source passage previews.
- Optional LangSmith tracing through LangChain integrations.
- Final report citation checks and structured evidence assessments, with quoted support and warnings included in Markdown exports.

## Citation validation and evidence checks

New live research runs finish with a **Final evidence check** stage. The **Evidence check** tab shows supported, uncertain, unsupported, non-factual, and unchecked report passages. The report remains readable if the audit provider fails, but the check is explicitly marked unavailable. Exports wait for processing to finish and include the check results; older reports are labeled as not checked.

Deterministic checks identify nonexistent source numbers, unrecognized bracket markers, and prose passages without numeric citations. Uncited passages may include recommendations or other non-factual text, so this is a review signal rather than an accuracy score. Numeric markers such as `[1]` and `[1, 2]` are recognized. The generated source list is excluded from the audit.

The model assesses up to **60 prose passages** (paragraphs, bullets, and table rows) against only the excerpts actually cited by each passage. Headings and fenced code are excluded. Every factual claim within a passage must be supported for the whole passage to receive a supported verdict. Supplied evidence quotations must match the cited source after whitespace/Unicode normalization. Invented quotes, absent sources, or missing citations prevent a supported verdict. Missing or duplicate assessments and passages beyond the limit are marked unchecked; failures never silently produce a clean result.

The final report text is preserved rather than silently rewritten. The audit stores a hash of its report body, source numbers, evidence quotes, coverage, and explanations in the research record. This is **model-assisted source-excerpt checking**, not independent fact-checking: a quote match proves provenance, not truth or entailment. The model may still misclassify claims. No additional sources or full web pages are fetched by this stage.

The evidence-review stage compares claims against Tavily source excerpts and retrieved document passages. It is **not independent fact-checking**, does not fetch full source pages, and cannot guarantee citation correctness or factual accuracy. Review important claims at their original sources. Retrieved material, including filenames and uploaded text, is treated as untrusted content in model prompts.

## Document research (RAG)

1. Select **Live research** on the dashboard.
2. Click **Upload file** and choose a `.pdf`, `.txt`, or `.md` file. Wait for indexing to finish.
3. Select up to five ready documents. Open **Preview** to inspect their extracted passages.
4. Keep **Include web search** checked for combined research, or uncheck it to use selected documents only. Document-only research needs OpenAI and PostgreSQL but does not need Tavily.
5. Ask a question and start research. The **Document retrieval** stage selects relevant passages. In the report's Sources panel, expand document references to read the exact passages supplied to the model.

Try the clearly fictional `samples/juniper-pilot.md` file. Ask who owns the pilot and what the retention periods are.

Uploads are limited to **5 MB**, **100 PDF pages**, **200,000 extracted characters**, and **160 passages**. Text files must be UTF-8. PDFs need selectable text; scanned PDFs require external OCR. Password-protected PDFs, DOCX, images, and other formats are not supported. PDF parsing runs in a worker with a 30-second timeout and a bounded JavaScript heap. Only one upload/indexing job runs at a time.

Text is split into approximately 1,800-character passages with 200-character overlap, preserving PDF page numbers. OpenAI `text-embedding-3-small` creates 1,536-dimensional embeddings. PostgreSQL performs exact cosine similarity search within **only the selected documents**, taking up to two passages per file for quick exploration and three for deeper exploration. Similarity ranks passages; it does not establish relevance or truth. Retrieval covers excerpts, not a guaranteed exhaustive reading of every page. The embedding model/dimensions are fixed in code to keep stored and query vectors compatible.

**Data and usage:** extracted text is sent to OpenAI for embedding, and retrieved passages are sent for report analysis. Upload indexing and query embeddings incur API usage in addition to the research model calls. Exact duplicate ready files reuse the existing index. Original file bytes are discarded after extraction; metadata, extracted text, and embeddings persist in PostgreSQL. Reports retain their retrieved passages for later inspection. Interrupted indexing is marked failed after an API restart; upload the file again to retry. Document deletion and automatic resumption are not included in this milestone.

## Project structure

```text
frontend/src/App.jsx             Screens and research interactions
frontend/src/styles.css          Responsive design and themes
frontend/src/components/ui/      Reusable UI components
backend/src/app.js              API and session storage
backend/src/store.js            PostgreSQL storage and restart recovery
compose.yaml                    PostgreSQL + pgvector and persistent volume
backend/src/graph.js            LangGraph state and stages
backend/src/providers.js        OpenAI/Tavily and demo adapters
backend/src/documents.js        Upload validation, chunking, indexing, retrieval
backend/src/document-store.js   Document tables and pgvector queries
backend/src/pdf-worker.js       Bounded PDF text extraction
backend/src/verification.js     Citation checks and grounded evidence assessments
backend/test/research.test.js   Workflow and API tests
```

## Checks and production preview

```powershell
npm run check
npm run build
npm start
```

After building, `npm start` serves the API and frontend at http://127.0.0.1:3001. `npm run check` runs offline backend tests and the frontend build. It does not call paid providers.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Public configuration flags; no API keys |
| `POST /api/research` | Start a run with `{ question, mode: "demo" or "live", depth: "quick" or "deep", includeWeb: true, documentIds: [] }` |
| `GET /api/research` | Saved research history |
| `GET /api/research/:id` | Progress, plan, source excerpts, and report |
| `GET /api/research/:id/export` | Markdown report with evidence-check findings; rejects exports while research is running |
| `POST /api/documents` | Upload one multipart `file`; returns 202 while indexing, or 200 for an existing ready duplicate |
| `GET /api/documents` | Document metadata and processing/ready/failed status |
| `GET /api/documents/:id/passages` | Metadata and extracted passages, without embeddings |

## Current boundaries and next milestones

This is a **single-user local application**, not a public hosted service. Run one API process per database. It listens on loopback by default, has no authentication, and allows two active runs. PostgreSQL history persists across restarts; memory-mode history does not. Interrupted runs cannot resume and are marked failed on the next startup, keeping their completed stages. Avoid restarting the development server during a run. History is currently returned as a full list; server-side pagination remains future work.

Next: background execution and cancellation; broader independent verification and full-page evidence retrieval; LangSmith evaluations; authentication and per-user quotas before deployment; application containerization and deployment configuration.

## Integration references

- [Official OpenAI API documentation](https://developers.openai.com/api/reference/overview)
- [LangChain ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai)
- [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- [pgvector](https://github.com/pgvector/pgvector)
