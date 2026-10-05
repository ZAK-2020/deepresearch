import { useEffect, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  FileText,
  Globe2,
  History,
  Layers3,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Telescope,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import DocumentLibrary, { ResearchSource } from '@/components/DocumentLibrary';
import EvidenceCheck, { evidenceLabel } from '@/components/EvidenceCheck';

const DEMO = "How can AI support a more effective research workflow?";
const stepInfo = {
  plan: [
    "Research plan",
    "Breaking the question into focused lines of inquiry",
    Compass,
  ],
  search: [
    "Source discovery",
    "Finding relevant evidence across the web",
    Globe2,
  ],
  documents: ['Document retrieval', 'Finding relevant passages in your selected files', FileText],
  analyze: [
    "Information analysis",
    "Connecting findings and comparing perspectives",
    Layers3,
  ],
  review: [
    "Evidence review",
    "Examining support, contradictions, and uncertainty",
    ShieldCheck,
  ],
  write: [
    "Report writing",
    "Bringing the findings into a readable report",
    FileText,
  ],
  verify: ['Final evidence check', 'Checking report citations and support in cited excerpts', ShieldCheck],
};
async function api(path, options) {
  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
function useHealth() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let active = true;
    api("/health")
      .then((data) => active && setHealth(data))
      .catch(() => active && setHealth({ offline: true }));
    return () => {
      active = false;
    };
  }, []);
  return health;
}
function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Status({ status }) {
  return (
    <Badge
      tone={
        status === "complete" ? "green" : status === "failed" ? "red" : "amber"
      }
    >
      {status === "complete" ? (
        <Check size={12} />
      ) : status === "running" ? (
        <LoaderCircle size={12} className="spin" />
      ) : (
        <XCircle size={12} />
      )}
      {status === "complete"
        ? "Completed"
        : status === "running"
          ? "In progress"
          : "Failed"}
    </Badge>
  );
}
const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export default function App() {
  const health = useHealth();
  const [theme, setTheme] = useState(
    () => localStorage.getItem("research-theme") || "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("research-theme", theme);
  }, [theme]);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <Telescope size={22} />
          </span>
          <span>
            deep<span className="brand-light">research</span>
            <small>A LITTLE CURIOSITY. MORE CLARITY.</small>
          </span>
        </NavLink>
        <Button asChild className="new-research">
          <NavLink to="/">
            <Plus size={17} /> New research
          </NavLink>
        </Button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <Compass size={18} /> Overview
          </NavLink>
          <NavLink to="/history">
            <History size={18} /> Research history
          </NavLink>
          <NavLink to="/settings">
            <Settings2 size={18} /> Settings
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="small-icon">
            <Sparkles size={17} />
          </span>
          <h3>Go beyond the first answer.</h3>
          <p>
            Explore different perspectives. Follow the evidence. Find the bigger
            picture.
          </p>
          <NavLink to="/guide">
            How it works <ArrowUpRight size={14} />
          </NavLink>
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/guide">
            <CircleHelp size={17} /> Research guide
          </NavLink>
          <button
            className="theme-button"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            {theme === "light" ? "Dark appearance" : "Light appearance"}
          </button>
          <div className="profile">
            <span className="avatar">Y</span>
            <div>
              Your workspace<small>Personal · local session</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>Deep Research</span>
          </div>
          <Badge tone={health?.offline ? "red" : "neutral"}>
            <span
              className={`status-dot ${health?.offline ? "offline" : ""}`}
            />
            {!health
              ? "Connecting"
              : health.offline
                ? "API offline"
                : health.liveConfigured
                  ? "Live research ready"
                  : "Demo workspace"}
          </Badge>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard health={health} />} />
            <Route path="/research/:id" element={<Research />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route
              path="/settings"
              element={<SettingsPage health={health} />}
            />
            <Route path="/guide" element={<Guide />} />
            <Route
              path="*"
              element={
                <div className="empty-state">
                  <h1>Page not found</h1>
                  <Button asChild>
                    <NavLink to="/">Back to workspace</NavLink>
                  </Button>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Dashboard({ health }) {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState("demo");
  const [depth, setDepth] = useState("quick");
  const [documentIds, setDocumentIds] = useState([]);
  const [includeWeb, setIncludeWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const run = await api("/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: mode === "demo" ? DEMO : question,
          mode,
          depth,
          documentIds: mode === 'live' ? documentIds : [],
          includeWeb: mode === 'demo' ? true : includeWeb,
        }),
      });
      navigate(`/research/${run.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const prompts = [
    {
      label: "TECHNOLOGY",
      icon: Zap,
      title: "The next chapter of AI",
      question:
        "How is generative AI changing software development, and what are its limitations?",
      className: "lavender",
    },
    {
      label: "BUSINESS",
      icon: Globe2,
      title: "A market in motion",
      question:
        "Compare the electric vehicle strategies of Tesla, BYD, and Volkswagen.",
      className: "peach",
    },
    {
      label: "SUSTAINABILITY",
      icon: Sparkles,
      title: "Ideas for a greener future",
      question:
        "What are the opportunities and barriers for renewable energy adoption in emerging markets?",
      className: "mint",
    },
  ];
  return (
    <div className="page dashboard">
      <div className="page-eyebrow">
        <span /> YOUR RESEARCH, REIMAGINED
      </div>
      <div className="hero">
        <div>
          <h1>
            Follow your curiosity.
            <br />
            <span>Find your clarity.</span>
          </h1>
          <p>
            Turn big questions into well-supported insights.
            <br className="desktop-break" /> Your research journey starts with a
            little curiosity.
          </p>
        </div>
        <div className="orbit-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">
            <Compass size={45} strokeWidth={1.1} />
          </div>
          <span className="orbit-item oi-one">
            <Globe2 size={22} />
          </span>
          <span className="orbit-item oi-two">
            <FileText size={20} />
          </span>
          <span className="orbit-item oi-three">
            <Sparkles size={18} />
          </span>
          <span className="orbit-dot od-one" />
          <span className="orbit-dot od-two" />
        </div>
      </div>
      <form className="question-card" onSubmit={start}>
        <div className="card-top">
          <label htmlFor="question">
            <Sparkles size={18} /> What would you like to explore?
          </label>
          <Badge>AI-powered research</Badge>
        </div>
        <textarea
          id="question"
          aria-describedby="mode-help"
          placeholder="Ask a big question. Explore an idea. Compare perspectives…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
          minLength={mode === "live" ? 10 : undefined}
          required={mode === "live"}
        />
        <div className="question-controls">
          <div className="controls-left">
            <label className="select-wrap">
              <Globe2 size={15} />
              <select
                aria-label="Research mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="demo">Demo mode</option>
                <option value="live">Live research</option>
              </select>
            </label>
            <span className="control-divider" />
            <label className="select-wrap">
              <Layers3 size={15} />
              <select
                aria-label="Research depth"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
              >
                <option value="quick">Quick exploration</option>
                <option value="deep">Deeper exploration</option>
              </select>
            </label>
          </div>
          <Button
            type="submit"
            disabled={
              busy ||
              !health ||
              health.offline ||
              (mode === "live" && (includeWeb ? !health.liveConfigured : !health.documentsConfigured || !documentIds.length))
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}{" "}
            {mode === "demo" ? "Try sample research" : "Start research"}
            <ArrowRight size={16} />
          </Button>
        </div>
        {mode === 'live' && <><div className="web-search-toggle"><label><input type="checkbox" checked={includeWeb} onChange={e => setIncludeWeb(e.target.checked)} disabled={busy}/> Include web search</label><span>{includeWeb ? 'Combine web sources with selected documents.' : 'Use only the selected documents. Select at least one ready file.'}</span></div><DocumentLibrary health={health} selected={documentIds} onSelect={setDocumentIds} disabled={busy}/></>}
        <div id="mode-help" className="mode-help">
          {mode === "demo" ? (
            "Demo runs a fixed sample about AI research workflows. No API keys or live searches are used."
          ) : (includeWeb ? health?.liveConfigured : health?.documentsConfigured) ? (
            "Build a report from your chosen evidence. Provider API usage is billed to your configured accounts."
          ) : (
            <span>
              Connect OpenAI and Tavily in{" "}
              <NavLink to="/settings">Settings</NavLink> to research your own
              question.
            </span>
          )}
        </div>
      </form>
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      <div className="trust-row">
        <span>
          <Workflow size={14} /> A guided, multi-step process
        </span>
        <span>
          <BookOpen size={14} /> Sources you can explore
        </span>
        <span>
          <ShieldCheck size={14} /> Evidence with context
        </span>
      </div>
      <section className="explore-section">
        <div className="section-heading">
          <h2>A starting point for your next idea</h2>
          <span>BIG QUESTIONS WELCOME</span>
        </div>
        <div className="prompt-grid">
          {prompts.map((p) => (
            <button
              key={p.label}
              className={`prompt-card ${p.className}`}
              onClick={() => {
                setQuestion(p.question);
                setMode("live");
                document.getElementById("question")?.focus();
              }}
            >
              <div className="prompt-top">
                <p.icon size={18} />
                <ArrowUpRight size={16} />
              </div>
              <small>{p.label}</small>
              <h3>{p.title}</h3>
              <p>{p.question}</p>
            </button>
          ))}
        </div>
      </section>
      <RecentResearch />
      <footer className="page-footer">
        <span className="brand-mini">
          <Telescope size={15} /> Built for curious minds.
        </span>
        <span>Clarity starts with a better question.</span>
      </footer>
    </div>
  );
}

function RecentResearch({ full = false }) {
  const health = useHealth();
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    let active = true;
    let timer;
    const load = async () => {
      try {
        const data = await api("/research");
        if (active) {
          setRuns(data);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(load, 3000);
        }
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const visible = runs
    .filter((r) => r.question.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, full ? 100 : 3);
  return (
    <section className="recent-section">
      <div className="section-heading">
        <h2>
          {full ? "Your research sessions" : "Recent research"}{" "}
          <span className="count">{runs.length}</span>
        </h2>
        {!full && (
          <NavLink to="/history">
            View all <ArrowRight size={14} />
          </NavLink>
        )}
      </div>
      {full && (
        <label className="search-input">
          <Search size={17} />
          <input
            placeholder="Search research questions…"
            aria-label="Search research history"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      )}
      {error ? (
        <div role="alert" className="error-message">
          Could not load history. Make sure the API is running.
        </div>
      ) : loading ? (
        <div className="empty-recent">
          <LoaderCircle className="spin" size={20} /> Loading your research…
        </div>
      ) : visible.length ? (
        <div className="research-list">
          {visible.map((run) => (
            <NavLink
              key={run.id}
              to={`/research/${run.id}`}
              className="research-row"
            >
              <span className="research-icon">
                <FileText size={19} />
              </span>
              <div className="research-row-title">
                <h3>{run.question}</h3>
                <p>
                  {date(run.createdAt)}
                  <span>·</span>
                  {run.mode === "demo" ? "Sample research" : (run.documentIds?.length ? (run.includeWeb ? "Web + documents" : "Document research") : "Web research")}
                  <span>·</span>
                  {run.sources.length} sources
                </p>
              </div>
              <Status status={run.status} />
              <ChevronRight size={17} />
            </NavLink>
          ))}
        </div>
      ) : (
        <div className="empty-recent">
          <span className="empty-icon">
            <BookOpen size={23} />
          </span>
          <div>
            <h3>
              {filter ? "No matching research" : "A fresh page for your ideas"}
            </h3>
            <p>
              {filter
                ? "Try another search term."
                : "Your research will appear here once you start your first exploration."}
            </p>
          </div>
          {!full && <ArrowUpRight size={20} className="muted" />}
        </div>
      )}
      <p className="storage-note">
        <Clock3 size={12} />{" "}
        {health?.storage === "postgresql"
          ? "Research is saved in PostgreSQL and survives restarts."
          : "Session history is temporary and resets when the server restarts."}
      </p>
    </section>
  );
}
function HistoryPage() {
  return (
    <div className="page">
      <div className="page-eyebrow">YOUR KNOWLEDGE TRAIL</div>
      <h1 className="page-title">Research history</h1>
      <p className="page-intro">Pick up a question where you left off.</p>
      <RecentResearch full />
    </div>
  );
}

function Research() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("report");
  useEffect(() => {
    let active = true;
    let timer;
    setRun(null);
    setError("");
    setTab("report");
    async function poll() {
      try {
        const data = await api(`/research/${id}`);
        if (!active) return;
        setRun(data);
        setError("");
        if (data.status === "running") timer = setTimeout(poll, 1000);
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  async function download() {
    let report;
    try {
      const response = await fetch(`/api/research/${run.id}/export`);
      if (!response.ok) throw new Error('Could not export this report. Wait for research to finish and try again.');
      report = await response.text();
    } catch (e) { setError(e.message); return; }
    const blob = new Blob([report], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-${run.id.slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (error)
    return (
      <div className="page">
        <div role="alert" className="error-message">
          {error}
        </div>
        <Button asChild>
          <NavLink to="/history">Back to history</NavLink>
        </Button>
      </div>
    );
  if (!run)
    return (
      <div className="empty-state">
        <LoaderCircle className="spin" /> Opening your research…
      </div>
    );
  const completed = run.steps.filter((s) => s.status === "complete").length;
  return (
    <div className="page report-page">
      <NavLink className="back-link" to="/history">
        Research history <ChevronRight size={14} /> Research session
      </NavLink>
      <div className="report-heading">
        <div>
          <div className="page-eyebrow">
            {run.mode === "demo" ? "SAMPLE RESEARCH" : "RESEARCH WORKSPACE"}
          </div>
          <h1>{run.question}</h1>
          <div className="report-meta">
            <Status status={run.status} />
            <span>{date(run.createdAt)}</span>
            <span>
              {run.depth === "deep"
                ? "Deeper exploration"
                : "Quick exploration"}
            </span>
          </div>
        </div>
        <Button variant="outline" disabled={!run.report || run.status === 'running'} onClick={download}>
          <ArrowDownToLine size={16} /> Export .md
        </Button>
      </div>
      {run.mode === "demo" && (
        <div className="notice">
          <Sparkles size={16} />
          <span>
            This is a fixed demo. No live search or factual verification was
            performed.
          </span>
        </div>
      )}
      {run.error && (
        <div role="alert" className="error-message">
          {run.error} <NavLink to="/">Start a new run</NavLink>
        </div>
      )}
      {run.mode !== 'demo' && run.report && <div className="notice evidence-notice"><ShieldCheck size={17}/><span>{run.status === 'running' ? 'The draft is ready. Its final evidence check is still running.' : evidenceLabel(run.verification)}. This is a source-excerpt check, not independent fact verification.</span><button type="button" onClick={()=>setTab('evidence')}>View checks</button></div>}
      <div className="report-layout">
        <div>
          <div
            className="report-tabs"
            role="tablist"
            aria-label="Research detail"
          >
            <button
              role="tab"
              aria-selected={tab === "report"}
              onClick={() => setTab("report")}
            >
              Report
            </button>
            <button
              role="tab"
              aria-selected={tab === "activity"}
              onClick={() => setTab("activity")}
            >
              Research activity
            </button>
            <button role="tab" aria-selected={tab === 'evidence'} onClick={()=>setTab('evidence')}>Evidence check</button>
          </div>
          <div className="report-paper" role="tabpanel">
            {tab === "report" ? (
              run.report ? (
                <article className="markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                      img: () => null,
                    }}
                  >
                    {run.report}
                  </ReactMarkdown>
                </article>
              ) : (
                <div className="report-placeholder">
                  {run.status === "failed" ? (
                    <XCircle size={34} />
                  ) : (
                    <div className="working-icon">
                      <Telescope size={34} />
                    </div>
                  )}
                  <h2>
                    {run.status === "failed"
                      ? "Research interrupted"
                      : "Following the evidence"}
                  </h2>
                  <p>
                    {run.status === "failed"
                      ? "Your completed stages remain available in Research activity."
                      : "Your report will appear here when the research is complete. You can follow each step as it happens."}
                  </p>
                  <div className="progress-track">
                    <span style={{ width: `${completed / run.steps.length * 100}%` }} />
                  </div>
                  <small>{completed} of {run.steps.length} stages complete</small>
                </div>
              )
            ) : tab === 'evidence' ? (
              run.status === 'running' && !run.verification ? <p className="muted">The evidence check will run after report writing finishes.</p> : <EvidenceCheck check={run.verification || (run.mode === 'demo' ? {scope:'Demo content is not fact-checked.'} : null)}/>
            ) : (
              <div className="activity-content">
                <h2>Behind the report</h2>
                {run.plan ? (
                  <>
                    <h3>Research focus</h3>
                    <ul>
                      {run.plan.focus.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                    <h3>Search queries</h3>
                    <ul>
                      {run.plan.queries.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>The research plan is being prepared.</p>
                )}
                {run.analysis && (
                  <>
                    <h3>Analysis</h3>
                    <ReactMarkdown>{run.analysis}</ReactMarkdown>
                  </>
                )}
                {run.review && (
                  <>
                    <h3>Evidence review</h3>
                    <ReactMarkdown>{run.review}</ReactMarkdown>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <aside className="research-aside">
          <div className="panel">
            <div className="panel-heading">
              <h2>Research journey</h2>
              <span>{completed}/{run.steps.length}</span>
            </div>
            <div aria-live="polite" className="timeline">
              {run.steps.map((step) => {
                const [title, description, Icon] = stepInfo[step.id];
                return (
                  <div key={step.id} className={`timeline-step ${step.status}`}>
                    <span className="step-icon">
                      {step.status === "complete" ? (
                        <Check size={16} />
                      ) : step.status === "running" ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : step.status === "failed" ? (
                        <XCircle size={16} />
                      ) : (
                        <Icon size={16} />
                      )}
                    </span>
                    <div>
                      <h3>{title}</h3>
                      <p>
                        {step.status === "pending"
                          ? "Waiting to begin"
                          : step.status === "complete"
                            ? "Complete"
                            : step.status === "failed"
                              ? "Could not finish"
                              : description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel source-panel">
            <div className="panel-heading">
              <h2>{run.mode === "demo" ? "Example references" : "Sources"}</h2>
              <Badge>{run.sources.length}</Badge>
            </div>
            {run.sources.length ? (
              run.sources.map((source) => (
                <ResearchSource key={source.id} source={source}/>
              ))
            ) : (
              <p className="muted">Sources will appear after discovery.</p>
            )}
          </div>
          <p className="aside-note">
            <ShieldCheck size={15} /> Evidence review checks source excerpts.
            Always review important claims yourself.
          </p>
        </aside>
      </div>
    </div>
  );
}
function SettingsPage({ health }) {
  return (
    <div className="page settings-page">
      <div className="page-eyebrow">MAKE YOURSELF AT HOME</div>
      <h1 className="page-title">Workspace settings</h1>
      <p className="page-intro">A clear view of what powers your research.</p>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>Research connections</h2>
          <Badge tone={health?.liveConfigured ? "green" : "amber"}>
            {health?.liveConfigured ? "Ready" : "Setup needed"}
          </Badge>
        </div>
        <p>
          API keys stay on the server. To enable live research, copy{" "}
          <code>backend/.env.example</code> to <code>backend/.env</code>, fill
          in your keys, and restart the API.
        </p>
        <div className="setting-row">
          <span>
            <Sparkles size={20} />
            <div>
              OpenAI<small>Planning, analysis, and report writing</small>
            </div>
          </span>
          <code>OPENAI_API_KEY</code>
        </div>
        <div className="setting-row">
          <span>
            <Globe2 size={20} />
            <div>
              Tavily<small>Web search and source discovery</small>
            </div>
          </span>
          <code>TAVILY_API_KEY</code>
        </div>
        <div className="setting-row">
          <span>
            <Workflow size={20} />
            <div>
              LangSmith<small>Optional tracing of inputs and outputs</small>
            </div>
          </span>
          <Badge>{health?.tracing ? "Enabled" : "Not enabled"}</Badge>
        </div>
        <div className="setting-row">
          <span>Research model</span>
          <code>{health?.model || "Checking…"}</code>
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>About this first milestone</h2>
        <p>
          {health?.storage === "postgresql"
            ? "Research history is saved in PostgreSQL. Reports, sources, and progress survive restarts. Uploaded documents are indexed with pgvector for research retrieval."
            : "History is stored temporarily in server memory. Configure PostgreSQL to keep research across restarts."}{" "}
          Upload PDF, TXT, or Markdown files from the live research form.
        </p>
        <p>
          Live research uses search excerpts and model-based evidence review.
          Reports need human review before you rely on their conclusions.
        </p>
        <Button asChild variant="outline">
          <NavLink to="/">
            Back to research <ArrowRight size={15} />
          </NavLink>
        </Button>
      </section>
    </div>
  );
}
function Guide() {
  return (
    <div className="page guide-page">
      <div className="page-eyebrow">FROM QUESTION TO CLARITY</div>
      <h1 className="page-title">A more thoughtful way to research.</h1>
      <p className="page-intro">
        A connected workflow for web and document research. Here’s what happens when you start
        an exploration.
      </p>
      <div className="guide-steps">
        {Object.entries(stepInfo).map(
          ([id, [title, description, Icon]], index) => (
            <div className="panel guide-step" key={id}>
              <span className="guide-number">0{index + 1}</span>
              <Icon size={24} />
              <div>
                <h2>{title}</h2>
                <p>{description}.</p>
              </div>
            </div>
          ),
        )}
      </div>
      <div className="notice">
        <ShieldCheck size={20} />
        <span>
          Evidence review is a model-assisted check of retrieved excerpts, not
          an independent fact-check. Follow source links and verify important
          claims.
        </span>
      </div>
      <Button asChild>
        <NavLink to="/">
          Explore a question <ArrowRight size={16} />
        </NavLink>
      </Button>
    </div>
  );
}
