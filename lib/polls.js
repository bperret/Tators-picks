// The r/CFB poll (poll.redditcfb.com). The site has no feed, so this reads its HTML table.
// The same row reader takes the poll table copied from the page and pasted in Commish,
// which is the manual fallback when the page changes and the parser stops working.
import { canon, isKnown } from "./teams.js";
import { getText } from "./espn.js";

export const REDDIT_URL = "https://poll.redditcfb.com/poll/this_week/";

// Mascots that would match the wrong school once dropped.
const MASCOT_FIX = { "miami redhawks": "Miami (OH)", "miami (oh) redhawks": "Miami (OH)" };

// "Ohio State Buckeyes" -> "Ohio State". Drops words from the end until a school matches.
export function schoolName(full) {
  const s = String(full || "").replace(/\s+/g, " ").trim();
  if (MASCOT_FIX[s.toLowerCase()]) return { team: MASCOT_FIX[s.toLowerCase()], known: true };
  const words = s.split(" ");
  for (let n = words.length; n >= 1; n--) {
    const t = words.slice(0, n).join(" ");
    if (isKnown(t)) return { team: canon(t), known: true };
  }
  return { team: s, known: false };
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", Eacute: "É" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENT[e] != null ? ENT[e] : m;
});
const text = (h) => decode(String(h).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// One ranked row from its cell texts: rank, change, "Team Name (first-place votes)", points.
function rowFrom(cells) {
  const rank = parseInt(cells[0], 10);
  if (!(rank >= 1 && rank <= 25)) return null;
  const ch = String(cells[1] || "").trim();
  const m = String(cells[2] || "").match(/^(.*?)(?:\s*\((\d+)\))?$/);
  const pts = parseInt(String(cells[3] || "").replace(/,/g, ""), 10);
  if (!m || !m[1] || !Number.isFinite(pts)) return null;
  const { team, known } = schoolName(m[1]);
  let prev = null;
  if (/^new$/i.test(ch)) prev = "NR";
  else if (/^[+-]\d+$/.test(ch)) prev = rank + parseInt(ch, 10);
  else if (/^(--|-|–|—|0)$/.test(ch)) prev = rank;
  return { rank, team, known, pts, fpv: m[2] ? Number(m[2]) : 0, prev };
}

function othersFrom(s) {
  const out = [];
  const re = /([^,\d][^,]*?)\s+(\d+)\s*(?:,|$)/g;
  let m;
  while ((m = re.exec(s))) {
    const { team } = schoolName(m[1].trim());
    out.push({ team, pts: Number(m[2]) });
  }
  return out;
}

function finish(rows, others, season, week) {
  if (rows.length < 20) throw new Error(`the r/CFB poll page listed only ${rows.length} ranked teams, so its layout may have changed.`);
  rows.sort((a, b) => a.rank - b.rank);
  const unknown = rows.filter((r) => !r.known).map((r) => r.team);
  const teams = rows.map(({ known, ...r }) => r);
  return {
    asOf: week ? `Week ${week}` : "",
    week: week || null,
    season: season || null,
    stamp: week ? `${season || ""}-w${week}` : teams.map((t) => t.team + t.pts).join(","),
    source: "r/CFB poll",
    teams,
    others,
    unknown,
  };
}

export function parseRedditHtml(html) {
  const h = String(html || "");
  const head = text(h).match(/\b(20\d\d)\s+Week\s+(\d{1,2})\b/i);
  // The page also has smaller tables (biggest movers). Use the first table with a full top 25.
  let rows = [];
  for (const table of h.split(/<table[\s>]/i).slice(1)) {
    const got = tableRows(table.split(/<\/table>/i)[0]);
    if (got.length >= 20) { rows = got; break; }
    if (got.length > rows.length) rows = got;
  }
  const om = text(h).match(/Others Receiving Votes:?\s*(.+?)(?:Dropped|Biggest|$)/i);
  return finish(rows, om ? othersFrom(om[1]) : [], head && Number(head[1]), head && Number(head[2]));
}
function tableRows(h) {
  const rows = [];
  for (const tr of h.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...tr.split(/<\/tr>/i)[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => {
      // A team cell may hold only a logo with alt text, so keep alt text when there is no other text.
      const t = text(c[1]);
      const alt = (c[1].match(/alt="([^"]*)"/i) || [])[1];
      return t || (alt ? decode(alt) : "");
    });
    const r = cells.length >= 4 && rowFrom(cells);
    if (r) rows.push(r);
  }
  return rows;
}

// The table copied from the page: one row per line, cells split by tabs or runs of spaces.
export function parseRedditText(raw) {
  const s = String(raw || "");
  const head = s.match(/\b(20\d\d)\s+Week\s+(\d{1,2})\b/i);
  const rows = [];
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^\s*#?(\d{1,2})\s+(NEW|--|[+-]\d+|–|—)\s+(.+?(?:\s*\(\d+\))?)\s+([\d,]+)(?:\s|$)/i);
    if (!m) continue;
    const r = rowFrom([m[1], m[2], m[3].trim(), m[4]]);
    if (r) rows.push(r);
  }
  const om = s.match(/Others Receiving Votes:?\s*([^\n]+)/i);
  return finish(rows, om ? othersFrom(om[1]) : [], head && Number(head[1]), head && Number(head[2]));
}

export async function fetchRedditPoll() {
  return parseRedditHtml(await getText(REDDIT_URL));
}
