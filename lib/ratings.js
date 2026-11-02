// SP+ and VSiN power ratings. Neither has a feed, so this reads each source's weekly
// web page and its ratings table. It runs only when the commissioner taps the button.
// Every result is checked before it is saved: all teams known, no repeats, and close
// to last week's numbers. Anything off becomes a flag and the old ratings stay.
import { canon, isKnown } from "./teams.js";
import { getText } from "./espn.js";

export const SP_URL = "https://www.espn.com/college-football/story/_/id/49868647/2026-college-football-sp+-rankings-all-138-fbs-teams";
export const VSIN_HUB = "https://vsin.com/college-football/";
export const vsinUrls = (wk) => [
  `https://vsin.com/college-football/week-${wk}-college-football-power-ratings-and-projections-for-every-game/`,
  `https://vsin.com/college-football/week-${wk}-college-football-power-ratings-and-predictions/`,
];

const MIN_TEAMS = 130;
const MAX_DRIFT = 5; // average change per team from the saved ratings, in points
const MAX_AGE_DAYS = 10;

// ---------- page text ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", rsquo: "'", lsquo: "'", minus: "-", ndash: "-", mdash: "-" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENT[e] != null ? ENT[e] : m;
});
const text = (h) => decode(String(h).replace(/<[^>]*>/g, " ")).replace(/[‘’]/g, "'").replace(/[−–—]/g, "-").replace(/\s+/g, " ").trim();

// ESPN shortens school names in its tables.
const SHORT = {
  "n. dakota st": "North Dakota State", "va. tech": "Virginia Tech", "miss. st": "Mississippi State", "jax st": "Jacksonville State",
  "wmu": "Western Michigan", "w. virginia": "West Virginia", "la. tech": "Louisiana Tech", "ga. southern": "Georgia Southern",
  "ecu": "East Carolina", "miami-oh": "Miami (OH)", "ga. tech": "Georgia Tech", "boston coll": "Boston College", "app. st": "App State",
  "coastal caro": "Coastal Carolina", "kennesaw": "Kennesaw State", "wash. st": "Washington State", "odu": "Old Dominion",
  "n. mex. st": "New Mexico State", "mtsu": "Middle Tennessee", "cmu": "Central Michigan", "bgsu": "Bowling Green",
  "emu": "Eastern Michigan", "so. miss": "Southern Miss", "wku": "Western Kentucky", "s. alabama": "South Alabama",
  "s. carolina": "South Carolina", "n. carolina": "North Carolina", "n. illinois": "Northern Illinois", "jmu": "James Madison",
  "san jose st": "San José State", "sac state": "Sacramento State", "nc st": "NC State", "texas st": "Texas State",
};
export function teamOf(cell) {
  let n = String(cell || "").replace(/\(\s*\d+\s*-\s*\d+(?:\s*-\s*\d+)?\s*\)/g, "").replace(/[*†‡]+/g, "").replace(/\s+/g, " ").trim();
  if (!n || /^[+-]?\d/.test(n)) return null;
  const k = n.toLowerCase().replace(/\.$/, "");
  if (SHORT[k]) n = SHORT[k];
  if (isKnown(n)) return canon(n);
  const st = n.replace(/\s+St\.?$/i, " State");
  if (isKnown(st)) return canon(st);
  return null;
}
const NUM = /^[+-]?\d+(?:\.\d+)?$/;

// Reads every table on the page and keeps the one that looks like a full ratings list:
// a rank, a known school, then the first plain number after the school.
export function parseRatings(html, label) {
  const found = [];
  for (const tm of String(html || "").matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...tm[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1])));
    if (!rows.length) continue;
    const head = rows.filter((r) => !/^\d/.test(r[0] || "")).slice(0, 2).flat().join(" ");
    if (/r[eé]sum[eé]|strength of schedule|\bsos\b/i.test(head)) continue;
    const out = [], seen = new Set();
    for (const cells of rows) {
      // Most tables lead with the rank. Without one, the row order is the rank.
      let rank = parseInt(String(cells[0] || "").replace(/^T-?/i, ""), 10);
      const hasRank = rank >= 1 && rank <= 140;
      if (!hasRank) rank = null;
      let ti = -1, team = null;
      for (let i = hasRank ? 1 : 0; i < cells.length && ti < 0; i++) { const t = teamOf(cells[i]); if (t) { ti = i; team = t; } }
      if (ti < 0 || seen.has(team)) continue;
      const rc = cells.slice(ti + 1).find((c) => NUM.test(c));
      if (rc == null) continue;
      seen.add(team);
      out.push({ rank, team, rating: Number(rc) });
    }
    found.push(out);
  }
  if (!found.length) throw new Error(`the ${label} page has no ratings table, so its layout may have changed.`);
  const best = found.sort((a, b) => b.length - a.length)[0];
  if (best.length < MIN_TEAMS) throw new Error(`the ${label} page listed only ${best.length} schools the site knows (it needs ${MIN_TEAMS}), so its layout may have changed.`);
  if (best.some((t) => t.rank == null)) best.forEach((t, i) => { t.rank = i + 1; });
  return best.sort((a, b) => a.rank - b.rank);
}

// The page's own date, when it gives one.
export function pageDate(html) {
  const h = String(html || "");
  for (const re of [/article:modified_time"\s+content="([^"]+)"/i, /"dateModified"\s*:\s*"([^"]+)"/i, /article:published_time"\s+content="([^"]+)"/i, /"datePublished"\s*:\s*"([^"]+)"/i]) {
    const m = h.match(re);
    if (m && Number.isFinite(Date.parse(m[1]))) return Date.parse(m[1]);
  }
  return null;
}

// Compares new ratings with the saved ones. Big jumps mean the wrong table or column.
export function checkDrift(teams, old, label) {
  if (!old || !Array.isArray(old.teams) || old.teams.length < 100) return { same: false };
  const prev = new Map(old.teams.map((t) => [t.team, t.rating]));
  let n = 0, sum = 0, same = true;
  for (const t of teams) { if (!prev.has(t.team)) { same = false; continue; } const d = Math.abs(t.rating - prev.get(t.team)); sum += d; n++; if (d > 0) same = false; }
  if (n < 100) throw new Error(`the ${label} page matched only ${n} of the saved schools, so it may be the wrong table.`);
  const avg = sum / n;
  if (avg > MAX_DRIFT) throw new Error(`the ${label} numbers moved an average of ${avg.toFixed(1)} points per team from the saved ones, so the page may have changed. Nothing was saved.`);
  return { same: same && teams.length === old.teams.length };
}

// Finds this week's VSiN ratings article: the newest one linked from VSiN's college page,
// then the usual address for next week and this week.
export async function findVsin(nextWeek, now, get = getText) {
  const tried = [];
  const cands = [];
  try {
    const hub = await get(VSIN_HUB);
    const wks = [...String(hub).matchAll(/href="((?:https?:\/\/(?:www\.)?vsin\.com)?\/college-football\/week-(\d+)-college-football-power-ratings[a-z0-9-]*\/?)"/gi)]
      .map((m) => ({ url: m[1].startsWith("http") ? m[1] : "https://vsin.com" + m[1], wk: +m[2] }))
      .filter((x) => x.wk <= nextWeek + 1)
      .sort((a, b) => b.wk - a.wk);
    if (wks.length) cands.push(wks[0].url);
  } catch (e) { tried.push("college page: " + e.message); }
  for (const wk of [nextWeek, nextWeek - 1]) for (const u of vsinUrls(wk)) if (!cands.includes(u)) cands.push(u);
  for (const url of cands) {
    let html;
    try { html = await get(url); } catch (e) { tried.push(e.message); continue; }
    const d = pageDate(html);
    if (d && now - d > MAX_AGE_DAYS * 86400e3) { tried.push(`${url.split("/").slice(-2)[0]} is from ${new Date(d).toDateString()}`); continue; }
    if (!/power rating/i.test(text(html).slice(0, 20000)) && !/<table/i.test(html)) { tried.push("no ratings on " + url); continue; }
    return { url, html, date: d };
  }
  throw new Error(`could not find this week's VSiN ratings article (${tried.slice(0, 3).join("; ") || "no link found"}).`);
}

const fmt = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

// Pulls both systems. Each one stands alone: one failing does not stop the other.
export async function fetchRatings({ now, nextWeek, saved = {}, get = getText }) {
  const out = { updated: {}, notes: [], errors: [] };
  // SP+
  try {
    const html = await get(SP_URL);
    const teams = parseRatings(html, "ESPN SP+");
    const d = pageDate(html);
    const { same } = checkDrift(teams, saved.sp, "ESPN SP+");
    if (same) out.notes.push(`SP+ has not changed since ${saved.sp.asOf || "the last update"}`);
    else out.updated.sp = { asOf: fmt(d || now), source: "SP+ (Bill Connelly) via ESPN", url: SP_URL, teams };
  } catch (e) { out.errors.push("SP+: " + e.message); }
  // VSiN
  try {
    const page = await findVsin(nextWeek, now, get);
    const teams = parseRatings(page.html, "VSiN");
    const { same } = checkDrift(teams, saved.vsin, "VSiN");
    const wk = (page.url.match(/week-(\d+)-/) || [])[1];
    if (same) out.notes.push(`VSiN has not changed since ${saved.vsin.asOf || "the last update"}`);
    else out.updated.vsin = { asOf: fmt(page.date || now), source: `VSiN power ratings (Adam Burke)${wk ? ", Week " + wk : ""}`, url: page.url, teams };
  } catch (e) { out.errors.push("VSiN: " + e.message); }
  return out;
}
