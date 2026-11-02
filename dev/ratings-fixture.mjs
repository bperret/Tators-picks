// Saved-page stand-ins for the SP+ (ESPN) and VSiN ratings pages, built from the seed ratings.
import seed from "../data/rankings-seed.js";

// ESPN writes short school names and records in its tables.
const ESPN_SHORT = { "Ohio State": "Ohio St.", "South Carolina": "S. Carolina", "Virginia Tech": "Va. Tech", "Mississippi State": "Miss. St.", "Western Michigan": "WMU", "Miami (OH)": "Miami-OH", "Boston College": "Boston Coll.", "San José State": "San Jose St.", "Hawai'i": "Hawaii", "UL Monroe": "ULM", "Kennesaw State": "Kennesaw", "Sacramento State": "Sac State", "Northern Illinois": "N. Illinois" };
const row = (cells) => "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";

export function espnSpPage({ shift = 0.5, date = "2026-11-08T14:45:00Z", teams = seed.power.sp.teams, broken = false } = {}) {
  const list = teams.map((t, i) => ({ ...t, rating: Math.round((t.rating + (i % 2 ? shift : -shift)) * 10) / 10 }));
  const resume = `<table><tr><th>Rk</th><th>Team</th><th>Résumé SP+</th></tr>${list.slice(0, 40).map((t, i) => row([i + 1, t.team, (90 - i).toFixed(1)])).join("")}</table>`;
  const main = broken ? "<div>ratings moved to an image</div>" : `<table><thead><tr><th>Rk</th><th>Team</th><th>SP+</th><th>Off.</th><th>Def.</th></tr></thead><tbody>${list.map((t, i) => row([i + 1, `${ESPN_SHORT[t.team] || t.team} (6-2)`, t.rating.toFixed(1), "34.1 (5)", "12.0 (8)"])).join("")}</tbody></table>`;
  return { html: `<html><head><meta property="article:modified_time" content="${date}"></head><body><h1>2026 college football SP+ rankings</h1>${resume}${main}</body></html>`, list };
}

export function vsinPage({ shift = 1, date = "2026-11-08T12:00:00Z", teams = seed.power.vsin.teams } = {}) {
  const list = teams.map((t, i) => ({ ...t, rating: t.rating + (i % 3 ? shift : 0) }));
  const name = (t) => ({ "Ole Miss": "Mississippi", Miami: "Miami (Florida)", "Miami (OH)": "Miami (Ohio)", "UL Monroe": "Louisiana-Monroe", Louisiana: "Louisiana-Lafayette", UConn: "Connecticut" }[t] || t);
  return { html: `<html><head><meta property="article:published_time" content="${date}"></head><body><p>Here are my power ratings.</p><table><tr><th>Rank</th><th>Team</th><th>PR</th><th>HFA</th></tr>${list.map((t, i) => row([i + 1, name(t.team), t.rating, "2.5"])).join("")}</table></body></html>`, list };
}

export const vsinHub = (wk) => `<html><body><a href="https://vsin.com/college-football/week-${wk}-college-football-power-ratings-and-projections-for-every-game/">Week ${wk} power ratings</a><a href="/college-football/week-${wk - 1}-college-football-power-ratings-and-projections-for-every-game/">Week ${wk - 1}</a><a href="/college-football/week-15-college-football-power-ratings-and-projections-for-every-game/">old</a></body></html>`;
