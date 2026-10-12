# Deep Research

A public, shared AI research workspace built with React, Vite, Express, PostgreSQL, pgvector, LangChain, and LangGraph. Visitors can open the site and run live research without registration. The server uses its configured OpenAI and Tavily keys for research; uploaded documents can be combined with web search.

## Run locally

Requires Node.js 22 or later, npm, and Docker Desktop for persistent storage.

```powershell
npm install
npm run db:setup
npm run db:up
```

Set `OPENAI_API_KEY` and `TAVILY_API_KEY` in the ignored `backend/.env` file, then run:

```powershell
npm run dev
```

Open http://127.0.0.1:5173. The API runs at http://127.0.0.1:3001. Document-only research needs OpenAI and PostgreSQL but does not need Tavily. In production, `DATABASE_URL` is required. API keys must stay in backend environment variables, never in the frontend or Git.

The local Compose service runs PostgreSQL 17 with pgvector on `127.0.0.1:5433`. `npm run db:setup` generates a database password and connection string in ignored environment files. `npm run db:stop` stops the database without deleting the volume. The named volume retains data across restarts but is not a backup.

## Shared workspace and data

Anyone with the site link can start real research, upload documents, and see new shared research history and files. Each live run consumes the configured provider accounts' API quotas. Set spending limits before sharing the link widely. The API allows two concurrent research runs and one document indexing job at a time; these are concurrency controls, not usage budgets.

The previous account-owned research and documents remain in PostgreSQL with their `user_id` values but are not available through the public API. New shared records use `user_id IS NULL`. No account records or documents are deleted by this update. If you want to migrate former private records into the shared workspace, do so deliberately after reviewing their contents.

Research, progress, reports, and source excerpts are stored in `research_runs`; document metadata is in `documents`; passages and embeddings are in `document_chunks`. Interrupted runs and uploads are marked failed on restart. Use one API process per database. Temporary memory mode is available locally without PostgreSQL, but uploaded document research requires PostgreSQL.

## Research workflow

Visitors enter a question of 10–2,000 characters, choose quick or deep exploration, and optionally select up to five uploaded documents. Web search can be turned off when documents are selected. Quick exploration uses one search query; deeper exploration uses up to three. LangGraph plans, searches, retrieves selected document passages, analyzes, reviews, writes a Markdown report, and runs a final evidence check.

The evidence check compares report passages with cited source excerpts. It is model-assisted and does not independently establish that sources are true. Reports retain citations, source links or document passages, and evidence-check warnings. Markdown export is available after processing finishes. LangSmith tracing is optional via `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, and `LANGSMITH_PROJECT`; traces can include questions and source text.

PDF, TXT, and Markdown uploads are supported. Limits are 5 MB, 100 PDF pages, 200,000 extracted characters, and 160 passages. PDFs need selectable text; scanned PDFs require OCR before upload. OpenAI `text-embedding-3-small` creates 1,536-dimensional embeddings. Original file bytes are discarded after extraction, while extracted text and embeddings persist in PostgreSQL. Try the fictional `samples/juniper-pilot.md` file for a local document-research example.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Public configuration status, without keys |
| `POST /api/research` | Start live research with `{ question, depth: "quick" or "deep", includeWeb: true, documentIds: [] }` |
| `GET /api/research` | Shared research history |
| `GET /api/research/:id` | Run progress and report |
| `GET /api/research/:id/export` | Markdown report and evidence check |
| `POST /api/documents` | Upload one multipart `file` |
| `GET /api/documents` | Shared document library |
| `GET /api/documents/:id/passages` | Extracted passages, without embeddings |

The API rejects cross-origin mutations from unrecognized browser origins. This does not authenticate visitors or prevent direct HTTP clients from using the public API.

## Checks

```powershell
npm run check
npm run test:db
```

`npm run check` runs offline backend tests and builds the frontend without calling paid providers. `npm run test:db` exercises persistence against a separate temporary local database when `DATABASE_URL` is configured. The default OpenAI model is `gpt-4.1-mini`; set `OPENAI_MODEL` to another model available to your account.
