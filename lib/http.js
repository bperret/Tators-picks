// Small helpers so the API files work on Vercel and in the local test server.
import crypto from "node:crypto";
import { one } from "./db.js";

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function fail(res, status, message) {
  send(res, status, { error: message });
}

// ---------- sessions ----------
const COOKIE = "tp_s";
const MAX_AGE = 60 * 60 * 24 * 180; // about one season

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or too short. Add it in Vercel settings.");
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const want = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

function cookieFlags() {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  return `; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionCookie(player) {
  return `${COOKIE}=${sign({ pid: player.id, v: player.session_v })}; Max-Age=${MAX_AGE}${cookieFlags()}`;
}

export function clearCookie() {
  return `${COOKIE}=; Max-Age=0${cookieFlags()}`;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Returns the signed-in player row, or null.
export async function currentPlayer(req) {
  const tok = verify(readCookie(req, COOKIE));
  if (!tok) return null;
  const p = await one("select * from players where id = $1", [tok.pid]);
  if (!p || p.session_v !== tok.v) return null;
  return p;
}

export function digits(x) {
  return String(x || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function newPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function newId(prefix = "p_") {
  return prefix + crypto.randomBytes(8).toString("hex");
}
