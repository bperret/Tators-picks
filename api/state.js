import { send, fail, currentPlayer } from "../lib/http.js";
import { buildState, commishExists, teamGamesView } from "../lib/league.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return fail(res, 405, "Use GET.");
    const me = await currentPlayer(req);
    if (!me) return send(res, 401, { error: "Log in first.", needsSetup: !(await commishExists()) });
    // ?part=teams sends the team game log for the Stats view.
    const part = new URL(req.url || "/", "http://x").searchParams.get("part");
    if (part === "teams") return send(res, 200, await teamGamesView());
    send(res, 200, await buildState(me));
  } catch (e) {
    console.error(e);
    fail(res, 500, e.message || "Server error");
  }
}
