import { send, fail, currentPlayer, readBody } from "../lib/http.js";
import { getKv, one } from "../lib/db.js";
import { buildState, commishExists, teamGamesView, recordEngage } from "../lib/league.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "Use GET or POST.");
    const me = await currentPlayer(req);
    if (req.method === "POST") {
      if (!me) return fail(res, 401, "Log in first.");
      await recordEngage(me, await readBody(req));
      return send(res, 200, { ok: true });
    }
    if (!me) return send(res, 401, { error: "Log in first.", needsSetup: !(await commishExists()) });
    // ?part=teams sends the team game log for the Stats view.
    const part = new URL(req.url || "/", "http://x").searchParams.get("part");
    if (part === "teams") return send(res, 200, await teamGamesView());
    // ?part=board sends the game day scoreboard (item 48), read only while the Scoreboard tab is open.
    if (part === "board") return send(res, 200, (await getKv("dayBoard", null)) || { day: null, at: null, games: [] });
    // ?part=card&key=... sends a posted GroupMe card as a PNG (item 66).
    if (part === "card") {
      const key = new URL(req.url || "/", "http://x").searchParams.get("key") || "";
      const row = await one("select png from gm_cards where key = $1", [key]);
      if (!row) return fail(res, 404, "No such card.");
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.end(Buffer.from(row.png, "base64"));
    }
    send(res, 200, await buildState(me, { poll: true }));
  } catch (e) {
    console.error(e);
    fail(res, 500, e.message || "Server error");
  }
}
