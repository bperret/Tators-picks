// Robo-Sharp's inputs. The page does the picking (one place for the logic); the server only saves
// what Robo-Sharp knew and when: the market line for each slate game and both teams' SP+ and VSiN ratings.
// The FPI game projection is already on each game as modelLine.
// While picks are open, each ATS run saves a fresh "last" set. After the lock nothing changes it,
// so Robo-Sharp's sheet is frozen. "first" is the set from when picks opened, for the flip alert.
import { canon } from "./teams.js";

const ratingMap = (src) => {
  const m = {};
  for (const t of (src && src.teams) || []) if (typeof t.rating === "number") m[canon(t.team)] = t.rating;
  return m;
};
const espnOf = (gid) => (String(gid).startsWith("e") ? String(gid).slice(1) : null);

// One snapshot: { at, g: { gameId: { mkt, sp: [away, home], vs: [away, home] } }, note? }
// lineOf(espnId) returns the market's home line, or null.
export function roboSnapshot(w, power, lineOf, now, note) {
  const sp = ratingMap(power && power.sp), vs = ratingMap(power && power.vsin);
  const g = {};
  for (const x of w.games || []) {
    const id = espnOf(x.id);
    const raw = id ? lineOf(id) : null;
    const pair = (m) => { const a = m[canon(x.away)], h = m[canon(x.home)]; return a != null && h != null ? [a, h] : null; };
    g[x.id] = { mkt: raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null, sp: pair(sp), vs: pair(vs) };
  }
  return { at: new Date(now).toISOString(), g, ...(note ? { note } : {}) };
}

// Save a snapshot on the week. The first one also becomes "first".
export function captureRobo(w, power, lineOf, now, note) {
  const snap = roboSnapshot(w, power, lineOf, now, note);
  const r = w.robo && w.robo.last ? w.robo : { v: 2 };
  if (!r.first) r.first = snap;
  r.last = snap;
  w.robo = r;
  return w;
}

// True when the week still takes Robo-Sharp inputs: open and before its deadline.
export const roboTakesInputs = (w, status, now) => status === "open" && now < Date.parse(w.deadline);
