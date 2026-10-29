// A saved-style r/CFB poll page for tests. Mirrors the live layout: a heading with season and week,
// a table of 25 rows (rank, change, logo + team name with first-place votes, points, stats),
// a movers table, and an others-receiving-votes line.
const NAMES = ["Miami Hurricanes", "Ohio State Buckeyes", "Utah Utes", "Georgia Bulldogs", "Indiana Hoosiers", "Notre Dame Fighting Irish", "UCLA Bruins", "BYU Cougars", "Kentucky Wildcats", "Alabama Crimson Tide",
  "Texas Longhorns", "Ole Miss Rebels", "Texas Tech Red Raiders", "Wake Forest Demon Deacons", "LSU Tigers", "Tennessee Volunteers", "Florida Gators", "Houston Cougars", "SMU Mustangs", "Oregon Ducks",
  "Texas A&amp;M Aggies", "Hawai&#39;i Rainbow Warriors", "San Jos&eacute; State Spartans", "Miami RedHawks", "Penn State Nittany Lions"];
const CH = ["--", "+1", "+6", "-1", "NEW"];
export function redditPage(week = 9) {
  const rows = NAMES.map((n, i) => `<tr><td>${i + 1}</td><td>${CH[i % 5]}</td><td><img src="https://cdn.redditcfb.com/60x40/cfb/x.png" alt=""> <a href="/t">${n}</a>${i < 3 ? ` (${[229, 18, 3][i]})` : ""}</td><td>${7000 - i * 250}</td><td>24.6</td><td>+0.8</td><td>1.0</td><td>276</td></tr>`).join("\n");
  return `<html><body><h1>${2026} Week ${week}</h1>
<table><thead><tr><th>Rank ?</th><th>Change</th><th>Team (#1 Votes)</th><th>Points</th><th>PPV</th><th>Δ PPV</th><th>σ</th><th># Votes</th></tr></thead><tbody>
${rows}
</tbody></table>
<p><b>Others Receiving Votes:</b> UTSA 361, New Mexico 359, James Madison 337, Iowa 318, Western Michigan 1</p>
<h3>Biggest Movers</h3><table><tr><td>Utah</td><td>+3.81</td></tr></table></body></html>`;
}
export const pastedTable = `2026 Week 9
Rank	Change	Team (#1 Votes)	Points	PPV	Δ PPV	σ	# Votes
` + NAMES.map((n, i) => `${i + 1}\t${CH[i % 5]}\t${n.replace("&amp;", "&").replace("&#39;", "'").replace("&eacute;", "é")}${i < 3 ? ` (${[229, 18, 3][i]})` : ""}\t${7000 - i * 250}\t24.6\t+0.8\t1.0\t276`).join("\n") + `
Others Receiving Votes: UTSA 361, New Mexico 359, Iowa 318`;
