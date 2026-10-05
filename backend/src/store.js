import pg from "pg";
import { readFile } from "node:fs/promises";
import { initializeDocuments, documentStore } from './document-store.js';
import { initializeAuth, authStore } from './auth-store.js';

const summary = ({ report, analysis, review, ...run }) => run;
export function memoryStore() {
  const runs = new Map();
  return {
    kind: "memory",
    async save(run) {
      runs.set(run.id, structuredClone(run));
    },
    async get(id) {
      return structuredClone(runs.get(id));
    },
    async list() {
      return [...runs.values()].reverse().map(summary);
    },
    async health() {
      return true;
    },
    async close() {},
  };
}
export async function postgresStore(
  connectionString,
  { recover = true, importFile } = {},
) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  pool.on("error", () => console.error("Database connection interrupted."));
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS research_runs (
        id uuid PRIMARY KEY,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        data jsonb NOT NULL,
        user_id uuid
      );
      ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS user_id uuid;
      CREATE INDEX IF NOT EXISTS research_runs_created_at_idx ON research_runs (created_at DESC);
      CREATE INDEX IF NOT EXISTS research_runs_user_created_idx ON research_runs (user_id, created_at DESC);`);
    await initializeAuth(pool);
    await initializeDocuments(pool, recover);
    if (importFile) {
      let previous = [];
      try {
        previous = JSON.parse(await readFile(importFile, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      for (const run of previous)
        await pool.query(
          "INSERT INTO research_runs (id, created_at, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
          [run.id, run.createdAt, run],
        );
    }
    // One API process owns this local workspace. In-flight jobs cannot resume yet.
    if (recover)
      await pool.query(`UPDATE research_runs SET data = data || jsonb_build_object(
      'status', 'failed', 'error', 'Research was interrupted by a server restart. Start a new run to continue.',
      'finishedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'steps', (SELECT jsonb_agg(CASE WHEN step->>'status' = 'running' THEN step || '{"status":"failed"}'::jsonb ELSE step END)
        FROM jsonb_array_elements(data->'steps') step)), updated_at = now()
      WHERE data->>'status' = 'running'`);
    const scoped = (userId) => ({
      ...documentStore(pool, userId),
      async save(run) {
        await pool.query(
          "INSERT INTO research_runs (id, created_at, data, user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now() WHERE research_runs.user_id IS NOT DISTINCT FROM EXCLUDED.user_id",
          [run.id, run.createdAt, run, userId],
        );
      },
      async get(id) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
        return (await pool.query('SELECT data FROM research_runs WHERE id = $1 AND user_id = $2', [id, userId])).rows[0]?.data;
      },
      async list() {
        return (await pool.query("SELECT data - 'report' - 'analysis' - 'review' AS data FROM research_runs WHERE user_id = $1 ORDER BY created_at DESC", [userId])).rows.map(row => row.data);
      },
    });
    return {
      kind: "postgresql",
      auth: authStore(pool),
      forUser: scoped,
      ...documentStore(pool),
      async save(run) {
        await pool.query(
          "INSERT INTO research_runs (id, created_at, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
          [run.id, run.createdAt, run],
        );
      },
      async get(id) {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          )
        )
          return undefined;
        return (
          await pool.query("SELECT data FROM research_runs WHERE id = $1", [id])
        ).rows[0]?.data;
      },
      async list() {
        return (
          await pool.query(
            "SELECT data - 'report' - 'analysis' - 'review' AS data FROM research_runs ORDER BY created_at DESC",
          )
        ).rows.map((row) => row.data);
      },
      async health() {
        await pool.query("SELECT 1");
        return true;
      },
      async close() {
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
