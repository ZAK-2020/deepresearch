import { createApp } from "./app.js";
import express from "express";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { postgresStore, memoryStore } from "./store.js";
if ((process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required when running in production.');
  process.exit(1);
}
let store;
try {
  store = process.env.DATABASE_URL
    ? await postgresStore(process.env.DATABASE_URL, {
        importFile: fileURLToPath(
          new URL("../data/history-import.json", import.meta.url),
        ),
      })
    : memoryStore();
} catch {
  console.error(
    "Cannot connect to PostgreSQL. Run npm run db:up and check DATABASE_URL.",
  );
  process.exit(1);
}
const app = createApp({ store });
const frontend = fileURLToPath(
  new URL("../../frontend/dist/", import.meta.url),
);
if (existsSync(frontend)) {
  app.use(express.static(frontend));
  app.get("/{*path}", (req, res) => res.sendFile(frontend + "/index.html"));
}
const port = Number(process.env.PORT || 3001);
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Deep Research API: http://${process.env.HOST || "127.0.0.1"}:${port}`,
  ),
);
