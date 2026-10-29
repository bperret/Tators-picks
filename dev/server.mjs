// Local test server: serves public/ and the api/ handlers against an in-memory Postgres.
// Run: SESSION_SECRET=... SETUP_CODE=... node dev/server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { setTestDb } from "../lib/db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SESSION_SECRET ||= "local-dev-secret-local-dev-secret-0000";
process.env.SETUP_CODE ||= "LOCALCODE";

export async function startServer(port = 3000) {
  const pg = new PGlite();
  setTestDb(async (text, params) => (await pg.query(text, params)).rows);
  const handlers = {};
  for (const f of fs.readdirSync(path.join(root, "api"))) {
    if (f.endsWith(".js")) handlers["/api/" + f.slice(0, -3)] = (await import(path.join(root, "api", f))).default;
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (handlers[url.pathname]) return handlers[url.pathname](req, res);
    const file = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
    if (file.startsWith(path.join(root, "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.setHeader("Content-Type", file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
      return res.end(fs.readFileSync(file));
    }
    res.statusCode = 404;
    res.end("Not found");
  });
  await new Promise((r) => server.listen(port, r));
  return { server, pg };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  await startServer(port);
  console.log(`Tator's Picks running at http://localhost:${port}`);
}
