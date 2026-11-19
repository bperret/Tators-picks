// Award Watch (item 65): pick the winner of 6 national awards. Opened to every login Nov 18 (Benton).
// League contrarian scoring, done on the page: a right pick is worth pickers who picked that award / pickers who took the winner.
// Picks save in award_picks, one row per picker per season, as {awardKey: candidate name}. The server clock enforces the lock:
// any save at or after it gets 423. Before the lock a picker sees only their own picks and the entry count; every pick shows after it.
// Winners are entered by the commissioner (admin action "award") and saved in kv "awards" ({lock, res: {key: name}}).
import { q, one, getKv } from "./db.js";

export const AW_SEASON = 2026;
// Mon Nov 23, 10 PM CT, the night before most awards cut to three finalists (Benton, Nov 18). kv awards.lock overrides it.
export const AW_LOCK = "2026-11-24T04:00:00Z";
// Candidates (Nov 18 research): each award's projected top 10, most likely first. The first is the top pick (The Computer's).
export const AW_LIST = [
  {k:"heis",e:"🏆",n:"Heisman Trophy",what:"Most outstanding player",when:"Sat Dec 12",c:[["Jeremiah Smith","WR","Ohio State"],["Darian Mensah","QB","Miami"],["Devon Dampier","QB","Utah"],["CJ Carr","QB","Notre Dame"],["Gunner Stockton","QB","Georgia"],["Drew Mestemaker","QB","Oklahoma State"],["Keelon Russell","QB","Alabama"],["Conner Weigman","QB","Houston"],["LaNorris Sellers","QB","South Carolina"],["Gio Lopez","QB","Wake Forest"]]},
  {k:"qb",e:"🎯",n:"Davey O'Brien Award",what:"Best quarterback",when:"Thu Dec 10",c:[["Darian Mensah","QB","Miami"],["Devon Dampier","QB","Utah"],["CJ Carr","QB","Notre Dame"],["Gunner Stockton","QB","Georgia"],["Drew Mestemaker","QB","Oklahoma State"],["Conner Weigman","QB","Houston"],["Keelon Russell","QB","Alabama"],["Gio Lopez","QB","Wake Forest"],["LaNorris Sellers","QB","South Carolina"],["Trinidad Chambliss","QB","Ole Miss"]]},
  {k:"rb",e:"🏃",n:"Doak Walker Award",what:"Best running back",when:"Thu Dec 10",c:[["Jahiem White","RB","North Texas"],["DeSean Bishop","RB","Tennessee"],["Jadan Baugh","RB","Florida"],["Wayne Knight","RB","UCLA"],["Dylan Riley","RB","Boise State"],["Cam Cook","RB","West Virginia"],["Caleb Hawkins","RB","Oklahoma State"],["Jamal Roberts","RB","Missouri"],["Aiden Flora","RB","Iowa State"],["Nate Sheppard","RB","Duke"]]},
  {k:"wr",e:"🙌",n:"Biletnikoff Award",what:"Best receiver",when:"Thu Dec 10",c:[["Jeremiah Smith","WR","Ohio State"],["Malachi Toney","WR","Miami"],["Collin Dixon","WR","Illinois"],["Jesse Legree","WR","Oregon State"],["Easton Messer","WR","Florida Atlantic"],["Umari Hatcher","WR","Syracuse"],["Justin Bowick","WR","Oklahoma State"],["Charlie Becker","WR","Indiana"],["Cayden Lee","WR","Missouri"],["Jackson Harris","WR","LSU"]]},
  {k:"def",e:"🛡️",n:"Bednarik Award",what:"Defensive player of the year",when:"Thu Dec 10",c:[["Colin Simmons","EDGE","Texas"],["Xavier Lewis","DT","North Carolina"],["A.J. Holmes Jr.","DT","Texas Tech"],["Gideon Lampron","LB","Colorado"],["Ashton Hampton","CB","Clemson"],["Chris Cole","LB","Georgia"],["KJ Bolden","DB","Georgia"],["Sammy Omosigho","LB","UCLA"],["Xavier Gilliam","DL","Tennessee"],["Tobi Osunsanmi","DL","Indiana"]]},
  {k:"coach",e:"📋",n:"Coach of the Year",what:"The Home Depot Award",when:"Thu Dec 10",c:[["Morgan Scalley","","Utah"],["Bob Chesney","","UCLA"],["Jake Dickert","","Wake Forest"],["Mario Cristobal","","Miami"],["Marcus Freeman","","Notre Dame"],["Kirby Smart","","Georgia"],["Spencer Danielson","","Boise State"],["Manny Diaz","","Duke"],["Eric Morris","","Oklahoma State"],["Charles Huff","","Memphis"]]}];

export async function awardCfg() {
  return (await getKv("awards", null)) || {};
}
export const awardLock = (cfg) => (cfg && cfg.lock) || AW_LOCK;

// Keep only known awards and known candidates.
export function cleanAwardPicks(raw) {
  const out = {};
  for (const a of AW_LIST) {
    const v = raw && raw[a.k];
    if (v == null || v === "") continue;
    if (!a.c.some((c) => c[0] === v)) throw new Error(`${v} is not on the ${a.n} list.`);
    out[a.k] = v;
  }
  return out;
}

export async function saveAwardPicks(me, raw, now = Date.now()) {
  const cfg = await awardCfg();
  if (now >= Date.parse(awardLock(cfg))) return { status: 423, error: "Award Watch locked. The site refused this save." };
  let data;
  try { data = cleanAwardPicks(raw); } catch (e) { return { status: 400, error: e.message }; }
  await q(
    `insert into award_picks (player_id, season, data, updated_at) values ($1, $2, $3::jsonb, now())
     on conflict (player_id, season) do update set data = excluded.data, updated_at = now()`,
    [me.id, AW_SEASON, JSON.stringify(data)]
  );
  return { status: 200, data };
}

// What a login sees. Before the lock: the list, your picks, and the count of pickers in (the commissioner also gets who
// is in and how many awards each picked, never names picked). After the lock: every active picker's picks.
export async function awardsView(me, players, now = Date.now()) {
  const cfg = await awardCfg();
  const lock = awardLock(cfg);
  const open = now < Date.parse(lock);
  const rows = await q("select player_id, data from award_picks where season = $1", [AW_SEASON]);
  const active = new Set(players.filter((p) => !p.removed).map((p) => p.id));
  const live = rows.filter((r) => active.has(r.player_id) && Object.keys(r.data || {}).length);
  const mineRow = rows.find((r) => r.player_id === me.id);
  const v = { season: AW_SEASON, lock, open, list: AW_LIST, mine: (mineRow && mineRow.data) || {}, n: live.length, res: cfg.res || {} };
  if (me.is_commish) v.entered = Object.fromEntries(live.map((r) => [r.player_id, Object.keys(r.data).length]));
  if (!open) v.picks = Object.fromEntries(live.map((r) => [r.player_id, r.data]));
  return v;
}
