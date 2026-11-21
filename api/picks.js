// Saving a pick sheet. The server clock enforces the lock: any save at or after the deadline is refused.
import { q, one } from "../lib/db.js";
import { readBody, send, fail, currentPlayer } from "../lib/http.js";
import { getConfig, effectiveStatus, checkSheet, saveNote } from "../lib/league.js";
import { saveAwardPicks } from "../lib/awards.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return fail(res, 405, "Use POST.");
    const me = await currentPlayer(req);
    if (!me) return fail(res, 401, "Log in first.");
    if (me.removed) return fail(res, 403, "You are not active in the league. Contact the commissioner.");
    const b = await readBody(req);
    // Award Watch (item 65): its own sheet, its own lock.
    if (b.awards) {
      const r = await saveAwardPicks(me, b.awards);
      if (r.error) return fail(res, r.status, r.error);
      return send(res, 200, { ok: true, awards: r.data });
    }
    const row = await one("select data from weeks where id = $1", [b.weekId]);
    if (!row) return fail(res, 404, "That week does not exist.");
    const w = row.data;
    const status = effectiveStatus(w);
    if (status === "locked" || status === "final") return fail(res, 423, "Picks locked at the deadline. The site refused this save.");
    if (status !== "open") return fail(res, 409, "Picks are not open for this week yet.");

    const config = await getConfig();
    const chk = await checkSheet(w, b, me.id, config);
    if (chk.error) return fail(res, chk.status, chk.error);
    const data = chk.data;
    const prevRow = await one("select data from picks where player_id = $1 and week_id = $2", [me.id, b.weekId]);
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
