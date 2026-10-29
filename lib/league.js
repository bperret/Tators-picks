// League rules shared by the API: week status, validation, and the state sent to the page.
import { q, one, getKv } from "./db.js";

export const SWATCH = ["#B3121D", "#E8590C", "#F2B705", "#1E7A3A", "#0F7C80", "#4BA3E3", "#1D4ED8", "#13294B", "#5B2C83", "#D6336C", "#6E1423", "#6B4423", "#9AA3AD", "#FFFFFF", "#111111"];

export const DEFAULT_CONFIG = { name: "Tator's Picks", season: 2026, currentWeek: null, survivorStart: null, teamOverrides: {} };

export async function getConfig() {
  return { ...DEFAULT_CONFIG, ...(await getKv("config", {})) };
}

// The server clock decides when picks lock. A stored "open" week past its deadline is locked.
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
  if (d.lock && (!prev || prev.lock !== d.lock)) parts.push("flag on " + name(d.lock, d.sel[d.lock]));
  if (d.tb != null && (!prev || prev.tb !== d.tb)) parts.push("tiebreaker " + d.tb);
  if (d.surv && (!prev || !prev.surv || prev.surv.g !== d.surv.g || prev.surv.s !== d.surv.s)) parts.push("survivor " + name(d.surv.g, d.surv.s));
  return parts.join(", ") || "Saved with no changes";
}

// Everything the page needs for one signed-in player.
export async function buildState(me) {
  const now = Date.now();
  const config = await getConfig();
  const players = await q("select * from players order by created_at");
  const weekRows = await q("select id, data from weeks order by id");
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
  const state = {
    now: new Date(now).toISOString(),
    me: { ...publicPlayer(me), phone: me.phone },
    config: { ...config, removed: players.filter((p) => p.removed).map((p) => p.id) },
    players: players.map(publicPlayer),
    roster: [...roster],
    weeks,
    reveals,
    myPicks,
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
  }
  return state;
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
