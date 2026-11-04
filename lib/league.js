import { halfPoint } from "./espn.js";
// League rules shared by the API: week status, validation, and the state sent to the page.
import { q, one, getKv, setKv } from "./db.js";
import { autoView, liveRun } from "./auto.js";
import { canon } from "./teams.js";

export const SWATCH = ["#B3121D", "#E8590C", "#F2B705", "#1E7A3A", "#0F7C80", "#4BA3E3", "#1D4ED8", "#13294B", "#5B2C83", "#D6336C", "#6E1423", "#6B4423", "#9AA3AD", "#FFFFFF", "#111111"];

export const DEFAULT_CONFIG = { name: "Tator's Picks", season: 2026, currentWeek: null, survivorStart: null, survivorEnd: process.env.SURVIVOR_END || "2026-11-29T06:00:00Z", teamOverrides: {}, scored: true, autoOpen: true, autoPaused: false };

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
  if (old && effectiveStatus(old) !== "draft") throw Object.assign(new Error("That week is already open. Picks cannot be changed under players."), { code: 409 });
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

// Survivor ends at config.survivorEnd (2026: end of the Saturday Nov 28 week). The page reads the same setting.
export function survivorClosed(w, config) {
  const d = w && (w.origDeadline || w.deadline);
  return !!(config.survivorEnd && d && Date.parse(d) >= Date.parse(config.survivorEnd));
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

// Teams this player already used in Survivor before the given week.
export async function survivorUsed(playerId, weekId, config) {
  if (!config.survivorStart) return [];
  const rows = await q(
    "select p.week_id, p.data as pick, w.data as week from picks p join weeks w on w.id = p.week_id where p.player_id = $1 and p.week_id >= $2 and p.week_id < $3",
    [playerId, config.survivorStart, weekId]
  );
  const used = [];
  for (const r of rows) {
    if (!isPastDeadline(r.week)) continue;
    const s = r.pick && r.pick.surv;
    const g = s && (r.week.games || []).find((x) => x.id === s.g);
    if (g) used.push(teamFor(g, s.s));
  }
  return used;
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
    me: { ...publicPlayer(me), phone: me.phone },
    config: { ...config, removed: players.filter((p) => p.removed).map((p) => p.id) },
    players: players.map(publicPlayer),
    roster: [...roster],
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
  }
  return state;
}

// What a page reports for the commissioner's engagement view: tabs opened and Recaps read.
// The page sends this in small batches, never on a poll, so it adds few database writes.
const ENGAGE_PAGES = ["picks", "standings", "recap", "rankings", "players", "survivor", "playoffs", "rules", "profile"];
export async function recordEngage(me, b, now = Date.now()) {
  const row = await one("select data from engage where player_id = $1", [me.id]);
  const d = (row && row.data) || { pages: {}, recaps: {}, days: 0 };
  const iso = new Date(now).toISOString();
  if ((d.last || "").slice(0, 10) !== iso.slice(0, 10)) d.days = (d.days || 0) + 1;
  d.last = iso;
  for (const [k, n] of Object.entries((b && b.pages) || {})) {
    if (ENGAGE_PAGES.includes(k) && Number.isInteger(n) && n > 0) d.pages[k] = (d.pages[k] || 0) + Math.min(n, 100);
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
  if (!tg) return { games: [], updatedAt: null, backfilledAt: null };
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
  return { games: Object.values(games), updatedAt: tg.updatedAt || null, backfilledAt: tg.backfilledAt || null };
}
