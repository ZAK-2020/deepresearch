import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
async function read(path) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
}
const root = await read(".env");
const password =
  parseEnv(root).POSTGRES_PASSWORD || randomBytes(24).toString("hex");
if (!parseEnv(root).POSTGRES_PASSWORD)
  await writeFile(".env", root + "\nPOSTGRES_PASSWORD=" + password + "\n");
let backend = await read("backend/.env");
if (!backend) backend = await read("backend/.env.example");
if (!parseEnv(backend).DATABASE_URL) {
  backend = backend.replace(/^DATABASE_URL=.*\r?\n?/gm, "");
  await writeFile(
    "backend/.env",
    backend +
      "\nDATABASE_URL=postgresql://deepresearch:" +
      encodeURIComponent(password) +
      "@127.0.0.1:5433/deepresearch\n",
  );
}
console.log(
  "Local database settings ready. Existing provider keys were preserved.",
);
