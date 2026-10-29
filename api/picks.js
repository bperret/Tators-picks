// Saving a pick sheet. The server clock enforces the lock: any save at or after the deadline is refused.
import { q, one } from "../lib/db.js";
import { readBody, send, fail, currentPlayer } from "../lib/http.js";
import { getConfig, effectiveStatus, survivorUsed, saveNote } from "../lib/league.js";

const canon = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return fail(res, 405, "Use POST.");
    const me = await currentPlayer(req);
    if (!me) return fail(res, 401, "Log in first.");
    if (me.removed) return fail(res, 403, "You are not active in the league. Contact the commissioner.");
    const b = await readBody(req);
    const row = await one("select data from weeks where id = $1", [b.weekId]);
    if (!row) return fail(res, 404, "That week does not exist.");
    const w = row.data;
    const status = effectiveStatus(w);
    if (status === "locked" || status === "final") return fail(res, 423, "Picks locked at the deadline. The site refused this save.");
    if (status !== "open") return fail(res, 409, "Picks are not open for this week yet.");

    const games = w.games || [];
    const ids = new Set(games.map((g) => g.id));
    const voids = new Set(Object.entries(w.results || {}).filter(([, r]) => r && r.void).map(([k]) => k));
    const sel = {};
    for (const [gid, side] of Object.entries(b.sel || {})) {
      if (!ids.has(gid) || voids.has(gid)) continue;
      if (side !== "home" && side !== "away") return fail(res, 400, "A pick must be home or away.");
      sel[gid] = side;
    }
    let lock = b.lock || null;
    if (lock && !sel[lock]) return fail(res, 400, "Pick a side in your field goal game first.");
    let tb = b.tb;
    if (tb === "" || tb === undefined) tb = null;
    if (tb !== null && (!Number.isInteger(tb) || tb < 0 || tb > 200)) return fail(res, 400, "The tiebreaker must be a whole number from 0 to 200.");
    let surv = null;
    const config = await getConfig();
    if (b.surv) {
      if (!config.survivorStart || b.weekId < config.survivorStart) return fail(res, 400, "Survivor has not started.");
      const g = games.find((x) => x.id === b.surv.g);
      if (!g || (b.surv.s !== "home" && b.surv.s !== "away")) return fail(res, 400, "That survivor pick is not on this slate.");
      const team = b.surv.s === "home" ? g.home : g.away;
      const used = (await survivorUsed(me.id, b.weekId, config)).map(canon);
      if (used.includes(canon(team))) return fail(res, 400, `You already used ${team} in Survivor.`);
      surv = { g: g.id, s: b.surv.s };
    }
    const prevRow = await one("select data from picks where player_id = $1 and week_id = $2", [me.id, b.weekId]);
    const data = { sel, lock, tb, surv };
    const abbr = (t) => (b.abbr && typeof b.abbr[t] === "string" ? b.abbr[t].slice(0, 6) : t);
    const note = saveNote(prevRow && prevRow.data, data, w, abbr);
    await q(
      `insert into picks (player_id, week_id, data, updated_at) values ($1, $2, $3::jsonb, now())
       on conflict (player_id, week_id) do update set data = excluded.data, updated_at = now()`,
      [me.id, b.weekId, JSON.stringify(data)]
    );
    await q("insert into pick_history (player_id, week_id, note) values ($1, $2, $3)", [me.id, b.weekId, note]);
    send(res, 200, { ok: true, note });
  } catch (e) {
    console.error(e);
    fail(res, 500, e.message || "Server error");
  }
}
