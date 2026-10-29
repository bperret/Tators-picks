// Reads ESPN's public JSON feeds and turns them into the shapes the league uses.
// These feeds have no contract. Every parser here checks its input and throws a plain
// message when the shape is not what we expect, so the commissioner sees a flag.
import { canon, isKnown } from "./teams.js";

export const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
export const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";
export const FITT = "https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex";

let fetcher = null;
// Local tests replace the network with saved responses.
export function setFetcher(fn) {
  fetcher = fn;
}

export async function getJson(url) {
  if (fetcher) return fetcher(url);
  let r;
  try {
    r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (tators-picks)" }, signal: AbortSignal.timeout(12000) });
  } catch (e) {
    throw new Error(`Could not reach ESPN (${e.name === "TimeoutError" ? "timed out" : e.message}).`);
  }
  if (!r.ok) throw new Error(`ESPN answered ${r.status} for ${url.replace(/^https:\/\/[^/]+/, "").slice(0, 80)}.`);
  try {
    return await r.json();
  } catch {
    throw new Error("ESPN sent something that is not JSON.");
  }
}

// ---------- teams ----------
export function teamName(t) {
  if (!t) return "";
  for (const n of [t.location, t.shortDisplayName, t.displayName, t.nickname]) if (n && isKnown(n)) return canon(n);
  return t.location || t.displayName || t.shortDisplayName || t.name || "";
}

// ---------- lines ----------
// The home team's line. A negative number means the home team is favored.
export function homeLineFrom(odds) {
  if (!odds) return null;
  const ps = odds.pointSpread && odds.pointSpread.home;
  const raw = ps && ((ps.close && ps.close.line) || (ps.open && ps.open.line));
  if (raw != null) {
    const s = String(raw).trim().toUpperCase();
    if (s === "PK" || s === "EVEN" || s === "EV") return 0;
    const n = parseFloat(s);
    if (Number.isFinite(n)) return n;
  }
  // Checked against a live response: "spread" is the home team's line (Navy +30.5 showed 30.5).
  if (typeof odds.spread === "number" && Number.isFinite(odds.spread)) return odds.spread;
  return null;
}

// League rule: lines end in a half point. On a whole number the underdog gets the extra half.
export function halfPoint(line, homeFavored) {
  if (line == null) return null;
  if (Math.abs(line % 1) === 0.5) return line;
  const r = Math.round(line * 2) / 2;
  if (Math.abs(r % 1) === 0.5) return r;
  if (r < 0) return r - 0.5; // home favored, away dog gets the half
  if (r > 0) return r + 0.5; // home dog gets the half
  return homeFavored ? -0.5 : 0.5; // pick'em: the team ESPN lists as the underdog gets the half
}

// ---------- scoreboard ----------
const DEAD = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|FORFEIT/;

export function parseEvent(ev) {
  const c = ev && ev.competitions && ev.competitions[0];
  if (!c || !Array.isArray(c.competitors) || c.competitors.length !== 2) throw new Error("ESPN game data is missing teams.");
  const side = (ha) => {
    const x = c.competitors.find((k) => k.homeAway === ha);
    if (!x) throw new Error("ESPN game data has no " + ha + " team.");
    const rk = x.curatedRank && x.curatedRank.current;
    return { name: teamName(x.team), teamId: String((x.team && x.team.id) || ""), rank: rk && rk < 99 ? rk : null, score: x.score == null || x.score === "" ? null : Number(x.score) };
  };
  const st = (c.status && c.status.type) || (ev.status && ev.status.type) || {};
  const odds = (c.odds || [])[0];
  const homeOdds = odds && odds.homeTeamOdds;
  return {
    espnId: String(ev.id || c.id),
    kickoff: new Date(ev.date || c.date).toISOString(),
    neutral: !!c.neutralSite,
    away: side("away"),
    home: side("home"),
    rawLine: homeLineFrom(odds),
    total: odds && typeof odds.overUnder === "number" ? odds.overUnder : null,
    homeFavored: !!(homeOdds && homeOdds.favorite),
    state: st.state || "pre",
    completed: !!st.completed,
    statusName: st.name || "",
    statusText: st.shortDetail || st.detail || st.description || "",
    dead: DEAD.test(st.name || ""),
    week: ev.week && ev.week.number,
  };
}

export function parseScoreboard(data) {
  if (!data || !Array.isArray(data.events)) throw new Error("ESPN scoreboard has no games list.");
  const games = [];
  const bad = [];
  for (const ev of data.events) {
    try {
      games.push(parseEvent(ev));
    } catch (e) {
      bad.push(ev && ev.shortName ? ev.shortName : "a game");
    }
  }
  return {
    season: data.season && data.season.year,
    seasonType: data.season && data.season.type,
    week: data.week && data.week.number,
    games,
    bad,
  };
}

export async function scoreboardForDate(yyyymmdd) {
  return parseScoreboard(await getJson(`${SITE}/scoreboard?dates=${yyyymmdd}&groups=80&limit=300`));
}
export async function scoreboardForWeek(season, week) {
  return parseScoreboard(await getJson(`${SITE}/scoreboard?dates=${season}&seasontype=2&week=${week}&groups=80&limit=300`));
}
export async function eventSummary(id) {
  const d = await getJson(`${SITE}/summary?event=${encodeURIComponent(id)}`);
  const c = d && d.header && d.header.competitions && d.header.competitions[0];
  if (!c) throw new Error("ESPN game summary has no game data.");
  return parseEvent({ id, date: c.date, competitions: [c] });
}

// ---------- rankings ----------
const fmtDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
};

function parsePoll(r) {
  const ranks = Array.isArray(r.ranks) ? r.ranks : [];
  if (!ranks.length) return null;
  const teams = ranks.map((x) => ({
    rank: x.current,
    team: teamName(x.team),
    teamId: String((x.team && x.team.id) || ""),
    record: x.recordSummary || "",
    pts: x.points || 0,
    prev: x.previous > 0 ? x.previous : x.previous === 0 ? "NR" : null,
  }));
  const others = (Array.isArray(r.others) ? r.others : []).map((x) => ({ team: teamName(x.team), pts: x.points || 0 })).filter((x) => x.pts > 0);
  return { asOf: fmtDate(r.date) || r.headline || "", stamp: String(r.date || r.headline || teams.map((t) => t.team).join(",")), teams, others };
}

export async function fetchPolls() {
  const d = await getJson(`${SITE}/rankings`);
  if (!d || !Array.isArray(d.rankings)) throw new Error("ESPN rankings have no polls list.");
  let ap = null, cfp = null;
  for (const r of d.rankings) {
    const label = `${r.type || ""} ${r.shortName || ""} ${r.name || ""}`;
    if (!ap && /\bap\b/i.test(label)) ap = parsePoll(r);
    else if (!cfp && /playoff|cfp/i.test(label)) cfp = parsePoll(r);
  }
  if (!ap) throw new Error("ESPN rankings did not include the AP poll.");
  return { ap, cfp };
}

// ---------- FPI ----------
export async function fetchFpi(season, idNames = {}) {
  const d = await getJson(`${FITT}?region=us&lang=en&season=${season}&limit=500&sort=fpi.fpi%3Adesc`);
  if (!d || !Array.isArray(d.teams)) throw new Error("ESPN FPI has no teams list.");
  const rows = [];
  for (const t of d.teams) {
    const cat = Array.isArray(t.categories) ? t.categories[0] : null;
    const v = cat && Array.isArray(cat.totals) ? parseFloat(cat.totals[0]) : NaN;
    if (!Number.isFinite(v)) continue;
    const id = String((t.team && t.team.id) || "");
    rows.push({ team: idNames[id] || teamName(t.team), rating: Math.round(v * 10) / 10 });
  }
  if (rows.length < 25) throw new Error(`ESPN FPI listed only ${rows.length} teams.`);
  rows.sort((a, b) => b.rating - a.rating);
  rows.forEach((r, i) => (r.rank = i && rows[i - 1].rating === r.rating ? rows[i - 1].rank : i + 1));
  return rows;
}

// FPI's projected margin for one game (ESPN's "teampredptdiff"). Returns the model's home line.
export async function fpiModelLine(espnId, homeTeamId) {
  const base = `${CORE}/events/${espnId}/competitions/${espnId}/powerindex`;
  const d = await getJson(base);
  const items = Array.isArray(d && d.items) ? d.items : d && d.stats ? [d] : [];
  let homeDiff = null;
  for (let it of items) {
    if (!it.stats && it.$ref) it = await getJson(String(it.$ref).replace(/^http:/, "https:"));
    const ref = (it.team && (it.team.$ref || it.team.id)) || it.$ref || "";
    const m = String(ref).match(/teams\/(\d+)/) || [null, String((it.team && it.team.id) || "")];
    const stat = (it.stats || []).find((s) => s.name === "teampredptdiff");
    if (!stat || !Number.isFinite(Number(stat.value))) continue;
    const v = Number(stat.value);
    if (m[1] === homeTeamId) homeDiff = v;
    else if (homeDiff == null) homeDiff = -v;
  }
  if (homeDiff == null) throw new Error("no FPI projection");
  return Math.round(-homeDiff * 10) / 10;
}
