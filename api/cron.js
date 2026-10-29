// Scheduled automation. GitHub Actions calls this every hour, and Vercel's daily cron
// calls it as a backup. Both send "Authorization: Bearer <CRON_SECRET>".
import crypto from "node:crypto";
import { send, fail } from "../lib/http.js";
import { tick } from "../lib/auto.js";

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const got = String(req.headers.authorization || "");
  if (!secret) return false;
  const want = `Bearer ${secret}`;
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  try {
    if (!process.env.CRON_SECRET) return fail(res, 503, "CRON_SECRET is not set in Vercel.");
    if (!authorized(req)) return fail(res, 401, "Not allowed.");
    const source = req.headers["x-vercel-cron-schedule"] ? "vercel" : String(req.headers["x-source"] || "github").slice(0, 20);
    const out = await tick({ source });
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message || "Server error");
  }
}
