// Backup score sources for when ESPN refuses or fails (Nov 21, 1.58, Benton: "build the backup as suggested").
// Order: NCAA.com's scoreboard (through the open source ncaa-api), then The Odds API (needs ODDS_API_KEY).
// Each source returns the same shape as espn.parseScoreboard, so the scores job reads it the same way:
// { source, games: [{ espnId: null, kickoff, away: {name, score}, home: {name, score}, state, completed,
//   statusText, period, clock, displayClock, dead }] }. Team names are turned into our names (canon) here.
// Neither feed shape was seen live from a Claude session (the workspace reaches neither site). The parsers
// follow the published shapes and throw a plain message when the data does not look right.
import { ALIAS, canon } from "./teams.js";

export const NCAA_BASE = (process.env.NCAA_API_URL || "https://ncaa-api.henrygd.me").replace(/\/$/, "");
export const ODDS_BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/scores";
export const ODDS_FLOOR = 25; // stop using the free 500 credits a month once this few are left
export const SOURCE_NAME = { espn: "ESPN", ncaa: "NCAA.com", odds: "The Odds API" };

let fetcher = null;
// Tests swap the network for saved answers. fn(url) returns { status, json, headers }.
export function setBackupFetcher(fn) { fetcher = fn; }

async function get(url, host) {
  if (fetcher) return fetcher(url);
  let r;
  try {
    r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (tators-picks)" }, signal: AbortSignal.timeout(12000) });
  } catch (e) {
    throw new Error(`Could not reach ${host} (${e.name === "TimeoutError" ? "timed out" : e.message}).`);
  }
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json, headers: { remaining: r.headers.get("x-requests-remaining") } };
}

// ---------- team names ----------
const key = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
// NCAA.com short names shorten words ("Ohio St.", "Western Mich.", "Fla. Atlantic", "Southern Miss.").
const ABBR = { "st": "State", "mich": "Michigan", "fla": "Florida", "ga": "Georgia", "ill": "Illinois", "ky": "Kentucky", "ark": "Arkansas",
  "miss": "Mississippi", "ala": "Alabama", "tenn": "Tennessee", "la": "Louisiana", "ind": "Indiana", "ariz": "Arizona", "colo": "Colorado",
  "wash": "Washington", "conn": "Connecticut", "cent": "Central", "so": "Southern", "int'l": "International", "intl": "International" };
export function expand(n) {
  return String(n || "").replace(/\(([A-Z]{2})\)/g, " $1 ").split(/\s+/).map((w) => {
    const b = w.replace(/\.$/, "").toLowerCase();
    return ABBR[b] && (w.endsWith(".") || b === "st") ? ABBR[b] : w;
  }).join(" ").trim();
}
// Our name for a backup feed's team. Exact names and aliases first; else the longest known name the
// text starts with, so mascots drop off ("Ohio State Buckeyes" is Ohio State, "Texas Tech Red Raiders" is
// Texas Tech, not Texas). `extra` adds the slate's own names, in case one is missing from ALIAS.
export function teamOf(name, extra = []) {
  const cands = [expand(name), String(name || "")];
  const known = new Map(Object.entries(ALIAS));
  for (const n of extra) known.set(key(n), canon(n));
  for (const c of cands) { const k = key(c); if (known.has(k)) return known.get(k); }
  let best = null, bl = 0;
  for (const c of cands) {
    const k = key(c);
    for (const [kk, v] of known) if (kk.length > bl && k.startsWith(kk)) { best = v; bl = kk.length; }
  }
  return best || String(name || "");
}

// ---------- NCAA.com ----------
const DEAD = /cancel|postpon|suspend|forfeit/i;
const ORD = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };
function clockSecs(s) {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}
export function parseNcaa(data, extra = []) {
  if (!data || !Array.isArray(data.games)) throw new Error("NCAA.com scoreboard has no games list.");
  const games = [];
  for (const row of data.games) {
    const g = row && row.game;
    if (!g || !g.away || !g.home) continue;
    const nm = (t) => (t.names && (t.names.short || t.names.char6 || t.names.full)) || "";
    const sc = (t) => (t.score === "" || t.score == null ? null : Number(t.score));
    const gs = String(g.gameState || "").toLowerCase();
    const per = String(g.currentPeriod || "").trim();
    const perU = per.toUpperCase();
    const fin = gs === "final" || perU.startsWith("FINAL");
    const live = !fin && (gs === "live" || gs === "in");
    let period = null;
    if (ORD[per.toLowerCase()]) period = ORD[per.toLowerCase()];
    else if (/OT/.test(perU)) period = 5;
    else if (perU === "HALF" || perU === "HALFTIME") period = 2;
    const half = perU === "HALF" || perU === "HALFTIME";
    const dclock = live && !half && g.contestClock ? String(g.contestClock).replace(/^0(\d:)/, "$1") : null;
    const statusText = fin ? (/OT/.test(perU) ? "Final/OT" : "Final") : half ? "Halftime" : live ? [dclock, per].filter(Boolean).join(" - ") : String(g.startTime || "");
    const epoch = Number(g.startTimeEpoch);
    games.push({
      espnId: null,
      kickoff: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : null,
      away: { name: teamOf(nm(g.away), extra), score: sc(g.away), rank: null },
      home: { name: teamOf(nm(g.home), extra), score: sc(g.home), rank: null },
      state: fin ? "post" : live ? "in" : "pre",
      completed: fin,
      statusText,
      period: half ? 2 : period,
      clock: half ? 0 : live ? clockSecs(g.contestClock) : null,
      displayClock: half ? "0:00" : dclock,
      dead: DEAD.test(gs) || DEAD.test(per),
    });
  }
  return { source: "ncaa", games };
}
export async function ncaaScoreboard(season, week, extra = []) {
  const url = `${NCAA_BASE}/scoreboard/football/fbs/${season}/${String(week).padStart(2, "0")}/all-conf`;
  const r = await get(url, "NCAA.com");
  if (r.status !== 200) throw new Error(`NCAA.com scores answered ${r.status}.`);
  return parseNcaa(r.json, extra);
}

// ---------- The Odds API ----------
export function parseOdds(data, extra = []) {
  if (!Array.isArray(data)) throw new Error("The Odds API sent no games list.");
  const games = data.filter((g) => g && g.home_team && g.away_team).map((g) => {
    const s = (team) => {
      const x = Array.isArray(g.scores) ? g.scores.find((k) => k && k.name === team) : null;
      return x && x.score !== "" && x.score != null ? Number(x.score) : null;
    };
    const fin = !!g.completed;
    const live = !fin && Array.isArray(g.scores);
    return {
      espnId: null,
      kickoff: g.commence_time ? new Date(g.commence_time).toISOString() : null,
      away: { name: teamOf(g.away_team, extra), score: s(g.away_team), rank: null },
      home: { name: teamOf(g.home_team, extra), score: s(g.home_team), rank: null },
      state: fin ? "post" : live ? "in" : "pre",
      completed: fin,
      statusText: fin ? "Final" : live ? "In progress" : "",
      period: null, clock: null, displayClock: null, dead: false,
    };
  });
  return { source: "odds", games };
}
// `finals` asks for games finished in the last day too (2 credits instead of 1). `remaining` is the
// credit count the last call reported, so a near empty month skips the call instead of failing it.
export async function oddsScoreboard({ finals = false, remaining = null, extra = [] } = {}) {
  const k = process.env.ODDS_API_KEY;
  if (!k) throw new Error("The Odds API is not set up (no ODDS_API_KEY in Vercel).");
  if (remaining != null && remaining < ODDS_FLOOR) throw new Error(`The Odds API has ${remaining} credits left this month, so it was skipped.`);
  const r = await get(`${ODDS_BASE}?apiKey=${encodeURIComponent(k)}${finals ? "&daysFrom=1" : ""}`, "The Odds API");
  if (r.status === 401) throw new Error("The Odds API refused the key (401). Check ODDS_API_KEY in Vercel.");
  if (r.status === 429) throw new Error("The Odds API is out of credits or busy (429).");
  if (r.status !== 200) throw new Error(`The Odds API answered ${r.status}.`);
  const sb = parseOdds(r.json, extra);
  const left = Number(r.headers && r.headers.remaining);
  sb.remaining = Number.isFinite(left) ? left : null;
  return sb;
}
