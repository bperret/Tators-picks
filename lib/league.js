import { halfPoint } from "./espn.js";
// League rules shared by the API: week status, validation, and the state sent to the page.
import { q, one, getKv, setKv } from "./db.js";
import { autoView, liveRun } from "./auto.js";
import { canon } from "./teams.js";
import { awardsView } from "./awards.js";

export const SWATCH = ["#B3121D", "#E8590C", "#F2B705", "#1E7A3A", "#0F7C80", "#4BA3E3", "#1D4ED8", "#13294B", "#5B2C83", "#D6336C", "#6E1423", "#6B4423", "#9AA3AD", "#FFFFFF", "#111111"];

// Survivor runs for 2026 (item 10, Nov 15). A week belongs to the run whose window holds its Saturday deadline.
// Run 1: no team twice. Run 2 (Nov 21 week through Conference Champion Week): each pick burns the team's conference.
// When SURVIVOR_END is set (the test server), there are no default runs and one team run lasts to that date, as before.
export const RUNS_2026 = [
  { n: 1, from: null, to: "2026-11-15T06:00:00Z", rule: "team" },
  { n: 2, from: "2026-11-15T06:00:00Z", to: "2026-12-06T06:00:00Z", rule: "conf" },
];
export const DEFAULT_CONFIG = { name: "Tator's Picks", season: 2026, currentWeek: null, survivorStart: null, survivorEnd: process.env.SURVIVOR_END || "2026-12-06T06:00:00Z", survivorRuns: process.env.SURVIVOR_END ? null : RUNS_2026, teamOverrides: {}, scored: true, autoOpen: true, autoPaused: false };

export async function getConfig() {
  return { ...DEFAULT_CONFIG, ...(await getKv("config", {})) };
}

// The server clock decides when picks lock. A stored "open" week past its deadline is locked.
export async function getWeek(id) {
  const r = await one("select data from weeks where id = $1", [id]);
  return r ? r.data : null;
}

export async function putWeek(w) {
  await q(
    "insert into weeks (id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
    [w.id, JSON.stringify(w)]
  );
}

// Saves a slate as a draft and makes it the current week. Refuses once picks are open.
export async function saveDraft(w) {
  const old = await getWeek(w.id);
  if (old && effectiveStatus(old) !== "draft") throw Object.assign(new Error("That week is already open. Picks cannot be changed under pickers."), { code: 409 });
  const week = { swaps: [], results: {}, pool: w.games, ...w, scored: true, status: "draft" };
  await putWeek(week);
  const cfg = await getConfig();
  cfg.currentWeek = w.id;
  if (!cfg.survivorStart) cfg.survivorStart = w.id;
  await setKv("config", cfg);
  return week;
}

// Keeps a copy of the rankings with a finished week, so movement shows the next week.
export async function snapshotRankings(weekId) {
  const r = await getKv("rankings", null);
  if (r) await q("insert into snapshots (week_id, data) values ($1, $2::jsonb) on conflict (week_id) do nothing", [weekId, JSON.stringify(r)]);
}

export function effectiveStatus(week, now = Date.now()) {
  if (!week) return null;
  if (week.status === "open" && now >= Date.parse(week.deadline)) return "locked";
  return week.status;
}

export function isPastDeadline(week, now = Date.now()) {
  return now >= Date.parse(week.deadline);
}

export function isOneEmoji(s) {
  if (typeof s !== "string" || !s.trim() || s.length > 16) return false;
  const seg = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s.trim())];
  return seg.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(seg[0].segment);
}

export function publicPlayer(p) {
  return { id: p.id, name: p.name, emoji: p.emoji, c1: p.c1, c2: p.c2, removed: p.removed, setupDone: p.setup_done, isCommish: p.is_commish };
}

function teamFor(g, side) {
  return side === "home" ? g.home : g.away;
}

// Survivor runs. config.survivorRuns lists them; with none saved, one team run lasts to config.survivorEnd.
export function survivorRuns(config) {
  const r = Array.isArray(config.survivorRuns) && config.survivorRuns.length ? config.survivorRuns : null;
  return r || [{ n: 1, from: null, to: config.survivorEnd || null, rule: "team" }];
}
// The run a week belongs to, by its Saturday deadline, or null when Survivor is not running that week.
export function survivorRunOf(w, config) {
  if (!w || !config.survivorStart || w.id < config.survivorStart) return null;
  const d = w.origDeadline || w.deadline;
  const t = d ? Date.parse(d) : NaN;
  if (!Number.isFinite(t)) return null;
  return survivorRuns(config).find((r) => (!r.from || t >= Date.parse(r.from)) && (!r.to || t < Date.parse(r.to))) || null;
}
export function survivorClosed(w, config) {
  return !survivorRunOf(w, config);
}
// Conference group for the conference lock: from the ATS list in rankings. Independents are one group.
// A team with no known conference is its own group, so it only blocks itself.
export function confMap(rankings) {
  const m = {};
  for (const t of (rankings && rankings.ats && rankings.ats.teams) || []) if (t && t.team) m[canon(t.team)] = t.conf || "";
  return m;
}
// The Survivor save check, shared with the tests. Returns an error message, or null when the pick is allowed.
// rule "team": no team twice in the run. rule "conf": a burned conference is refused unless no team on the slate is legal (free pick).
export function survivorCheck({ rule, team, games, voids = new Set(), usedTeams = [], burned = new Set(), map = {} }) {
  if (rule === "conf") {
    const conf = confOf(team, map);
    const legal = games.filter((x) => !voids.has(x.id)).some((x) => !burned.has(confOf(x.home, map)) || !burned.has(confOf(x.away, map)));
    return burned.has(conf) && legal ? `You already burned the ${conf.startsWith("team:") ? team : conf} in this Survivor run.` : null;
  }
  return usedTeams.map(canon).includes(canon(team)) ? `You already used ${team} in Survivor.` : null;
}
export function confOf(team, map) {
  const c = map[canon(team)];
  return c ? (/independ/i.test(c) ? "Independents" : c) : "team:" + canon(team);
}

// Closing line for each slate game that has kicked off, with the same half-point rule as the locked line.
// Beat the close compares these to each game's homeLine.
export function closingLines(weeks, ats, tg, now) {
  const out = {};
  const saved = (ats && ats.lines) || {}, logged = (tg && tg.games) || {};
  for (const w of weeks) for (const g of w.games || []) {
    if (!String(g.id).startsWith("e") || Date.parse(g.kickoff) > now) continue;
    const id = String(g.id).slice(1);
    const raw = saved[id] != null ? saved[id] : logged[id] ? logged[id].l : null;
    if (raw != null) out[g.id] = halfPoint(raw, raw < 0);
  }
  return out;
}

// The game log is large, so read it only when a started game has no saved line.
async function closingFor(weeks, now) {
  const ats = await getKv("atsAuto", {});
  const saved = ats.lines || {};
  const missing = weeks.some((w) => (w.games || []).some((g) => String(g.id).startsWith("e") && Date.parse(g.kickoff) <= now && saved[String(g.id).slice(1)] == null));
  return closingLines(weeks, ats, missing ? await getKv("teamGames", null) : null, now);
}

// Survivor picks this player made before the given week, in the same run only, so each run starts fresh.
// Returns teams for the no-repeat rule and conferences for the conference lock (saved on the pick, else from the map).
export async function survivorUsed(playerId, weekId, config, run, map = {}) {
  if (!config.survivorStart) return { teams: [], confs: [] };
  const rows = await q(
    "select p.week_id, p.data as pick, w.data as week from picks p join weeks w on w.id = p.week_id where p.player_id = $1 and p.week_id >= $2 and p.week_id < $3",
    [playerId, config.survivorStart, weekId]
  );
  const teams = [], confs = [];
  for (const r of rows) {
    if (!isPastDeadline(r.week)) continue;
    const pr = survivorRunOf(r.week, config);
    if (run && (!pr || pr.n !== run.n)) continue;
    const s = r.pick && r.pick.surv;
    const g = s && (r.week.games || []).find((x) => x.id === s.g);
    if (!g) continue;
    const team = teamFor(g, s.s);
    teams.push(team);
    confs.push(s.c || confOf(team, map));
  }
  return { teams, confs };
}

// One check for a pick sheet, used by a picker's own save (api/picks.js) and the commissioner's
// Enter sheet (api/admin.js, enterSheet). It checks the sheet only, not the lock; callers check status.
// Returns { data } or { error, status }.
export async function checkSheet(w, b, playerId, config) {
  const games = w.games || [];
  const ids = new Set(games.map((g) => g.id));
  const voids = new Set(Object.entries(w.results || {}).filter(([, r]) => r && r.void).map(([k]) => k));
  const sel = {};
  for (const [gid, side] of Object.entries(b.sel || {})) {
    if (!ids.has(gid) || voids.has(gid)) continue;
    if (side !== "home" && side !== "away") return { status: 400, error: "A pick must be home or away." };
    sel[gid] = side;
  }
  const lock = b.lock || null;
  if (lock && !sel[lock]) return { status: 400, error: "Pick a side in your field goal game first." };
  let tb = b.tb;
  if (tb === "" || tb === undefined) tb = null;
  if (tb !== null && (!Number.isInteger(tb) || tb < 0 || tb > 200)) return { status: 400, error: "The tiebreaker must be a whole number from 0 to 200." };
  let surv = null;
  if (b.surv) {
    if (!config.survivorStart || w.id < config.survivorStart) return { status: 400, error: "Survivor has not started." };
    const run = survivorRunOf(w, config);
    if (!run) return { status: 400, error: "Survivor is over for this season." };
    const g = games.find((x) => x.id === b.surv.g);
    if (!g || voids.has(g.id) || (b.surv.s !== "home" && b.surv.s !== "away")) return { status: 400, error: "That survivor pick is not on this slate." };
    const team = b.surv.s === "home" ? g.home : g.away;
    // Run 2 conference lock or the no-repeat team rule, checked by survivorCheck.
    const map = run.rule === "conf" ? confMap(await getKv("rankings", null)) : {};
    const prior = await survivorUsed(playerId, w.id, config, run, map);
    const err = survivorCheck({ rule: run.rule, team, games, voids, usedTeams: prior.teams, burned: new Set(prior.confs), map });
    if (err) return { status: 400, error: err };
    surv = run.rule === "conf" ? { g: g.id, s: b.surv.s, c: confOf(team, map) } : { g: g.id, s: b.surv.s };
  }
  return { data: { sel, lock, tb, surv } };
}

export function saveNote(prev, d, week, abbr) {
  const parts = [];
  const n = Object.keys(d.sel).length;
  const name = (gid, side) => {
    const g = week.games.find((x) => x.id === gid);
    return g ? abbr(teamFor(g, side)) : "?";
  };
  if (!prev) parts.push(`Saved ${n} pick${n === 1 ? "" : "s"}`);
  else {
    let ch = 0;
    for (const g of week.games) if ((prev.sel || {})[g.id] !== d.sel[g.id]) ch++;
    if (ch) parts.push(`Changed ${ch} pick${ch === 1 ? "" : "s"}`);
  }
  if (d.lock && (!prev || prev.lock !== d.lock)) parts.push("field goal on " + name(d.lock, d.sel[d.lock]));
  if (d.tb != null && (!prev || prev.tb !== d.tb)) parts.push("tiebreaker " + d.tb);
  if (d.surv && (!prev || !prev.surv || prev.surv.g !== d.surv.g || prev.surv.s !== d.surv.s)) parts.push("survivor " + name(d.surv.g, d.surv.s));
  return parts.join(", ") || "Saved with no changes";
}

// Everything the page needs for one signed-in player.
// poll: a logged in page asked, so overdue scores or the open may run first.
export async function buildState(me, { poll = false, now = Date.now() } = {}) {
  let config = await getConfig();
  const players = await q("select * from players order by created_at");
  let weekRows = await q("select id, data from weeks order by id");
  if (poll) {
    try {
      if (await liveRun(weekRows.map((r) => r.data), config, now)) {
        config = await getConfig();
        weekRows = await q("select id, data from weeks order by id");
      }
    } catch (e) { console.error("page visit run", e); } // a job problem never blocks the page
  }
  const weeks = {};
  for (const r of weekRows) {
    const w = r.data;
    const status = effectiveStatus(w, now);
    if (status === "draft" && !me.is_commish) continue; // drafts are the commissioner's only
    weeks[r.id] = { ...w, status };
  }
  const pickRows = await q("select player_id, week_id, data, updated_at from picks");
  const histRows = await q("select player_id, week_id, at, note from pick_history order by at");
  const hist = {};
  for (const h of histRows) {
    const k = h.player_id + "|" + h.week_id;
    (hist[k] = hist[k] || []).push({ at: new Date(h.at).toISOString(), note: h.note });
  }
  const reveals = {};
  const myPicks = { weeks: {} };
  const roster = new Set();
  // Pickers with at least one game picked on any sheet. Ids only, never sides.
  const pickedIn = new Set();
  // Class year: the season of each picker's first sheet with a game picked. Start over deletes picks, so it resets on its own.
  const seasonOf = {};
  for (const r of weekRows) seasonOf[r.id] = r.data && r.data.season;
  const classOf = {};
  const sheetCount = {};
  // For the commissioner: what each sheet has filled in, never which side. Game ids only.
  const sheetStatus = {};
  for (const r of pickRows) {
    const d = r.data || {};
    (sheetStatus[r.week_id] = sheetStatus[r.week_id] || {})[r.player_id] = {
      games: Object.keys(d.sel || {}).filter((k) => d.sel[k]), flag: !!d.lock, tb: d.tb != null, surv: !!d.surv, at: new Date(r.updated_at).toISOString(),
    };
  }
  for (const r of pickRows) {
    const w = weeks[r.week_id];
    roster.add(r.player_id);
    if (Object.values((r.data || {}).sel || {}).some(Boolean)) {
      pickedIn.add(r.player_id);
      const s = seasonOf[r.week_id];
      if (s && (!classOf[r.player_id] || s < classOf[r.player_id])) classOf[r.player_id] = s;
    }
    sheetCount[r.week_id] = (sheetCount[r.week_id] || 0) + 1;
    const obj = { ...r.data, history: hist[r.player_id + "|" + r.week_id] || [] };
    if (r.player_id === me.id) myPicks.weeks[r.week_id] = obj;
    if (w && isPastDeadline(w, now)) {
      const p = players.find((x) => x.id === r.player_id);
      if (p && p.removed) continue;
      (reveals[r.week_id] = reveals[r.week_id] || { players: {}, lockedAt: w.deadline, excluded: [] }).players[r.player_id] = obj;
    }
  }
  const snapRows = await q("select week_id, data from snapshots");
  const history = {};
  for (const s of snapRows) history[s.week_id] = s.data;
  const log = (await q("select at, by, action, detail from log order by at desc limit 100")).map((l) => ({ ...l, at: new Date(l.at).toISOString() }));
  // Players never get a draft, but they can know one is coming and when it opens.
  let upcoming = null;
  const curRow = weekRows.find((r) => r.id === config.currentWeek);
  if (curRow && effectiveStatus(curRow.data, now) === "draft" && !me.is_commish) {
    const d = new Date(Date.parse(curRow.data.deadline) - 3 * 86400e3);
    upcoming = { week: curRow.data.week, autoOpen: config.autoOpen !== false, opens: d.toISOString() };
  }
  // What pickers see before picks open: the draft once it exists, else the saved preview.
  // Games, ranks, and lines only. Model lines stay out.
  let preview = null;
  const pvGames = (gs) => gs.map(({ id, slot, away, awayRank, home, homeRank, homeLine, kickoff, neutral }) => ({ id, slot, away, awayRank, home, homeRank, homeLine, kickoff, neutral }));
  if (curRow && effectiveStatus(curRow.data, now) === "draft") {
    preview = { week: curRow.data.week, set: true, autoOpen: config.autoOpen !== false, linesAt: curRow.data.linesAt || curRow.data.builtAt || null, games: pvGames(curRow.data.games) };
  } else {
    const pv = await getKv("preview", null);
    if (pv && now < Date.parse(pv.deadline) && !weekRows.some((r) => r.id === pv.id)) preview = { week: pv.week, set: false, autoOpen: config.autoOpen !== false, linesAt: pv.linesAt, games: pvGames(pv.games) };
  }
  // Who has a sheet in for the current week. Names only, never picks.
  const sheetsIn = config.currentWeek ? pickRows.filter((r) => r.week_id === config.currentWeek).map((r) => r.player_id) : [];
  const state = {
    now: new Date(now).toISOString(),
    upcoming,
    preview,
    sheetsIn,
    awards: await awardsView(me, players, now),
    // GroupMe cards Benton marked Posted, newest first, without the image (item 66). The page fetches an image only when unseen.
    gmCards: (await q("select key, kind, wid, posted_at from gm_cards order by posted_at desc limit 10")).map((r) => ({ key: r.key, kind: r.kind, wid: r.wid, at: new Date(r.posted_at).toISOString() })),
    me: { ...publicPlayer(me), phone: me.phone },
    config: { ...config, removed: players.filter((p) => p.removed).map((p) => p.id) },
    players: players.map(publicPlayer),
    roster: [...roster],
    pickedIn: [...pickedIn],
    classOf,
    weeks,
    reveals,
    myPicks,
    closing: await closingFor(weekRows.map((r) => r.data), now),
    rankings: await getKv("rankings", null),
    history,
    log,
  };
  if (me.is_commish) {
    state.logins = players.map((p) => ({
      ...publicPlayer(p),
      phone: p.phone,
      invited: p.invited,
      lockedUntil: p.locked_until ? new Date(p.locked_until).toISOString() : null,
      lockouts: p.lockouts,
    }));
    state.sheetCount = sheetCount;
    state.sheetStatus = sheetStatus;
    state.auto = await autoView(now, config);
    state.engage = Object.fromEntries((await q("select player_id, data from engage")).map((r) => [r.player_id, r.data]));
    // GroupMe tab: which announcement posts the commissioner marked Posted.
    state.groupme = await getKv("groupme", { posted: {} });
  }
  return state;
}

// What a page reports for the commissioner's engagement view: tabs opened and Recaps read.
// The page sends this in small batches, never on a poll, so it adds few database writes.
const ONBOARD_STEPS = ["welcome", "suit", "jersey", "rules", "skip", "sheet"];
const ENGAGE_PAGES = ["scoreboard", "picks", "standings", "recap", "rankings", "players", "survivor", "playoffs", "rules", "profile", "awards"];
export async function recordEngage(me, b, now = Date.now()) {
  const row = await one("select data from engage where player_id = $1", [me.id]);
  const d = (row && row.data) || { pages: {}, recaps: {}, days: 0 };
  const iso = new Date(now).toISOString();
  if ((d.last || "").slice(0, 10) !== iso.slice(0, 10)) d.days = (d.days || 0) + 1;
  d.last = iso;
  for (const [k, n] of Object.entries((b && b.pages) || {})) {
    if (ENGAGE_PAGES.includes(k) && Number.isInteger(n) && n > 0) d.pages[k] = (d.pages[k] || 0) + Math.min(n, 100);
  }
  // First login walk-on steps, first time only.
  if (b && ONBOARD_STEPS.includes(b.onboard)) {
    d.onboard = d.onboard || {};
    if (!d.onboard[b.onboard]) d.onboard[b.onboard] = iso;
  }
  // Latest GroupMe card on open (item 66): the first view of each card, per picker.
  if (b && typeof b.cardSeen === "string" && /^[a-z]{2,5}:[\w-]{4,12}$/.test(b.cardSeen)) {
    d.cards = d.cards || {};
    if (!d.cards[b.cardSeen]) d.cards[b.cardSeen] = iso;
    d.cards = Object.fromEntries(Object.entries(d.cards).sort((x, y) => (x[1] < y[1] ? 1 : -1)).slice(0, 30));
  }
  for (const wid of [].concat((b && b.recaps) || []).slice(0, 5)) {
    if (/^\d{4}-w\d{2}$/.test(wid) && !d.recaps[wid]) d.recaps[wid] = iso;
  }
  await q("insert into engage (player_id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (player_id) do update set data = excluded.data, updated_at = now()", [me.id, JSON.stringify(d)]);
}

export async function commishExists() {
  return !!(await one("select id from players where is_commish = true limit 1"));
}

export function validateWeek(w) {
  const errs = [];
  if (!w || typeof w !== "object") return ["The slate is not valid JSON."];
  if (!/^\d{4}-w\d{2}$/.test(w.id || "")) errs.push('The week id must look like "2026-w10".');
  if (!Number.isInteger(w.week)) errs.push("week must be a number.");
  if (!Number.isInteger(w.season)) errs.push("season must be a number.");
  if (!w.deadline || isNaN(Date.parse(w.deadline))) errs.push("deadline must be a date and time.");
  if (!Array.isArray(w.games) || !w.games.length) errs.push("games must list the slate games.");
  const ids = new Set();
  for (const g of w.games || []) {
    if (!g.id || ids.has(g.id)) errs.push("Every game needs a unique id.");
    ids.add(g.id);
    if (!g.away || !g.home) errs.push(`Game ${g.id}: away and home teams are required.`);
    if (typeof g.homeLine !== "number" || Math.abs(g.homeLine % 1) !== 0.5) errs.push(`Game ${g.id}: homeLine must be a half point number.`);
    if (!g.kickoff || isNaN(Date.parse(g.kickoff))) errs.push(`Game ${g.id}: kickoff must be a date and time.`);
    if (!Number.isInteger(g.slot)) errs.push(`Game ${g.id}: slot must be a number.`);
  }
  return errs;
}

// The team game log for the Teams views. Sent only when Teams opens, so the
// main state stays small. A score the commissioner entered by hand wins over ESPN's.
export async function teamGamesView() {
  const tg = await getKv("teamGames", null);
  const standings = await getKv("confStandings", null);
  if (!tg) return { games: [], updatedAt: null, backfilledAt: null, standings };
  const games = { ...tg.games };
  for (const r of await q("select data from weeks")) {
    const w = r.data;
    for (const g of w.games || []) {
      const res = w.results && w.results[g.id];
      if (!g.espnId || !games[g.espnId] || !res || res.src !== "manual" || res.void || !res.final) continue;
      const row = games[g.espnId];
      const flip = canon(row.h) === canon(g.away) && canon(row.a) === canon(g.home);
      games[g.espnId] = { ...row, as: flip ? res.home : res.away, hs: flip ? res.away : res.home, hand: true };
    }
  }
  return { games: Object.values(games), updatedAt: tg.updatedAt || null, backfilledAt: tg.backfilledAt || null, standings };
}
