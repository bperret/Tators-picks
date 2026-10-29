// Weekly automation: build the slate, open picks, pull scores, mark the week final,
// refresh rankings and team ATS records. Each job has a manual fallback in the
// Commissioner view, and any failure is saved as a flag the commissioner sees.
import { q, one, getKv, setKv, addLog } from "./db.js";
import { getConfig, getWeek, putWeek, saveDraft, snapshotRankings, effectiveStatus, validateWeek } from "./league.js";
import { canon } from "./teams.js";
import * as espn from "./espn.js";

export const JOB_NAMES = ["slate", "open", "scores", "rankings", "ats"];
const LABEL = { slate: "Build the slate", open: "Open picks", scores: "Pull scores", rankings: "Refresh rankings", ats: "Update team ATS records" };
const FALLBACK = {
  slate: "Tap Build from ESPN to try again, or paste a slate in Load a slate.",
  open: "Tap Open picks.",
  scores: "Tap Pull scores to try again, or enter scores by hand in Scores.",
  rankings: "Tap Refresh rankings to try again, or paste rankings in Update rankings.",
  ats: "Team ATS records stay as they were. Tap Update ATS to try again.",
};
const STALE_MS = 3 * 3600e3; // the hourly schedule missed at least two runs

// ---------- Central time ----------
const TZ = "America/Chicago";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function ct(ms) {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, dow: DOW.indexOf(o.weekday) };
}
// The UTC time of a Central wall-clock time.
export function ctToUtc(y, m, d, h, min) {
  for (const off of [5, 6]) {
    const t = Date.UTC(y, m - 1, d, h + off, min);
    const p = ct(t);
    if (p.h === h && p.d === d) return t;
  }
  return Date.UTC(y, m - 1, d, h + 6, min);
}
const dayKey = (p) => `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`;
// The coming Saturday in Central time (today, if today is Saturday).
export function nextSaturday(now) {
  const p = ct(now);
  const t = Date.UTC(p.y, p.m - 1, p.d + ((6 - p.dow + 7) % 7));
  const s = new Date(t);
  const q2 = { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() };
  return { ...q2, key: dayKey(q2) };
}
const ctDayKey = (iso) => dayKey(ct(Date.parse(iso)));
const fmtShort = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });

// ---------- status store ----------
async function loadAuto() {
  const a = await getKv("auto", {});
  return { lastTick: null, runs: {}, flags: [], dismissed: [], ...a };
}
const saveAuto = (a) => setKv("auto", { ...a, dismissed: a.dismissed.slice(-200) });

function clearJob(a, job) {
  a.flags = a.flags.filter((f) => f.job !== job);
}
function addFlag(a, job, level, msg, key = `${job}:${msg}`) {
  if (a.dismissed.includes(key) || a.flags.some((f) => f.key === key)) return;
  a.flags.push({ key, job, level, msg, at: new Date().toISOString() });
}

// One run at a time, even when the hourly schedule and a button press overlap.
async function takeLock(ms = 120e3) {
  const until = new Date(Date.now() + ms).toISOString();
  const rows = await q(
    `insert into kv (key, value) values ('autolock', $1::jsonb)
     on conflict (key) do update set value = excluded.value
     where (kv.value->>'until')::timestamptz < now()
     returning key`,
    [JSON.stringify({ until })]
  );
  return rows.length > 0;
}
const freeLock = () => q("delete from kv where key = 'autolock'");

// ---------- helpers ----------
async function allWeeks() {
  return (await q("select data from weeks order by id")).map((r) => r.data);
}
async function rememberTeamIds(games) {
  const m = await getKv("teamIds", {});
  let n = 0;
  for (const g of games) for (const s of [g.away, g.home]) if (s.teamId && s.name && m[s.teamId] !== s.name) { m[s.teamId] = s.name; n++; }
  if (n) await setKv("teamIds", m);
  return m;
}
async function limitAll(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { ok: true, v: await fn(items[k]) }; } catch (e) { out[k] = { ok: false, e }; } }
  }));
  return out;
}
const gameName = (g) => `${g.away} at ${g.home}`;

// ---------- job: build the slate ----------
// League rule: 5 top AP games (ranked against ranked first), then the 5 tightest lines
// among the other games with a ranked team. Saturday games at 11 a.m. CT or later only.
export function chooseGames(cands, rankOf) {
  const best = (g) => Math.min(rankOf(g, "away") || 99, rankOf(g, "home") || 99);
  const both = (g) => !!(rankOf(g, "away") && rankOf(g, "home"));
  const sum = (g) => (rankOf(g, "away") || 99) + (rankOf(g, "home") || 99);
  const elig = cands.filter((g) => rankOf(g, "away") || rankOf(g, "home"));
  const top = [...elig].sort((x, y) => both(y) - both(x) || best(x) - best(y) || sum(x) - sum(y)).slice(0, 5);
  const rest = elig.filter((g) => !top.includes(g)).sort((x, y) => Math.abs(x.homeLine) - Math.abs(y.homeLine) || best(x) - best(y));
  return { chosen: [...top, ...rest.slice(0, 5)], eligible: elig };
}

async function slateJob(ctx) {
  const { a, now } = ctx;
  const sat = nextSaturday(now);
  const weeks = await allWeeks();
  const existing = weeks.find((w) => ctDayKey(w.origDeadline || w.deadline) === sat.key);
  if (existing && !(ctx.force && effectiveStatus(existing, now) === "draft")) return `Week ${existing.week} is already loaded.`;
  clearJob(a, "slate");

  const sb = await espn.scoreboardForDate(sat.key);
  if (sb.seasonType && sb.seasonType !== 2) {
    a.slateSkip = sat.key;
    return "No regular season games that Saturday. Bowls run as a separate contest.";
  }
  if (!sb.week || !sb.season) throw new Error("ESPN did not say which week that Saturday is.");
  await rememberTeamIds(sb.games);

  let apById = null, pollNote = "";
  try {
    const polls = await espn.fetchPolls();
    apById = {};
    for (const t of polls.ap.teams) { if (t.teamId) apById[t.teamId] = t.rank; apById["n:" + canon(t.team)] = t.rank; }
    pollNote = `AP poll of ${polls.ap.asOf}`;
  } catch (e) {
    addFlag(a, "slate", "warn", `The AP poll did not load (${e.message}). Ranks came from ESPN's scoreboard instead. Check them before you open picks.`);
    pollNote = "ESPN scoreboard ranks";
  }
  const rankOf = (g, s) => (apById ? apById[g[s].teamId] || apById["n:" + canon(g[s].name)] || null : g[s].rank);

  const start = ctToUtc(sat.y, sat.m, sat.d, 11, 0);
  const pre = sb.games.filter((g) => ctDayKey(g.kickoff) === sat.key && Date.parse(g.kickoff) >= start && g.state === "pre" && !g.dead);
  const noLine = pre.filter((g) => g.rawLine == null && (rankOf(g, "away") || rankOf(g, "home")));
  if (noLine.length) addFlag(a, "slate", "warn", `No line yet for ${noLine.map((g) => g.away.name + " at " + g.home.name).join(", ")}. Those games were left out.`);
  const cands = pre.filter((g) => g.rawLine != null).map((g) => ({ ...g, homeLine: espn.halfPoint(g.rawLine, g.homeFavored) }));
  for (const g of cands) if (g.rawLine === 0) addFlag(a, "slate", "warn", `${g.away.name} at ${g.home.name} was a pick'em. ${g.homeFavored ? g.away.name : g.home.name} got the half point. Check it.`);

  const { chosen, eligible } = chooseGames(cands, rankOf);
  if (!chosen.length) throw new Error("ESPN has no Saturday games with a ranked team and a line yet.");
  if (chosen.length < 10) addFlag(a, "slate", "warn", `Only ${chosen.length} games qualified this week.`);

  const toGame = (g, slot) => ({
    id: "e" + g.espnId, espnId: g.espnId, ...(slot ? { slot } : {}),
    away: g.away.name, awayRank: rankOf(g, "away") || 99, home: g.home.name, homeRank: rankOf(g, "home") || 99,
    homeLine: g.homeLine, kickoff: g.kickoff, neutral: g.neutral,
  });
  // Robo-Sharp's line: ESPN FPI's projected margin for each game.
  const pool = eligible.map((g) => toGame(g));
  const lines = await limitAll(pool, 6, (g) => espn.fpiModelLine(g.espnId, eligible.find((x) => "e" + x.espnId === g.id).home.teamId));
  pool.forEach((g, i) => { if (lines[i].ok) { g.modelLine = lines[i].v; g.modelSource = "ESPN FPI"; } });
  const games = chosen.map((g, i) => ({ ...pool.find((p) => p.id === "e" + g.espnId), slot: i + 1 }));
  const missing = games.filter((g) => g.modelLine == null);
  if (missing.length) addFlag(a, "slate", "warn", `Robo-Sharp has no FPI line for ${missing.map(gameName).join(", ")}. It sits out ${missing.length === 1 ? "that game" : "those games"}.`);

  const cfg = ctx.cfg;
  const week = {
    id: `${sb.season}-w${String(sb.week).padStart(2, "0")}`, season: sb.season, week: sb.week,
    deadline: new Date(ctToUtc(sat.y, sat.m, sat.d, 10, 15)).toISOString(), scored: cfg.scored === true,
    source: `Lines: DraftKings via ESPN, ${fmtShort(now)}. Ranks: ${pollNote}. Model lines: ESPN FPI.`,
    games, pool, auto: true, builtAt: new Date(now).toISOString(),
  };
  const errs = validateWeek(week);
  if (errs.length) throw new Error("The built slate failed checks: " + errs.slice(0, 3).join(" "));
  if (existing && existing.id !== week.id) throw new Error(`ESPN calls that Saturday week ${sb.week}, but the loaded draft is week ${existing.week}.`);
  await saveDraft(week);
  await addLog(ctx.by, existing ? "Rebuilt the draft from ESPN" : "Built the slate from ESPN", `Week ${week.week}: ${games.map((g) => g.away + " at " + g.home).join(", ")}`);
  return `Week ${week.week} draft built with ${games.length} games.`;
}

// ---------- job: open picks ----------
function openAt(w) {
  const p = ct(Date.parse(w.origDeadline || w.deadline));
  const t = Date.UTC(p.y, p.m - 1, p.d - 3);
  const d = new Date(t);
  return ctToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 18, 0); // Wednesday 6 p.m. CT
}
async function openJob(ctx) {
  const cfg = ctx.cfg;
  const w = cfg.currentWeek && (await getWeek(cfg.currentWeek));
  if (!w || effectiveStatus(w, ctx.now) !== "draft") return "No draft waiting to open.";
  if (ctx.now >= Date.parse(w.deadline)) throw new Error(`Week ${w.week} is still a draft and its deadline passed. Nobody could pick.`);
  if (w.games.length < 10) throw new Error(`Week ${w.week} has only ${w.games.length} games, so it was not opened by itself. Swap or reload, then tap Open picks.`);
  w.status = "open";
  await putWeek(w);
  await addLog(ctx.by, "Opened picks", `Week ${w.week}`);
  return `Week ${w.week} picks are open.`;
}

// ---------- job: scores and final ----------
async function scoresJob(ctx) {
  const { a, now } = ctx;
  const targets = (await allWeeks()).filter((w) => effectiveStatus(w, now) === "locked");
  if (!targets.length) return "No locked week to score.";
  const boards = {};
  const msgs = [];
  for (const w of targets) {
    const key = ctDayKey(w.origDeadline || w.deadline);
    boards[key] = boards[key] || (await espn.scoreboardForDate(key));
    const sb = boards[key];
    const byId = {}, byName = {};
    for (const g of sb.games) { byId[g.espnId] = g; byName[canon(g.away.name) + "|" + canon(g.home.name)] = g; }
    const results = { ...(w.results || {}) };
    let changed = 0, finals = 0;
    const open = [];
    for (const g of w.games) {
      const r = results[g.id];
      if (r && (r.src === "manual" || r.void)) { if (r.void || r.final) finals++; else open.push(gameName(g) + " (your score, not final)"); continue; }
      let ev = (g.espnId && byId[g.espnId]) || byName[canon(g.away) + "|" + canon(g.home)];
      if (!ev && g.espnId) { try { ev = await espn.eventSummary(g.espnId); } catch { ev = null; } }
      if (!ev) { addFlag(a, "scores", "warn", `ESPN has no game for ${gameName(g)}. Enter its score by hand.`, `noev:${w.id}:${g.id}`); open.push(gameName(g)); continue; }
      if (ev.dead) {
        addFlag(a, "scores", "warn", `${gameName(g)} shows ${ev.statusText || "postponed"} on ESPN. Set it to Void in Scores, or wait if it is rescheduled this weekend.`, `dead:${w.id}:${g.id}`);
        open.push(gameName(g));
        continue;
      }
      if (ev.state === "pre") { open.push(gameName(g)); continue; }
      // ESPN can list the teams the other way round from our slate.
      const flip = canon(ev.home.name) === canon(g.away) && canon(ev.away.name) === canon(g.home);
      const [as, hs] = flip ? [ev.home.score, ev.away.score] : [ev.away.score, ev.home.score];
      if (!Number.isInteger(as) || !Number.isInteger(hs)) { open.push(gameName(g)); continue; }
      const fin = ev.state === "post" && ev.completed;
      const next = { away: as, home: hs, final: fin, void: false, src: "auto", status: ev.statusText };
      if (!r || r.away !== as || r.home !== hs || !!r.final !== fin) { results[g.id] = next; changed++; }
      if (fin) finals++; else open.push(gameName(g));
    }
    if (changed) {
      w.results = results;
      await putWeek(w);
      await addLog(ctx.by, "Updated scores from ESPN", `Week ${w.week}: ${changed} game${changed === 1 ? "" : "s"} changed, ${finals} of ${w.games.length} final`);
    }
    if (finals === w.games.length && !w.holdFinal) {
      w.results = results;
      w.status = "final";
      await putWeek(w);
      await snapshotRankings(w.id);
      await addLog(ctx.by, "Marked week final", `Week ${w.week}: every game final or void`);
      msgs.push(`Week ${w.week} is final.`);
    } else if (finals === w.games.length) {
      msgs.push(`Week ${w.week}: every game is final. You reopened scoring, so tap Mark week final when ready.`);
    } else {
      msgs.push(`Week ${w.week}: ${finals} of ${w.games.length} final.`);
      if (now > Date.parse(w.deadline) + 3 * 86400e3) addFlag(a, "scores", "warn", `Week ${w.week} is still not final: ${open.join(", ")}.`, `late:${w.id}`);
    }
  }
  return msgs.join(" ");
}

// ---------- job: rankings ----------
async function rankingsJob(ctx) {
  const R = (await getKv("rankings", null)) || {};
  const errs = [];
  const done = [];
  try {
    const { ap, cfp } = await espn.fetchPolls();
    if (!R.ap || R.ap.stamp !== ap.stamp) { R.ap = ap; done.push(`AP poll of ${ap.asOf}`); }
    if (cfp && (!R.cfp || R.cfp.stamp !== cfp.stamp)) { R.cfp = cfp; done.push(`CFP rankings of ${cfp.asOf}`); }
  } catch (e) { errs.push("AP and CFP: " + e.message); }
  try {
    const teams = await espn.fetchFpi(ctx.cfg.season, await getKv("teamIds", {}));
    R.power = { ...(R.power || {}), fpi: { asOf: fmtShort(ctx.now), source: "ESPN FPI", teams } };
    done.push(`FPI for ${teams.length} teams`);
  } catch (e) { errs.push("FPI: " + e.message); }
  if (done.length) {
    await setKv("rankings", R);
    if (done.some((d) => !d.startsWith("FPI"))) await addLog(ctx.by, "Updated rankings", done.filter((d) => !d.startsWith("FPI")).join(", "));
  }
  if (errs.length) throw new Error(errs.join(" "));
  return done.length ? "Updated " + done.join(", ") + "." : "No new polls.";
}

// ---------- job: team ATS records ----------
// Starts from the loaded records and adds each finished FBS game with its closing line.
// Lines are saved before kickoff, because ESPN may drop odds from finished games.
const rec = (s) => String(s || "0-0-0").split("-").map((n) => Number(n) || 0);
const bump = (s, i) => { const r = rec(s); while (r.length < 3) r.push(0); r[i]++; return r.join("-"); };
async function atsJob(ctx) {
  const { a, now } = ctx;
  const R = await getKv("rankings", null);
  if (!R || !R.ats || !Array.isArray(R.ats.teams)) return "No ATS records loaded to update.";
  const st = await getKv("atsAuto", { since: null, lines: {}, applied: {} });
  if (!st.since) {
    // The loaded records run through their "as of" day. Count games after it.
    const base = Date.parse(R.ats.asOf) + 12 * 3600e3; // a date with no time parses as midnight UTC
    const p = ct(isNaN(base) ? now : base);
    st.since = new Date(ctToUtc(p.y, p.m, p.d, 23, 59)).toISOString();
  }
  const sb = espn.parseScoreboard(await espn.getJson(`${espn.SITE}/scoreboard?groups=80&limit=300`));
  await rememberTeamIds(sb.games);
  const rows = {};
  for (const t of R.ats.teams) rows[canon(t.team)] = t;
  let added = 0, saved = 0;
  const missing = [];
  for (const g of sb.games) {
    if (Date.parse(g.kickoff) <= Date.parse(st.since)) continue;
    if (g.state === "pre" && g.rawLine != null) { if (st.lines[g.espnId] !== g.rawLine) saved++; st.lines[g.espnId] = g.rawLine; continue; }
    if (st.applied[g.espnId] || g.dead) continue;
    if (!(g.state === "post" && g.completed)) continue;
    const line = st.lines[g.espnId] != null ? st.lines[g.espnId] : g.rawLine;
    if (line == null || g.home.score == null || g.away.score == null) { missing.push(`${g.away.name} at ${g.home.name}`); st.applied[g.espnId] = "no line"; continue; }
    const cover = g.home.score - g.away.score + line; // above 0: home covered
    for (const [side, other] of [["home", "away"], ["away", "home"]]) {
      const t = rows[canon(g[side].name)];
      if (!t) continue; // not an FBS team in our list
      const won = g[side].score > g[other].score;
      t.su = bump(t.su, won ? 0 : 1).split("-").slice(0, 2).join("-");
      const mine = side === "home" ? cover : -cover;
      t.ats = bump(t.ats, mine > 0 ? 0 : mine < 0 ? 1 : 2);
    }
    st.applied[g.espnId] = 1;
    added++;
  }
  if (missing.length) addFlag(a, "ats", "warn", `No line found for ${missing.join(", ")}. Those games were left out of team ATS records.`, `atsmiss:${missing.join(",")}`);
  await setKv("atsAuto", st);
  if (added) {
    R.ats = { ...R.ats, asOf: fmtShort(now), source: "Covers through Oct 28, then ESPN (DraftKings closing lines)" };
    await setKv("rankings", R);
    await addLog(ctx.by, "Updated team ATS records", `${added} finished game${added === 1 ? "" : "s"} added`);
  }
  return `${added} finished game${added === 1 ? "" : "s"} added. ${saved} line${saved === 1 ? "" : "s"} saved before kickoff.`;
}

const JOBS = { slate: slateJob, open: openJob, scores: scoresJob, rankings: rankingsJob, ats: atsJob };

// ---------- what runs on each hourly tick ----------
export async function dueJobs(now, cfg, a) {
  const due = [];
  const p = ct(now);
  const sat = nextSaturday(now);
  const weeks = await allWeeks();
  const cur = cfg.currentWeek && weeks.find((w) => w.id === cfg.currentWeek);
  // Tuesday 1 p.m. through Friday: build the coming Saturday's slate if it is not loaded.
  const slateWindow = (p.dow === 2 && p.h >= 13) || p.dow === 3 || p.dow === 4 || p.dow === 5;
  if (slateWindow && a.slateSkip !== sat.key && !weeks.some((w) => ctDayKey(w.origDeadline || w.deadline) === sat.key)) due.push("slate");
  if (cur && effectiveStatus(cur, now) === "draft" && cfg.autoOpen !== false && !cur.holdOpen && now >= openAt(cur)) due.push("open");
  if (weeks.some((w) => effectiveStatus(w, now) === "locked")) due.push("scores");
  const last = a.runs.rankings;
  if (!last || now - Date.parse(last.at) >= (last.ok ? 6 : 1) * 3600e3) due.push("rankings");
  due.push("ats"); // every hour, so each game's line is saved before kickoff
  return due;
}

async function runJobs(list, ctx) {
  const out = {};
  for (const job of list) {
    ctx.cfg = await getConfig();
    // Scores, opening and rankings recheck everything each run, so their old flags go.
    // Slate warnings stay until the slate is rebuilt. ATS warnings stay until dismissed.
    if (["scores", "open", "rankings"].includes(job)) clearJob(ctx.a, job);
    else ctx.a.flags = ctx.a.flags.filter((f) => f.key !== `${job}:failed`);
    try {
      const msg = await JOBS[job](ctx);
      ctx.a.runs[job] = { at: new Date().toISOString(), ok: true, msg, by: ctx.by };
      out[job] = { ok: true, msg };
    } catch (e) {
      console.error(job, e);
      const msg = e.message || String(e);
      ctx.a.runs[job] = { at: new Date().toISOString(), ok: false, msg, by: ctx.by };
      addFlag(ctx.a, job, "error", `${LABEL[job]} failed: ${msg} ${FALLBACK[job]}`, `${job}:failed`);
      out[job] = { ok: false, msg };
    }
  }
  return out;
}

// The scheduled run. GitHub Actions calls it every hour; Vercel's daily cron is a backup.
export async function tick({ now = Date.now(), source = "schedule" } = {}) {
  if (!(await takeLock())) return { skipped: "Another run is in progress." };
  try {
    const a = await loadAuto();
    a.lastTick = new Date(now).toISOString();
    a.lastSource = source;
    const cfg = await getConfig();
    if (cfg.autoPaused) { await saveAuto(a); return { paused: true }; }
    const due = await dueJobs(now, cfg, a);
    const ran = await runJobs(due, { now, by: "Automation", a, cfg, force: false });
    await saveAuto(a);
    return { ran };
  } finally {
    await freeLock();
  }
}

// A "run now" button in the Commissioner view. It runs even while automation is paused.
export async function runJob(job, { by = "Commissioner", force = false, now = Date.now() } = {}) {
  if (!(await takeLock())) return { ran: { [job]: { ok: false, msg: "Another run is in progress. Try again in a minute." } } };
  try {
    const a = await loadAuto();
    if (job === "slate") delete a.slateSkip;
    const ran = await runJobs([job], { now, by, a, cfg: await getConfig(), force });
    await saveAuto(a);
    return { ran };
  } finally {
    await freeLock();
  }
}

export async function dismissFlag(key) {
  const a = await loadAuto();
  a.flags = a.flags.filter((f) => f.key !== key);
  if (key && !key.endsWith(":failed")) a.dismissed.push(key);
  await saveAuto(a);
}

// What the Commissioner view shows. Adds a flag when the schedule itself stops running.
export async function autoView(now, cfg) {
  const a = await loadAuto();
  const flags = [...a.flags];
  if (!process.env.CRON_SECRET) flags.unshift({ key: "nosecret", job: "setup", level: "error", msg: "CRON_SECRET is not set in Vercel, so the schedule cannot run. Add it in Vercel and in GitHub, then redeploy. Until then, use the buttons here.", fixed: true });
  else if (!a.lastTick) flags.unshift({ key: "never", job: "setup", level: "warn", msg: "The schedule has not run yet. GitHub Actions runs it every hour. If this stays for more than two hours, open the repo's Actions tab and check Hourly automation.", fixed: true });
  else if (!cfg.autoPaused && now - Date.parse(a.lastTick) > STALE_MS) flags.unshift({ key: "stale", job: "setup", level: "error", msg: `The schedule last ran ${new Date(a.lastTick).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" })}. Open the repo's Actions tab, check Hourly automation, and tap Enable workflow if GitHub turned it off. Until then, use the buttons here.`, fixed: true });
  return { lastTick: a.lastTick, lastSource: a.lastSource || null, runs: a.runs, flags, autoOpen: cfg.autoOpen !== false, paused: !!cfg.autoPaused, labels: LABEL };
}
