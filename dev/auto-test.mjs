// Automation test: runs a full week on an in-memory database with saved ESPN-shaped responses.
// Run: node dev/auto-test.mjs
import { PGlite } from "@electric-sql/pglite";
import { setTestDb, setKv, getKv, q } from "../lib/db.js";
import { setFetcher, SITE, CORE, FITT, halfPoint } from "../lib/espn.js";
import { tick, runJob, autoView, chooseGames } from "../lib/auto.js";
import { getConfig, getWeek, putWeek, teamGamesView } from "../lib/league.js";
import seed from "../data/rankings-seed.js";
import { redditPage, pastedTable } from "./reddit-fixture.mjs";
import { parseRedditText } from "../lib/polls.js";

const pg = new PGlite();
setTestDb(async (t, p) => (await pg.query(t, p)).rows);
process.env.CRON_SECRET = "test-secret-test-secret";

const results = [];
const check = (name, ok, extra = "") => { results.push([ok ? "PASS" : "FAIL", name, extra]); if (!ok) process.exitCode = 1; };
const CT = (iso) => Date.parse(iso); // times below are written with their UTC offset

// ---------- a fake ESPN ----------
// Saturday Nov 7, 2026 is after daylight saving ends, so Central time is UTC-6.
const T = (id, location, abbr) => ({ id: String(id), location, abbreviation: abbr, displayName: location });
const teams = {
  1: T(1, "Miami", "MIA"), 2: T(2, "Ohio State", "OSU"), 3: T(3, "Georgia", "UGA"), 4: T(4, "Indiana", "IU"), 5: T(5, "Notre Dame", "ND"),
  6: T(6, "Utah", "UTAH"), 7: T(7, "UCLA", "UCLA"), 8: T(8, "BYU", "BYU"), 9: T(9, "Kentucky", "UK"), 10: T(10, "Alabama", "ALA"),
  11: T(11, "Texas", "TEX"), 12: T(12, "Ole Miss", "MISS"), 13: T(13, "Texas Tech", "TTU"), 14: T(14, "Wake Forest", "WAKE"), 15: T(15, "LSU", "LSU"),
  16: T(16, "Tennessee", "TENN"), 17: T(17, "Florida", "FLA"), 18: T(18, "Houston", "HOU"), 19: T(19, "SMU", "SMU"), 20: T(20, "Oregon", "ORE"),
  31: T(31, "Purdue", "PUR"), 32: T(32, "Rutgers", "RUTG"), 33: T(33, "Kansas", "KU"), 34: T(34, "Duke", "DUKE"), 35: T(35, "Rice", "RICE"),
  36: T(36, "Navy", "NAVY"), 37: T(37, "Army", "ARMY"), 38: T(38, "Baylor", "BAY"), 39: T(39, "San José State", "SJSU"), 40: T(40, "Hawai'i", "HAW"),
};
const rankOf = (id) => (id <= 20 ? id : 99);
// [eventId, awayId, homeId, kickoff, home line string, home favored]
const slateGames = [
  [101, 17, 3, "2026-11-07T14:30:00-06:00", "-7", true],     // UF at UGA, ranked v ranked, whole line
  [102, 15, 10, "2026-11-07T18:30:00-06:00", "+2.5", false],  // LSU at BAMA, ranked v ranked
  [103, 31, 1, "2026-11-07T11:00:00-06:00", "-21.5", true],   // MIA home, best rank
  [104, 2, 32, "2026-11-07T14:30:00-06:00", "+17.5", false],  // tOSU
  [105, 33, 4, "2026-11-07T11:00:00-06:00", "-14.5", true],   // IU
  [106, 5, 36, "2026-11-07T14:30:00-06:00", "+24.5", false],  // ND
  [107, 6, 34, "2026-11-07T18:00:00-06:00", "PK", true],      // Utah, pick'em, Duke favored
  [108, 38, 13, "2026-11-07T15:00:00-06:00", "-3", true],     // TTU, tight
  [109, 14, 35, "2026-11-07T11:00:00-06:00", "+1.5", false],  // Wake, tightest
  [110, 37, 19, "2026-11-07T19:00:00-06:00", "-4.5", true],   // SMU
  [111, 39, 20, "2026-11-07T21:30:00-06:00", "-5.5", true],   // Oregon
  [112, 18, 40, "2026-11-07T23:00:00-06:00", "+6.5", false],  // Houston at Hawaii
  [113, 9, 16, "2026-11-07T10:00:00-06:00", "-1.5", true],    // 10 a.m. kickoff: left out
  [114, 12, 11, "2026-11-06T19:00:00-06:00", "-2.5", true],   // Friday: left out
  [115, 7, 8, "2026-11-07T15:00:00-06:00", null, false],      // no line yet: left out and flagged
];
let live = {}; // eventId -> {state, completed, name, away, home}
let failScoreboard = false;
function event([id, a, h, date, line, homeFav]) {
  const s = live[id] || { state: "pre", completed: false, name: "STATUS_SCHEDULED", away: 0, home: 0 };
  const comp = (tid, ha) => ({ homeAway: ha, team: teams[tid], curatedRank: { current: rankOf(tid) }, score: String(ha === "home" ? s.home : s.away) });
  const odds = line == null ? [] : [{ details: "x", spread: parseFloat(line) || 0, homeTeamOdds: { favorite: homeFav }, awayTeamOdds: { favorite: !homeFav }, pointSpread: { home: { close: { line } }, away: { close: { line: "x" } } } }];
  return { id: String(id), date: new Date(date).toISOString().replace(":00.000Z", "Z"), shortName: "G" + id, week: { number: 11 },
    competitions: [{ id: String(id), neutralSite: id === 101, competitors: [comp(h, "home"), comp(a, "away")], odds,
      status: { clock: s.state === "in" ? (s.clock ?? 252) : 0, displayClock: s.state === "in" ? (s.dclock || "4:12") : "0:00", period: s.state === "in" ? (s.period || 3) : s.state === "post" ? 4 : 0,
        type: { name: s.name, state: s.state, completed: s.completed, shortDetail: s.state === "post" ? "Final" : s.state === "in" ? "4:12 - 3rd" : "Sat" } } }] };
}
const board = () => ({ season: { year: 2026, type: 2 }, week: { number: 11 }, events: slateGames.map(event) });
// Earlier weeks for the game log backfill: [eventId, awayId, homeId, kickoff, home line, away score, home score, total]
const pastGames = {
  9: [[901, 17, 3, "2026-10-31T14:30:00-05:00", -6.5, 20, 30, 50.5], [902, 15, 10, "2026-10-31T18:30:00-05:00", 3, 28, 24, null],
    [903, 9, 16, "2026-10-31T11:00:00-05:00", null, 24, 20, null], [904, 12, 11, "2026-10-31T14:30:00-05:00", null, 21, 27, null]],
  10: [[1001, 3, 15, "2026-11-01T14:30:00-06:00", 2.5, 17, 21, 45]],
};
let failWeek = null;
let redditHtml = redditPage(9);
function pastEvent([id, a, h, date, line, as, hs, total]) {
  const comp = (tid, ha) => ({ homeAway: ha, team: teams[tid], curatedRank: { current: rankOf(tid) }, score: String(ha === "home" ? hs : as) });
  const odds = line == null ? [] : [{ spread: line, overUnder: total ?? undefined, homeTeamOdds: { favorite: line < 0 } }];
  return { id: String(id), date: new Date(date).toISOString(), shortName: "P" + id, competitions: [{ id: String(id), neutralSite: false, competitors: [comp(h, "home"), comp(a, "away")], odds,
    status: { type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } } }] };
}
const polls = { rankings: [{ name: "AP Top 25", shortName: "AP Poll", type: "ap", date: "2026-11-01T18:00Z",
  ranks: Object.values(teams).filter((t) => rankOf(+t.id) < 99).map((t) => ({ current: +t.id, previous: +t.id === 1 ? 2 : +t.id === 2 ? 1 : +t.id, points: 1600 - +t.id * 50, recordSummary: "7-1", team: t })),
  others: [{ team: teams[31], points: 12 }] }] };
const fitt = { teams: Object.values(teams).map((t, i) => ({ team: { id: t.id, nickname: t.location }, categories: [{ totals: [String(25 - i * 0.7)] }] })) };

setFetcher(async (url) => {
  if (url.startsWith(SITE + "/scoreboard")) {
    if (failScoreboard) throw new Error("ESPN answered 503 for /scoreboard.");
    const wk = (url.match(/[&?]week=(\d+)/) || [])[1];
    if (wk && +wk === failWeek) throw new Error("ESPN answered 503 for /scoreboard.");
    if (wk && +wk !== 11) return { season: { year: 2026, type: 2 }, week: { number: +wk }, events: (pastGames[wk] || []).map(pastEvent) };
    return board();
  }
  if (url.startsWith(SITE + "/rankings")) return polls;
  if (url.startsWith("https://poll.redditcfb.com/")) { if (redditHtml == null) throw new Error("poll.redditcfb.com answered 503."); return redditHtml; }
  if (url.startsWith(FITT)) return fitt;
  // ESPN's per-game odds feed, for games logged without a line.
  const od = url.match(/events\/(\d+)\/competitions\/\d+\/odds(?:\/(\d+))?$/);
  if (od) {
    if (od[1] === "903" && !od[2]) return { items: [{ $ref: `http://x/events/903/competitions/903/odds/58` }] };
    if (od[1] === "903") return { provider: { name: "ESPN BET" }, spread: 3.5, overUnder: 47.5, homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true } };
    if (od[1] === "904") return { items: [{ provider: { name: "Caesars" }, spread: -9, overUnder: 40 }, { provider: { name: "DraftKings" }, pointSpread: { home: { close: { line: "-2.5" } } }, total: { over: { close: { line: "o44.5" } } } }] };
    return { items: [] };
  }
  const m = url.match(/events\/(\d+)\/competitions\/\d+\/powerindex(?:\/(\d+))?/);
  if (m) {
    const g = slateGames.find((x) => x[0] === +m[1]);
    if (!m[2]) return { items: [{ $ref: `http://x/events/${m[1]}/competitions/${m[1]}/powerindex/${g[2]}` }, { $ref: `http://x/events/${m[1]}/competitions/${m[1]}/powerindex/${g[1]}` }] };
    const tid = +m[2];
    const homeDiff = rankOf(g[1]) - rankOf(g[2]); // better ranked team projected to win by the rank gap
    return { team: { $ref: `http://x/teams/${tid}` }, stats: [{ name: "teampredptdiff", value: tid === g[2] ? homeDiff : -homeDiff }] };
  }
  if (url.startsWith(SITE + "/summary")) throw new Error("not in fixture");
  throw new Error("unexpected URL " + url);
});

try {
  check("half point: home -7 becomes -7.5", halfPoint(-7, true) === -7.5);
  check("half point: home +3 becomes +3.5", halfPoint(3, false) === 3.5);
  check("half point: pick'em gives the dog the half", halfPoint(0, true) === -0.5 && halfPoint(0, false) === 0.5);

  await setKv("config", { season: 2026, currentWeek: null });
  await setKv("rankings", seed);
  let v = await autoView(Date.now(), await getConfig());
  check("view flags a schedule that never ran", v.flags.some((f) => f.key === "never"));

  // ---- Tuesday 1:30 p.m.: the slate builds ----
  let out = await tick({ now: CT("2026-11-03T13:30:00-06:00") });
  check("Tuesday run builds the slate", out.ran && out.ran.slate && out.ran.slate.ok, JSON.stringify(out.ran && out.ran.slate));
  const cfg = await getConfig();
  const w = await getWeek(cfg.currentWeek);
  check("week id and draft status", w && w.id === "2026-w11" && w.status === "draft", w && w.id);
  check("deadline is Saturday 10:15 a.m. CST", w.deadline === "2026-11-07T16:15:00.000Z", w.deadline);
  const order = w.games.map((g) => g.espnId).join(",");
  check("5 top games then 5 tightest", order === "101,102,103,104,105,107,109,108,110,111", order);
  check("whole line gets the half point", w.games.find((g) => g.espnId === "101").homeLine === -7.5);
  check("pick'em gets the half point", w.games.find((g) => g.espnId === "107").homeLine === -0.5);
  check("10 a.m. and Friday games left out", !w.pool.some((g) => ["113", "114"].includes(g.espnId)));
  check("Robo-Sharp has FPI lines", w.games.every((g) => typeof g.modelLine === "number" && g.modelSource === "ESPN FPI"));
  check("pool holds swap options", w.pool.length === 12, String(w.pool.length));
  const a1 = await getKv("auto", {});
  check("no-line game is flagged", a1.flags.some((f) => f.msg.includes("No line yet")));
  check("pick'em is flagged for review", a1.flags.some((f) => f.msg.includes("pick'em")));
  const R1 = await getKv("rankings", {});
  check("AP poll refreshed from ESPN", R1.ap && R1.ap.teams[0].team === "Miami" && R1.ap.teams[0].prev === 2);
  check("FPI covers every team listed", R1.power.fpi.teams.length === 30 && R1.power.fpi.teams.some((t) => t.team === "San José State"));
  check("SP+ kept as loaded", R1.power.sp.teams.length === seed.power.sp.teams.length);
  check("r/CFB poll read from its page", R1.reddit && R1.reddit.teams.length === 25 && R1.reddit.teams[0].team === "Miami" && R1.reddit.teams[0].fpv === 229 && R1.reddit.asOf === "Week 9", JSON.stringify(R1.reddit && R1.reddit.teams[0]));
  check("r/CFB mascots dropped to school names", ["Texas A&M", "Hawai'i", "San José State", "Miami (OH)", "Penn State"].every((n) => R1.reddit.teams.some((t) => t.team === n)));
  check("r/CFB movement read from the change column", R1.reddit.teams[2].prev === 9 && R1.reddit.teams[3].prev === 3 && R1.reddit.teams[4].prev === "NR");
  check("r/CFB others receiving votes", R1.reddit.others.length === 5 && R1.reddit.others[0].team === "UTSA");

  // ---- game log: the first run fills weeks 1 to now ----
  check("first run fills the team game log", out.ran.gamelog && out.ran.gamelog.ok, JSON.stringify(out.ran.gamelog));
  let tg = await getKv("teamGames", {});
  check("game log keeps scores, line, and total", tg.games["901"] && tg.games["901"].hs === 30 && tg.games["901"].l === -6.5 && tg.games["901"].t === 50.5 && tg.games["901"].wk === 9, JSON.stringify(tg.games["901"]));
  check("game log marks the backfill done", !!tg.backfilledAt && tg.weeksDone.includes(9) && tg.weeksDone.includes(10) && !tg.weeksDone.includes(11));
  check("game log leaves out unplayed games", !tg.games["101"]);

  // ---- second Tuesday run does not rebuild ----
  out = await tick({ now: CT("2026-11-03T14:30:00-06:00") });
  check("slate is not rebuilt on the next hour", !(out.ran && out.ran.slate));
  check("game log backfill does not repeat", !out.ran.gamelog);
  check("old lines job runs after the backfill", out.ran.lines && out.ran.lines.ok, JSON.stringify(out.ran.lines));
  tg = await getKv("teamGames", {});
  check("old line read through a linked odds record, favorite on the road", tg.games["903"].l === 3.5 && tg.games["903"].t === 47.5, JSON.stringify(tg.games["903"]));
  check("old line prefers DraftKings and its close line", tg.games["904"].l === -2.5 && tg.games["904"].t === 44.5, JSON.stringify(tg.games["904"]));
  check("scoreboard line kept when only the total was missing", tg.games["902"].l === 3);

  // ---- Wednesday: opens at 6 p.m. ----
  out = await tick({ now: CT("2026-11-04T17:10:00-06:00") });
  check("not open before 6 p.m. Wednesday", (await getWeek("2026-w11")).status === "draft");
  out = await tick({ now: CT("2026-11-04T18:10:00-06:00") });
  check("opens at 6 p.m. Wednesday", (await getWeek("2026-w11")).status === "open", JSON.stringify(out.ran.open));

  // ---- Saturday morning: lines saved for ATS ----
  await tick({ now: CT("2026-11-07T09:10:00-06:00") });
  const st = await getKv("atsAuto", {});
  check("lines saved before kickoff", st.lines && st.lines["101"] === -7, JSON.stringify(st.lines && st.lines["101"]));

  // ---- Saturday afternoon: live scores, a postponement, a failure ----
  live = { 103: { state: "post", completed: true, name: "STATUS_FINAL", away: 10, home: 35 }, 105: { state: "in", completed: false, name: "STATUS_IN_PROGRESS", away: 7, home: 14 }, 108: { state: "pre", completed: false, name: "STATUS_POSTPONED", away: 0, home: 0 } };
  out = await tick({ now: CT("2026-11-07T13:10:00-06:00") });
  let wk = await getWeek("2026-w11");
  check("final score saved", wk.results.e103 && wk.results.e103.final && wk.results.e103.home === 35);
  check("live score saved, not final", wk.results.e105 && !wk.results.e105.final && wk.results.e105.home === 14);
  check("live game keeps quarter and clock", wk.results.e105.period === 3 && wk.results.e105.dclock === "4:12" && wk.results.e105.clock === 252 && !!wk.results.e105.at, JSON.stringify(wk.results.e105));
  check("week records when scores were pulled", !!wk.scoresAt);
  live[105] = { ...live[105], period: 4, dclock: "2:05", clock: 125 };
  await tick({ now: CT("2026-11-07T13:40:00-06:00") });
  wk = await getWeek("2026-w11");
  check("clock moves even when the score does not", wk.results.e105.period === 4 && wk.results.e105.dclock === "2:05" && wk.results.e105.home === 14, JSON.stringify(wk.results.e105));
  let a2 = await getKv("auto", {});
  check("postponed game flagged", a2.flags.some((f) => f.key === "dead:2026-w11:e108"));

  failScoreboard = true;
  out = await tick({ now: CT("2026-11-07T14:10:00-06:00") });
  a2 = await getKv("auto", {});
  check("ESPN failure becomes a flag with the manual fallback", a2.flags.some((f) => f.key === "scores:failed" && f.msg.includes("enter scores by hand")), a2.flags.map((f) => f.key).join(","));
  failScoreboard = false;
  out = await runJob("scores", { now: CT("2026-11-07T14:20:00-06:00") });
  a2 = await getKv("auto", {});
  check("manual Pull scores clears the failure", out.ran.scores.ok && !a2.flags.some((f) => f.key === "scores:failed"));

  // ---- commissioner enters one score by hand ----
  wk = await getWeek("2026-w11");
  wk.results.e109 = { away: 21, home: 20, final: true, void: false, src: "manual" };
  await putWeek(wk);

  // ---- all games end; ESPN says something else for the manual game ----
  live = {};
  for (const g of slateGames) live[g[0]] = { state: "post", completed: true, name: "STATUS_FINAL", away: 17, home: 24 };
  live[108] = { state: "pre", completed: false, name: "STATUS_POSTPONED", away: 0, home: 0 };
  await tick({ now: CT("2026-11-08T00:10:00-06:00") });
  wk = await getWeek("2026-w11");
  check("manual score never overwritten", wk.results.e109.away === 21 && wk.results.e109.src === "manual");
  tg = await getKv("teamGames", {});
  check("hourly run logs finished games with the line saved before kickoff", tg.games["101"] && tg.games["101"].l === -7 && tg.games["101"].hs === 24, JSON.stringify(tg.games["101"]));
  check("postponed game stays out of the game log", !tg.games["108"]);
  const tv = await teamGamesView();
  const g109 = tv.games.find((g) => g.id === "109");
  check("game log shows the hand-entered score", g109 && g109.as === 21 && g109.hs === 20 && g109.hand === true, JSON.stringify(g109));
  check("stored game log keeps ESPN's score", tg.games["109"].as === 17);
  check("week waits on the postponed game", wk.status === "open");

  // ---- commissioner voids the postponed game; next run marks final ----
  wk.results.e108 = { away: 0, home: 0, final: false, void: true, src: "manual" };
  await putWeek(wk);
  await tick({ now: CT("2026-11-08T01:10:00-06:00") });
  wk = await getWeek("2026-w11");
  check("week marked final when every game is final or void", wk.status === "final");
  const snap = await q("select week_id from snapshots");
  check("rankings snapshot saved with the final week", snap.some((r) => r.week_id === "2026-w11"));
  const logs = (await q("select by, action from log")).map((l) => l.by + ": " + l.action);
  check("automation actions are in the public log", logs.includes("Automation: Built the slate from ESPN") && logs.includes("Automation: Marked week final") && logs.includes("Automation: Opened picks"));

  // ---- ATS records added from finished games ----
  const R2 = await getKv("rankings", {});
  const uga = R2.ats.teams.find((t) => t.team === "Georgia"), uga0 = seed.ats.teams.find((t) => t.team === "Georgia");
  // UGA won 24-17 as a 7 point favorite: a push.
  check("ATS push recorded for a game landing on the number", uga.ats.split("-")[2] === String(Number(uga0.ats.split("-")[2]) + 1), uga0.ats + " -> " + uga.ats);
  const before = JSON.stringify(R2.ats);
  await tick({ now: CT("2026-11-08T02:10:00-06:00") });
  check("ATS games are counted once", JSON.stringify((await getKv("rankings", {})).ats.teams) === JSON.stringify(R2.ats.teams));

  // ---- r/CFB poll: a page change becomes a flag, and the paste fallback works ----
  redditHtml = "<html><body><h1>2026 Week 10</h1><div>new layout</div></body></html>";
  out = await runJob("rankings", { now: CT("2026-11-08T02:30:00-06:00") });
  let a6 = await getKv("auto", {});
  check("changed r/CFB page flags with the paste fallback", !out.ran.rankings.ok && a6.flags.some((f) => f.key === "rankings:failed" && f.msg.includes("r/CFB poll") && f.msg.includes("poll.redditcfb.com")), out.ran.rankings.msg);
  check("other rankings still saved when r/CFB fails", (await getKv("rankings", {})).reddit.asOf === "Week 9");
  const pasted = parseRedditText(pastedTable);
  check("pasted r/CFB table reads the same as the page", pasted.teams.length === 25 && pasted.teams[21].team === "Hawai'i" && pasted.teams[0].fpv === 229 && pasted.asOf === "Week 9");
  let threw = false; try { parseRedditText("not a poll"); } catch { threw = true; }
  check("pasting something else is refused", threw);
  redditHtml = redditPage(9);

  // ---- old lines: a feed with nothing to give stops the job ----
  tg = await getKv("teamGames", {});
  for (let i = 0; i < 12; i++) tg.games["77" + i] = { id: "77" + i, wk: 2, d: "2026-09-06T17:00:00Z", a: "Rice", h: "Navy", as: 10, hs: 20, n: false, l: null, t: null };
  await setKv("teamGames", tg);
  out = await runJob("lines", { now: CT("2026-11-08T03:00:00-06:00") });
  let a5 = await getKv("auto", {});
  check("empty odds feed stops the lines job with a flag", !out.ran.lines.ok && a5.flags.some((f) => f.key === "lines:failed" && f.msg.includes("points only")), out.ran.lines.msg);
  out = await tick({ now: CT("2026-11-08T04:10:00-06:00") });
  check("stopped lines job does not run on the schedule", !out.ran.lines);

  // ---- the schedule stops: a stale flag shows ----
  v = await autoView(CT("2026-11-08T08:00:00-06:00"), await getConfig());
  check("missed schedule shows a flag", v.flags.some((f) => f.key === "stale"));

  // ---- game log rechecks the last two weeks on Sunday; a failed week becomes a flag ----
  failWeek = 10;
  out = await tick({ now: CT("2026-11-08T09:30:00-06:00") });
  let a4 = await getKv("auto", {});
  check("Sunday run rechecks the game log", out.ran.gamelog && out.ran.gamelog.ok, JSON.stringify(out.ran.gamelog));
  check("a week ESPN skips becomes a flag", a4.flags.some((f) => f.job === "gamelog" && f.msg.includes("week 10")), a4.flags.map((f) => f.key).join(","));
  failWeek = null;
  out = await tick({ now: CT("2026-11-08T10:30:00-06:00") });
  check("Sunday recheck runs once", !out.ran.gamelog);
  out = await runJob("gamelog", { force: true, now: CT("2026-11-08T10:40:00-06:00") });
  a4 = await getKv("auto", {});
  check("Fill game log button refills and clears the flag", out.ran.gamelog.ok && !a4.flags.some((f) => f.job === "gamelog"), out.ran.gamelog.msg);

  // ---- pause ----
  await setKv("config", { ...(await getConfig()), autoPaused: true });
  out = await tick({ now: CT("2026-11-10T14:00:00-06:00") });
  check("paused automation does nothing on the schedule", out.paused === true);
  out = await runJob("slate", { now: CT("2026-11-10T14:00:00-06:00") });
  // The fake ESPN has no games on Nov 14, so the button runs and reports that plainly.
  const a3 = await getKv("auto", {});
  check("buttons still run while paused", out.ran.slate && !out.ran.slate.ok && a3.flags.some((f) => f.key === "slate:failed" && f.msg.includes("paste a slate")), out.ran.slate && out.ran.slate.msg);

  // ---- choose rule with fewer than 10 games ----
  const few = chooseGames([{ away: {}, home: {}, homeLine: 3.5, r: 3 }], (g, s) => (s === "home" ? g.r : null));
  check("short weeks still build", few.chosen.length === 1);
} catch (e) {
  check("test run", false, e.stack);
} finally {
  for (const r of results) console.log(r.join("  "));
}
