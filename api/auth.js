// Logins: first-run commissioner setup, cell number + PIN login, profile, PIN change, logout.
import bcrypt from "bcryptjs";
import { q, one, addLog, setKv, getKv } from "../lib/db.js";
import { readBody, send, fail, sessionCookie, clearCookie, currentPlayer, digits, newId } from "../lib/http.js";
import { SWATCH, isOneEmoji, commishExists, getConfig } from "../lib/league.js";
import rankingsSeed from "../data/rankings-seed.js";

const MAX_TRIES = 10;
const PAUSE_MIN = 15;

// A new PIN signs out every other device (item 62), the same as Reset PIN. This device gets a fresh cookie.
async function changePin(me, pin) {
  const p = await one("update players set pin_hash = $2, session_v = session_v + 1, fail_count = 0, locked_until = null where id = $1 returning *", [me.id, await bcrypt.hash(String(pin), 10)]);
  return sessionCookie(p);
}

function validPin(p) {
  return /^\d{6}$/.test(String(p || ""));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return fail(res, 405, "Use POST.");
    const b = await readBody(req);
    const action = b.action;

    if (action === "setup") {
      if (await commishExists()) return fail(res, 409, "The commissioner is already set up. Log in instead.");
      const code = process.env.SETUP_CODE;
      if (!code) return fail(res, 500, "SETUP_CODE is not set in Vercel settings.");
      if (String(b.code || "").trim() !== code) return fail(res, 403, "That setup code is not right.");
      const phone = digits(b.phone);
      if (phone.length !== 10) return fail(res, 400, "Enter your 10 digit cell number.");
      if (!validPin(b.pin)) return fail(res, 400, "Choose a 6 digit PIN.");
      const id = newId();
      await q("insert into players (id, phone, pin_hash, is_commish) values ($1, $2, $3, true)", [id, phone, await bcrypt.hash(String(b.pin), 10)]);
      const cfg = await getConfig();
      await setKv("config", cfg);
      if (!(await getKv("rankings", null))) {
        await setKv("rankings", rankingsSeed);
      }
      await addLog("Setup", "Created the commissioner account");
      const p = await one("select * from players where id = $1", [id]);
      return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(p) });
    }

    if (action === "login") {
      const phone = digits(b.phone);
      if (phone.length !== 10) return fail(res, 400, "Enter your 10 digit cell number.");
      const p = await one("select * from players where phone = $1", [phone]);
      if (!p) return fail(res, 404, "That number is not in the league. Ask the commissioner to add you.");
      const now = Date.now();
      if (p.locked_until && Date.parse(p.locked_until) > now) {
        const m = Math.ceil((Date.parse(p.locked_until) - now) / 60000);
        return send(res, 423, { error: `Too many wrong PINs. Try again in ${m} minute${m === 1 ? "" : "s"}, or text the commissioner to reset it.`, paused: true });
      }
      const ok = await bcrypt.compare(String(b.pin || ""), p.pin_hash);
      if (!ok) {
        // One statement counts the miss (item 62), so wrong guesses that land at the same moment each count.
        // It skips a login that another request has just paused.
        const c = await one("update players set fail_count = fail_count + 1 where id = $1 and (locked_until is null or locked_until <= now()) returning fail_count", [p.id]);
        const paused = () => send(res, 423, { error: `Too many wrong PINs. Try again in ${PAUSE_MIN} minutes, or text the commissioner to reset it.`, paused: true });
        if (!c) return paused();
        const n = c.fail_count;
        if (n >= MAX_TRIES) {
          // Only the request that reaches the limit first sets the pause and writes the log.
          const hit = await one("update players set fail_count = 0, locked_until = now() + ($2 || ' minutes')::interval, lockouts = lockouts + 1 where id = $1 and fail_count >= $3 returning id", [p.id, String(PAUSE_MIN), MAX_TRIES]);
          if (hit) await addLog("Site", "Paused a login after 10 wrong PINs", p.name || p.invited || "A picker");
          return paused();
        }
        const left = MAX_TRIES - n;
        return send(res, 401, { error: `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left before a ${PAUSE_MIN} minute pause.` });
      }
      await q("update players set fail_count = 0, locked_until = null where id = $1", [p.id]);
      return send(res, 200, { ok: true, setupDone: p.setup_done }, { "Set-Cookie": sessionCookie(p) });
    }

    if (action === "logout") {
      return send(res, 200, { ok: true }, { "Set-Cookie": clearCookie() });
    }

    const me = await currentPlayer(req);
    if (!me) return fail(res, 401, "Log in first.");

    if (action === "profile") {
      const name = String(b.name || "").trim().slice(0, 24);
      if (!name) return fail(res, 400, "Enter a display name.");
      const taken = await one("select id from players where lower(name) = lower($1) and id <> $2", [name, me.id]);
      if (taken) return fail(res, 409, "Another picker already uses that name.");
      if (!isOneEmoji(b.emoji)) return fail(res, 400, "Pick one emoji.");
      if (!SWATCH.includes(b.c1) || !SWATCH.includes(b.c2)) return fail(res, 400, "Pick both colors.");
      if (b.c1 === b.c2) return fail(res, 400, "Pick two different colors.");
      let cookie = null;
      if (b.newPin) {
        if (!validPin(b.newPin)) return fail(res, 400, "A PIN is 6 digits.");
        cookie = await changePin(me, b.newPin);
      }
      await q("update players set name = $2, emoji = $3, c1 = $4, c2 = $5, setup_done = true where id = $1", [me.id, name, b.emoji.trim(), b.c1, b.c2]);
      if (!me.setup_done) await addLog("Site", "A picker finished first login", name);
      return send(res, 200, { ok: true }, cookie ? { "Set-Cookie": cookie } : {});
    }

    if (action === "pin") {
      if (!(await bcrypt.compare(String(b.current || ""), me.pin_hash))) return fail(res, 403, "Your current PIN is not right.");
      if (!validPin(b.newPin)) return fail(res, 400, "A PIN is 6 digits.");
      return send(res, 200, { ok: true }, { "Set-Cookie": await changePin(me, b.newPin) });
    }

    fail(res, 400, "Unknown action.");
  } catch (e) {
    console.error(e);
    fail(res, 500, e.message || "Server error");
  }
}
