// End-to-end test: runs the site on an in-memory database and drives it in a headless browser.
// Run: npm test   (needs Playwright, which this workspace has preinstalled)
import { startServer } from "./server.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = 3222;
const BASE = `http://localhost:${PORT}`;
const { server, pg } = await startServer(PORT);
const results = [];
const check = (name, ok, extra = "") => { results.push([ok ? "PASS" : "FAIL", name, extra]); if (!ok) process.exitCode = 1; };

const inAWeek = new Date(Date.now() + 2 * 86400e3);
const iso = (d) => d.toISOString();
const slate = {
  id: "2026-w10", season: 2026, week: 10, deadline: iso(inAWeek),
  games: [
    ["g1", "Florida", 17, "Georgia", 3, -10.5], ["g2", "LSU", 15, "Alabama", 10, -3.5], ["g3", "Texas", 11, "Ole Miss", 12, -2.5],
    ["g4", "Utah", 6, "BYU", 8, 1.5], ["g5", "Miami", 1, "Louisville", 99, 7.5],
  ].map(([id, a, ar, h, hr, l], i) => ({ id, slot: i + 1, away: a, awayRank: ar, home: h, homeRank: hr, homeLine: l, kickoff: iso(new Date(inAWeek.getTime() + 3600e3)), neutral: false, modelLine: l - 1, modelSource: "VSiN" })),
};

const browser = await chromium.launch();
const errors = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  return p;
}
async function pickLook(p, pre, emoji, c1, c2) {
  await p.click(`[data-pick="${pre}:emoji"][data-val="${emoji}"]`);
  await p.click(`[data-pick="${pre}:c1"][aria-label="${c1}"]`);
  await p.click(`[data-pick="${pre}:c2"][aria-label="${c2}"]`);
}

try {
  // ---- commissioner first run ----
  const c = await newPage();
  await c.goto(BASE);
  await c.waitForSelector("#firstForm:not([hidden])");
  check("first visit shows league setup", true);
  await c.fill("#fsCode", "WRONG"); await c.fill("#fsPhone", "2145550100"); await c.fill("#fsPin1", "135790"); await c.fill("#fsPin2", "135790");
  await c.click("#firstForm button[type=submit]"); await c.waitForTimeout(300);
  check("wrong setup code refused", (await c.textContent("#firstErr")).includes("not right"));
  await c.fill("#fsCode", process.env.SETUP_CODE);
  await c.click("#firstForm button[type=submit]");
  await c.waitForSelector("#setupForm:not([hidden])");
  await c.fill("#setupName", "Tator");
  await pickLook(c, "setup", "🐯", "Purple", "Gold");
  await c.click("#setupForm button[type=submit]");
  await c.waitForSelector("#app:not([hidden])");
  check("commissioner reaches the app", await c.isVisible("#commishTab"));
  await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(200);
  check("automation panel flags the missing CRON_SECRET", (await c.textContent("#v-commish")).includes("CRON_SECRET is not set"));

  // ---- load slate, add a player ----
  await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(200);
  await c.click("details.manual summary");
  await c.fill("#slateJson", JSON.stringify(slate));
  await c.click("#slateForm button[type=submit]"); await c.waitForTimeout(400);
  check("slate loads as draft", (await c.textContent("#v-commish")).includes("This week · Week 10") && (await c.textContent("#v-commish h2 .pill")) === "Draft");
  await c.click('[data-act="open"]'); await c.waitForTimeout(400);
  check("picks open", (await c.textContent("#statusBadge")).toLowerCase().includes("picks open"));
  check("the Picks are live alert shows when picks open", (await c.textContent("#reveal.live")).includes("Picks are live!"));
  await c.evaluate(() => document.querySelector("#reveal").remove());
  {
    const post = (body) => c.evaluate((b) => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()), body);
    const get = () => c.evaluate(() => fetch("/api/state").then((r) => r.json()).then((s) => s.rankings));
    const before = await get();
    const r = await post({ action: "importRankings", data: { power: { sp: { asOf: "Nov 1, 2026", teams: [{ rank: 1, team: "Georgia", rating: 28.1 }] } } }, snapshotWeek: "2026-w10" });
    const after = await get();
    check("ratings-only paste merges and keeps the polls", r.ok && r.merged.join() === "sp" && after.power.sp.asOf === "Nov 1, 2026" && JSON.stringify(after.ap) === JSON.stringify(before.ap) && JSON.stringify(after.power.vsin) === JSON.stringify(before.power.vsin), JSON.stringify(r));
    await post({ action: "importRankings", data: { power: { sp: before.power.sp } } });
  }
  check("commish sections fold", (await c.locator('#v-commish details[data-sec]').count()) >= 5);
  await c.click('[data-csec="0"]'); await c.waitForTimeout(100);
  check("collapse all shuts every section", (await c.locator('#v-commish details[data-sec][open]').count()) === 0);
  await c.click('[data-csec="1"]'); await c.waitForTimeout(100);
  check("expand all opens every section", (await c.locator('#v-commish details[data-sec]:not([open])').count()) === 0);
  await c.fill("#apName", "Mike"); await c.fill("#apPhone", "(214) 555-0123");
  await c.click("#addPlayerForm button[type=submit]"); await c.waitForTimeout(400);
  const pin = (await c.textContent(".bigpin")).trim();
  check("new player PIN shows once", /^\d{6}$/.test(pin), pin);
  await c.click('[data-dact="hidepin"]');

  // ---- player: lockout, then login ----
  const m = await newPage();
  await m.goto(BASE);
  await m.waitForSelector("#loginForm:not([hidden])");
  await m.fill("#loginPhone", "2145550123");
  for (let i = 0; i < 10; i++) { await m.fill("#loginPin", "000000"); await m.click("#loginBtn"); await m.waitForTimeout(120); }
  check("10 wrong PINs pause the login", (await m.textContent("#loginErr")).includes("15 minutes"));
  await m.fill("#loginPin", pin); await m.click("#loginBtn"); await m.waitForTimeout(300);
  check("right PIN still paused", (await m.textContent("#loginErr")).includes("Try again in"));
  await c.evaluate(() => (location.hash = "#commish")); await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  check("commissioner sees the pause", (await c.textContent("#v-commish")).includes("Paused"));
  const mikeRow = c.locator(".lgrow", { hasText: "Mike" });
  await mikeRow.locator('[data-dact="reset"]').click(); await c.waitForTimeout(400);
  const pin2 = (await c.textContent(".bigpin")).trim();
  await c.click('[data-dact="hidepin"]');
  await m.fill("#loginPin", pin2); await m.click("#loginBtn");
  await m.waitForSelector("#setupForm:not([hidden])");
  await m.fill("#setupName", "Mike T.");
  await pickLook(m, "setup", "🤠", "Maroon", "White");
  await m.click("#setupForm button[type=submit]");
  await m.waitForSelector("#app:not([hidden])");
  check("player finishes first login", !(await m.isVisible("#commishTab")));
  await m.waitForSelector("#reveal.live");
  check("a new picker sees the Picks are live alert", (await m.textContent("#reveal.live")).includes("lines are final"));
  await m.waitForTimeout(1000); await m.screenshot({ path: "dev/test-live.png" });
  await m.click("[data-rvgo]"); await m.waitForTimeout(100);
  check("Make my picks closes the alert and goes to Picks", !(await m.isVisible("#reveal")) && (await m.evaluate(() => location.hash)) === "#picks");
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  check("the alert shows once a week", !(await m.isVisible("#reveal")));
  await m.evaluate(() => { const { state, revealLive } = window.tpRecap; localStorage.removeItem("tp-seen-live-" + state.uid); state.sheetsIn = [state.uid]; revealLive(); });
  check("the alert skips a picker whose sheet is in", !(await m.isVisible("#reveal")));
  await m.evaluate(() => { const { state } = window.tpRecap; localStorage.removeItem("tp-seen-live-" + state.uid); state.sheetsIn = []; });

  // ---- picks with warnings, then complete ----
  const sides = m.locator(".side:not([disabled])");
  await sides.nth(0).click(); await sides.nth(3).click();
  await m.click("#saveBtn"); await m.waitForTimeout(200);
  check("incomplete sheet warns", (await m.textContent(".warn")).includes("no pick"));
  await m.click("#warnBack");
  await sides.nth(4).click(); await sides.nth(7).click(); await sides.nth(8).click();
  await m.locator(".flagbtn").nth(1).click();
  await m.fill("#tbInput", "51");
  await m.selectOption("#survSel", "g1|home");
  check("survivor conflict warns", (await m.locator("#survPanel .conflict").count()) === 1);
  await m.selectOption("#survSel", "g5|away");
  await m.click("#saveBtn"); await m.waitForTimeout(500);
  check("complete sheet saves", (await m.textContent(".phist summary")).includes("last saved"));
  const before = await c.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("picks hidden from others before the lock", !before.reveals["2026-w10"]);
  const ss = Object.values((before.sheetStatus || {})["2026-w10"] || {});
  check("commissioner gets sheet status without sides", ss.length === 1 && ss[0].games.length === 5 && ss[0].flag && ss[0].tb && ss[0].surv && !/"(home|away)"/.test(JSON.stringify(before.sheetStatus)), JSON.stringify(before.sheetStatus));
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  const cm = await c.textContent("#v-commish");
  check("League members shows who is in and who is complete", cm.includes("Week 10 sheets: 1 complete, 0 missing parts, 1 not in") && cm.includes("Week 10: Complete") && cm.includes("Week 10: No sheet"), cm.slice(cm.indexOf("League members"), cm.indexOf("League members") + 400));
  // The commissioner saves a partial sheet: two picks, no field goal, no tiebreaker.
  await c.evaluate(() => (location.hash = "#picks")); await c.waitForTimeout(300);
  const cs = c.locator(".side:not([disabled])");
  await cs.nth(0).click(); await cs.nth(2).click();
  await c.click("#saveBtn"); await c.waitForTimeout(200);
  if (await c.isVisible("#warnSave")) { await c.click("#warnSave"); await c.waitForTimeout(400); }
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  const cm2 = await c.textContent("#v-commish");
  check("partial sheet lists what is missing", cm2.includes("1 missing parts") && cm2.includes("Missing: 2 of 5 picks, no field goal, no tiebreaker"), cm2.slice(cm2.indexOf("League members"), cm2.indexOf("League members") + 500));

  // ---- commissioner locks early, then unlocks ----
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  await c.click('[data-act="lock"]'); await c.waitForTimeout(150);
  check("lock asks for a second tap", (await c.textContent('[data-act="lock"]')).includes("Tap again"));
  await c.click('[data-act="lock"]'); await c.waitForTimeout(500);
  const lockedSave = await m.evaluate(() => fetch("/api/picks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekId: "2026-w10", sel: { g1: "home" } }) }).then((r) => r.status));
  check("early lock refuses saves", lockedSave === 423, String(lockedSave));
  const afterLock = await m.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("early lock shows everyone's picks", !!afterLock.reveals["2026-w10"]);
  await c.waitForSelector('[data-act="unlock"]');
  await c.fill("#unlockAt", await c.evaluate(() => { const d = new Date(Date.now() + 3 * 3600e3); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }));
  await c.click('[data-act="unlock"]'); await c.waitForTimeout(500);
  const afterUnlock = await m.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("unlock hides picks again", !afterUnlock.reveals["2026-w10"]);
  const reSave = await m.evaluate(() => fetch("/api/picks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekId: "2026-w10", sel: { g1: "away", g2: "home", g3: "home", g4: "away", g5: "away" }, lock: "g2", tb: 51, surv: { g: "g5", s: "away" }, abbr: {} }) }).then((r) => r.status));
  check("players can save again after unlock", reSave === 200, String(reSave));
  const logNow = afterUnlock.log.map((l) => l.action);
  check("lock and unlock are in the commissioner log", logNow.includes("Locked picks early") && logNow.includes("Unlocked picks"));

  // ---- move the deadline into the past: the server must refuse saves ----
  const past = iso(new Date(Date.now() - 60e3));
  await pg.query("update weeks set data = jsonb_set(data, '{deadline}', to_jsonb($1::text)) where id = '2026-w10'", [past]);
  const refused = await m.evaluate(() => fetch("/api/picks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekId: "2026-w10", sel: { g1: "home" } }) }).then((r) => r.status));
  check("server refuses a save after the deadline", refused === 423, String(refused));
  await m.reload(); await m.waitForSelector("#app:not([hidden])");
  check("week shows locked", (await m.textContent("#statusBadge")).toLowerCase().includes("locked"));
  check("picks revealed after the lock", (await m.locator(".cbar").count()) > 0);
  check("Robo-Sharp shows in the pick lists after the lock", (await m.locator(".whocols .wn.bot").count()) === 5);
  check("Robo-Sharp model line hides after the lock", (await m.locator(".game .model").count()) === 0);
  const order = await m.evaluate(() => [...document.querySelectorAll("#v-picks .game")].map((e) => e.id));
  check("same kickoff: better AP game first", order.join() === "g-g4,g-g1,g-g3,g-g2,g-g5", order.join());
  const live = await m.evaluate(() => {
    const { gameClock, coverOdds, coverTier } = window.tpLive;
    const g = { homeLine: -3.5 };
    const r = (h, a, period, dclock, status) => ({ home: h, away: a, period, dclock, clock: dclock ? +dclock.split(":")[0] * 60 + +dclock.split(":")[1] : null, status: status || "", final: false, void: false });
    return {
      q3: gameClock(r(14, 7, 3, "8:42")).label,
      half: gameClock(r(14, 7, 2, "0:00", "Halftime")).label,
      ot: gameClock(r(21, 21, 5, "0:00")).label,
      late: coverTier(coverOdds(g, r(31, 10, 4, "2:00"), "home"))[1],
      lost: coverTier(coverOdds(g, r(10, 31, 4, "2:00"), "home"))[1],
      early: coverTier(coverOdds(g, r(3, 0, 1, "12:00"), "home"))[1],
      oldText: gameClock({ home: 17, away: 17, status: "10:00 - 3rd", final: false }).label,
      oldText2: gameClock({ home: 17, away: 17, status: "3rd 4:12", final: false }).label,
      oldTier: coverTier(coverOdds({ homeLine: -3.5 }, { home: 27, away: 0, status: "7:54 - 3rd", final: false }, "home"))[1],
      grows: coverOdds(g, r(14, 7, 4, "1:00"), "home") > coverOdds(g, r(14, 7, 2, "10:00"), "home"),
    };
  });
  check("clock labels read Q3 · 8:42, Halftime, OT", live.q3 === "Q3 · 8:42" && live.half === "Halftime" && live.ot === "OT", JSON.stringify(live));
  check("status text alone still gives the clock and a tier", live.oldText === "Q3 · 10:00" && live.oldText2 === "Q3 · 4:12" && live.oldTier === "safe", JSON.stringify(live));
  check("cover tiers: safe late lead, red late deficit, toss up early", live.late === "safe" && live.lost === "red" && live.early === "toss" && live.grows, JSON.stringify(live));

  // ---- scores and final ----
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  await c.click('[data-act="run"][data-job="scores"]');
  await c.waitForFunction(() => document.querySelector("#v-commish").textContent.includes("Pull scores failed"), null, { timeout: 30000 });
  check("a failed ESPN pull shows as a flag", true);
  await c.evaluate(() => window.scrollTo(0, 0)); await c.screenshot({ path: "dev/test-auto.png", fullPage: false });
  const scores = { g1: [20, 31], g2: [24, 27], g3: [17, 21], g4: [28, 24], g5: [35, 20] };
  for (const [g, [a, h]] of Object.entries(scores)) {
    await c.fill(`#ra-${g}`, String(a)); await c.fill(`#rh-${g}`, String(h)); await c.selectOption(`#rf-${g}`, "final");
  }
  await c.click('[data-act="scores"]'); await c.waitForTimeout(400);
  await c.click('[data-act="final"]'); await c.waitForTimeout(400);
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  const tags = await m.$$eval("#v-picks .side .cv", (e) => e.map((x) => x.textContent + "|" + x.className));
  check("result reveal shows the games that went final", (await m.locator("#reveal .rvlist li").count()) === 5, await m.locator("#reveal").textContent().catch(() => "none"));
  await m.waitForTimeout(900); await m.screenshot({ path: "dev/test-reveal.png" });
  await m.click("[data-rvclose]");
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  check("result reveal fires once on this device", (await m.locator("#reveal").count()) === 0);
  await m.screenshot({ path: "dev/test-badges.png" });
  check("cover badges read from your side", tags.length === 5 && tags.every((t) => t === "You covered|cv good" || t === "Beat you|cv bad"), tags.join());
  check("recap banner shows on Picks after a final week", (await m.locator(".recapban").count()) === 1);
  await m.click(".recapban"); await m.waitForTimeout(300);
  const rc = await m.textContent("#v-recap");
  check("recap shows the week and its winner", rc.includes("Week 10 recap") && rc.includes("Won the week"), rc.slice(0, 200));
  check("recap has fun facts", (await m.locator(".rccard").count()) >= 4, String(await m.locator(".rccard").count()));
  check("recap never shows undefined or NaN", !/undefined|NaN/.test(rc), rc);
  const rw = await m.evaluate(() => document.documentElement.scrollWidth);
  check("recap has no sideways scroll on a phone", rw <= 390, String(rw));
  await m.screenshot({ path: "dev/test-recap.png", fullPage: true });
  const single = await m.evaluate(() => {
    const { state, showReveal, currentWeekId } = window.tpRecap; const w = state.weeks[currentWeekId()]; const g = w.games[0]; const out = {};
    const run = (won, fg) => { showReveal(w, {}, [{ g, won, fg, by: 3.5, txt: "UGA -10.5" }]); const e = document.querySelector("#reveal"); return e.className + "|" + e.querySelector("h2").textContent; };
    out.win = run(true, false); out.loss = run(false, false); out.fg = run(true, true); document.querySelector("#reveal").remove(); return out;
  });
  check("single game reveal wording", single.win === "win|You covered!" && single.loss === "loss|Bummer, you didn\u2019t cover." && single.fg === "win|Field goal is good!", JSON.stringify(single));
  await m.evaluate(() => localStorage.removeItem(window.tpRecap.seenKey()));
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  check("first visit after a week closes stays quiet", (await m.locator("#reveal").count()) === 0);
  // A full league: 14 pickers over two weeks, drawn on the page with made-up picks.
  const full = await m.evaluate(() => {
    const { state, recapFacts, renderRecap, currentWeekId } = window.tpRecap;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const base = state.weeks[currentWeekId()]; const wid2 = base.id + "b";
    state.weeks[wid2] = { ...base, id: wid2, week: base.week + 1 };
    const ids = Array.from({ length: 14 }, (_, i) => "p" + i);
    const nameList = ["Connor West", "Ryan Mills", "Zach Wells", "Tim Reed", "Sam Ford", "Luke Hale", "Drew Pope", "Matt Cole", "Ben Hart", "Cody Lane", "Jake Moss", "Nate Webb", "Evan Ross", "Pete Dunn"];
    ids.forEach((id, i) => (state.names[id] = nameList[i]));
    for (const wid of [base.id, wid2]) {
      const players = {}; const end = Date.parse(base.deadline);
      ids.forEach((id, i) => { const sel = {}; for (const g of base.games) sel[g.id] = rnd() < 0.55 ? "home" : "away";
        players[id] = { sel, lock: base.games[i % 5].id, tb: 30 + Math.floor(rnd() * 60), history: [{ at: new Date(end - (i + 1) * 3 * 3600e3).toISOString(), note: "saved" }] }; });
      state.reveals[wid] = { players, excluded: [], lockedAt: base.deadline };
    }
    const scoreBig = { g1: [3, 58], g2: [31, 28], g3: [17, 21], g4: [28, 24], g5: [10, 45] };
    state.weeks[wid2].results = Object.fromEntries(Object.entries(scoreBig).map(([k, [a, h]]) => [k, { away: a, home: h, final: true, void: false }]));
    const facts = recapFacts(wid2); const text = JSON.stringify(facts);
    const bad = facts.filter((f) => f.tone === "bad" && ["Intentional grounding", "Loss of downs"].includes(f.tag)).map((f) => f.title.split(" ")[0]);
    state.recapWeek = wid2; location.hash = "#recap"; renderRecap();
    return { n: facts.length, tags: facts.map((f) => f.tag), text, bad, width: document.documentElement.scrollWidth };
  });
  check("recap works for a full league", full.n >= 10 && !/undefined|NaN/.test(full.text), JSON.stringify(full.tags));
  check("a negative award never repeats a picker", new Set(full.bad).size === full.bad.length, full.bad.join());
  check("full recap has no sideways scroll", full.width <= 390, String(full.width));
  await m.waitForTimeout(100); await m.screenshot({ path: "dev/test-recap-full.png", fullPage: true });
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(200);
  check("recap banner clears once read", (await m.locator(".recapban").count()) === 0);
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.evaluate(() => (location.hash = "#standings")); await m.waitForTimeout(300);
  const st = await m.textContent("#v-standings");
  check("standings show the week", st.includes("Week 10") && st.includes("Mike T."));
  check("Robo-Sharp plays", st.includes("Robo-Sharp"));
  // Survivor end and resurrection, drawn on the page with made-up weeks.
  const sv = await m.evaluate(() => {
    const { state, survivorBoard, survivorGrid, survivorRevived, survivorOpen, renderSurvivor } = window.tpRecap;
    const saved = { weeks: state.weeks, reveals: state.reveals, config: state.config, roster: state.roster };
    const mk = (id, week, day, res) => ({ id, week, status: "final", deadline: `2026-${day}T16:15:00Z`, games: [{ id: "a", home: "H1", away: "A1", homeLine: -1.5, slot: 1 }, { id: "b", home: "H2", away: "A2", homeLine: -1.5, slot: 2 }], results: { a: { home: res ? 10 : 0, away: res ? 0 : 10, final: true }, b: { home: res ? 10 : 0, away: res ? 0 : 10, final: true } } });
    state.config = { ...saved.config, survivorStart: "2026-w11", survivorEnd: "2026-11-29T06:00:00Z" }; state.roster = ["x", "y", "z"];
    const pick = (t) => ({ sel: {}, surv: t });
    const load = (weeks, reveals) => { state.weeks = weeks; state.reveals = reveals; };
    const home = (g) => ({ g, s: "home" }), away = (g) => ({ g, s: "away" });
    const out = {};
    // Week 11: z goes out. Week 12: x and y both go out, so they are resurrected. Week 13 is the last week.
    const w = { "2026-w11": mk("2026-w11", 11, "11-14", true), "2026-w12": mk("2026-w12", 12, "11-21", true), "2026-w13": mk("2026-w13", 13, "11-28", true), "2026-w14": { ...mk("2026-w14", 14, "12-05", true), status: "open" } };
    const r = (a, b, c) => ({ players: { x: pick(a), y: pick(b), z: pick(c) } });
    load({ "2026-w11": w["2026-w11"], "2026-w12": w["2026-w12"] }, { "2026-w11": r(home("a"), home("b"), away("a")), "2026-w12": r(away("a"), away("b"), null) });
    const a1 = survivorBoard().filter((x) => x.pid !== "bot"); out.rev = Object.keys(survivorRevived()); out.alive = a1.filter((x) => x.alive).map((x) => x.pid).join();
    out.grid = survivorGrid().rows.filter((x) => x.alive && x.pid !== "bot").map((x) => x.pid).sort().join();
    // Both lose in the last week: they share, nobody is revived.
    load({ "2026-w11": w["2026-w11"], "2026-w12": w["2026-w12"], "2026-w13": w["2026-w13"] }, { "2026-w11": r(home("a"), home("b"), away("a")), "2026-w12": r(away("a"), away("b"), null), "2026-w13": r(away("a"), away("b"), null) });
    out.lastRev = Object.keys(survivorRevived()); out.lastAlive = survivorBoard().filter((x) => x.pid !== "bot" && x.alive).length;
    // A late joiner misses the first week: out, and everyone's resurrection does not bring them back.
    state.roster = ["x", "y", "late"];
    load({ "2026-w11": w["2026-w11"] }, { "2026-w11": { players: { x: pick(away("a")), y: pick(away("b")) } } });
    const lb = survivorBoard().filter((x) => x.pid !== "bot");
    out.lateRev = Object.keys(survivorRevived()).join(); out.lateAlive = lb.filter((x) => x.alive).map((x) => x.pid).sort().join(); out.lateOut = lb.find((x) => x.pid === "late").out?.week;
    out.lateGrid = survivorGrid().rows.find((x) => x.pid === "late").alive;
    state.roster = ["x", "y", "z"];
    // Two pickers still alive after the last week share the title. Week 14 has no Survivor.
    load({ "2026-w13": w["2026-w13"], "2026-w14": w["2026-w14"] }, { "2026-w13": r(home("a"), home("b"), away("a")) });
    state.config.survivorStart = "2026-w13"; location.hash = "#survivor"; renderSurvivor();
    out.share = document.querySelector("#v-survivor .svwin")?.textContent || ""; out.open14 = survivorOpen("2026-w14"); out.open13 = survivorOpen("2026-w13");
    // One picker left who loses is not revived.
    load({ "2026-w11": w["2026-w11"], "2026-w12": w["2026-w12"] }, { "2026-w11": r(home("a"), away("b"), away("a")), "2026-w12": r(away("a"), null, null) });
    state.config.survivorStart = "2026-w11"; out.lone = Object.keys(survivorRevived()).length;
    Object.assign(state, saved); return out;
  });
  check("everyone out in one week are resurrected", sv.rev.join() === "2026-w12" && sv.alive === "x,y" && sv.grid === "x,y", JSON.stringify(sv));
  check("no resurrection in Survivor's last week", sv.lastRev.join() === "2026-w12" && sv.lastAlive === 0, JSON.stringify(sv));
  check("pickers alive after the last week share the title", sv.share.includes("share Survivor"), sv.share);
  check("no Survivor after the Nov 28 week", sv.open14 === false && sv.open13 === true, JSON.stringify(sv));
  check("a lone picker is not resurrected", sv.lone === 0, JSON.stringify(sv));
  check("a late joiner is out and stays out through a resurrection", sv.lateRev === "2026-w11" && sv.lateAlive === "x,y" && sv.lateOut === 11 && sv.lateGrid === false, JSON.stringify(sv));
  await m.reload(); await m.waitForSelector("#app:not([hidden])");
  // Preview panel, drawn on the page with a made-up preview.
  await m.evaluate(() => { const { state, render } = window.tpRecap; state.preview = { week: 11, set: false, autoOpen: true, linesAt: new Date().toISOString(), games: Object.values(state.weeks)[0].games.slice(0, 5).map((g, i) => ({ ...g, slot: i + 1, awayRank: 3, homeRank: 99 })) }; location.hash = "#picks"; render(); });
  await m.waitForTimeout(200);
  const pvt = await m.textContent("#pvbox");
  check("the preview says picks are not open and lists the games", pvt.includes("You cannot pick yet") && pvt.includes("Tuesday or Wednesday") && (await m.locator("#pvbox .pvg").count()) === 5, pvt.slice(0, 200));
  check("the preview has no pick buttons", (await m.locator("#pvbox button").count()) === 0);
  await m.evaluate(() => { const { state, render } = window.tpRecap; state.preview.set = true; render(); });
  check("a set slate says the games are set", (await m.textContent("#pvbox")).includes("The 10 games are set"));
  await m.setViewportSize({ width: 390, height: 800 }); await m.waitForTimeout(100);
  check("the preview has no sideways scroll on a phone", (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await m.locator("#pvbox").screenshot({ path: "dev/test-preview.png" });
  await m.evaluate(() => { const { state, render } = window.tpRecap; state.preview = null; render(); });

  // Picker stats on real data
  await m.evaluate(() => (location.hash = "#players")); await m.waitForTimeout(300);
  const ps = await m.textContent("#v-players");
  check("Pickers shows career wins, tendencies, and past picks", ps.includes("Career wins") && ps.includes("Your tendencies") && ps.includes("Past picks"));
  check("past picks show the week, record, and rank", /Week 10.*\d pts/.test(ps) && ps.includes("Covered by") && ps.includes("Missed by"), ps.slice(0, 300));
  check("past picks list every game", (await m.locator("#v-players .wkh[open] .pp").count()) === 5);
  // A dummy two season league, drawn into the page by the test only.
  const full2 = await c.evaluate(() => {
    const { state } = window.tpRecap; const { careerPanel, insightPanel, closePanel, pastPanel } = window.tpStats;
    const sampleStats = (() => { const SAMPLE_NAMES=["Connor West","Ryan Mills","Zach Wells","Tim Reed","Sam Ford","Luke Hale","Drew Pope","Matt Cole","Ben Hart","Cody Lane"];
function sampleStats(){if(sampleStats.D)return sampleStats.D;let seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const T=["Georgia","Alabama","LSU","Ohio State","Texas","Miami","Oregon","Notre Dame","Ole Miss","Tennessee","Utah","BYU","Indiana","Florida","USC","Michigan","Clemson","Oklahoma","Kentucky","Texas Tech"];
  const ids=SAMPLE_NAMES.map((n,i)=>{const id="sample"+i;state.names[id]=n;return id});const weeks={},reveals={},closing={};
  const plan=[[2025,12],[2025,13],[2026,6],[2026,7],[2026,8],[2026,9]];
  plan.forEach(([season,week],wi)=>{const k=season+"-w"+String(week).padStart(2,"0");const pool=[...T].sort(()=>rnd()-.5);const games=[];const results={};
    for(let i=0;i<10;i++){const id=k+"g"+i;const homeLine=-(Math.floor(rnd()*20)+.5)*(rnd()<.7?1:-1);const g={id,slot:i+1,away:pool[i*2],home:pool[i*2+1],homeLine,modelLine:homeLine+(rnd()-.5)*8,kickoff:new Date(2026,9,3+wi).toISOString(),neutral:false};games.push(g);
      const mv=[0,0,.5,-.5,1,-1,1.5,-1.5,3,-3][Math.floor(rnd()*10)];closing[id]=homeLine+mv;const tot=30+Math.floor(rnd()*50);const diff=Math.round(-homeLine+(rnd()-.5)*30);const home=Math.max(0,Math.round((tot+diff)/2));results[id]={away:Math.max(0,tot-home),home,final:true,void:false}}
    weeks[k]={id:k,season,week,status:"final",deadline:new Date(2026,9,3+wi).toISOString(),games,results};
    const players={};ids.forEach((id,i)=>{const sel={};for(const g of games)sel[g.id]=rnd()<.5?"home":"away";const a=games[(i+wi)%10];players[id]={sel,lock:a.id,tb:35+Math.floor(rnd()*50),surv:season===2026?{g:a.id,s:sel[a.id]}:null}});reveals[k]={players}});
  const wids=Object.keys(weeks).sort();
  return sampleStats.D={ids,wids,week:k=>weeks[k],players:k=>reveals[k].players,closing,done:s=>s<2026,survivor:s=>s===2025?[ids[1]]:[ids[2],ids[5]],bowl:s=>s===2025?[ids[3]]:[],cfp:s=>s===2025?[ids[0],ids[4]]:[]}}
 return sampleStats; })();
    const D = sampleStats(); const el = document.querySelector("#v-players");
    const draw = (p) => (el.innerHTML = careerPanel(D, p) + insightPanel(D, p) + closePanel(D) + pastPanel(D, p));
    const stat = () => el.querySelector(".stats").textContent;
    draw("sample0"); const text = el.textContent; const co = stat();
    const row = [...el.querySelectorAll("table.plain tbody tr")].find((t) => t.textContent.includes("Robo-Sharp"));
    const out = { text, co, rob: row ? row.cells[0].textContent : "none", width: document.documentElement.scrollWidth };
    draw("sample3"); out.bowl = stat();
    const k = D.wids[D.wids.length - 1]; const win = window.tpStats.statWinners(D, k)[0]; draw(win); out.before = stat();
    D.week(k).confChamp = true; draw(win); out.after = stat(); return out;
  });
  check("stats panels fill with a full season", full2.text.includes("Hurt them most") && full2.text.includes("Beat the close") && full2.text.includes("Past picks") && !full2.text.includes("No team has burned"), full2.text.slice(0, 300));
  check("stats have no undefined or NaN", !/undefined|NaN|null/.test(full2.text));
  check("Robo-Sharp is in Beat the close with no rank", full2.rob === "", full2.rob);
  check("career counts season, Bowl, and CFP wins", /Bowl wins1/.test(full2.bowl), full2.bowl);
  { const num = (t, l) => +(t.match(new RegExp(l + "(\\d+)")) || [])[1];
    check("Conference Champion Week wins count apart from weekly wins", num(full2.after, "Weekly wins") === num(full2.before, "Weekly wins") - 1 && num(full2.after, "Conf Champ wins") === num(full2.before, "Conf Champ wins") + 1, full2.before + " | " + full2.after); }
  check("a shared win is a Co-Champion credit", /Co-Champion[1-9]/.test(full2.co), full2.co);
  check("stats have no sideways scroll on a phone", full2.width <= 390, String(full2.width));
  check("the sample preview is gone", (await m.locator("[data-sample]").count()) === 0);
  const bc = await m.evaluate(() => {
    const { closeOf } = window.tpStats;
    const g = { id: "a", homeLine: -6.5 }, g2 = { id: "b", homeLine: 3.5 }, g3 = { id: "c", homeLine: -2.5 }; const w = { games: [g, g2, g3], results: {} };
    const D = { wids: ["k"], week: () => w, closing: { a: -9.5, b: 2.5, c: -2.5 }, players: () => ({ p: { sel: { a: "home", b: "away", c: "home" } } }) };
    return closeOf(D, "p");
  });
  check("Beat the close math: moved games only, signed gains", bc.n === 2 && bc.beat === 1 && bc.flat === 1 && bc.avg === 1, JSON.stringify(bc));
  // Payouts on the Rules page
  await m.evaluate(() => { location.hash = "#rules"; document.querySelector("#payouts").open = true; }); await m.waitForTimeout(200);
  const payTxt = async () => [await m.textContent("#payPot"), await m.textContent("#payTotal"), await m.textContent("#payRows")];
  let pay = await payTxt();
  check("Payouts say 2026 is free and hypothetical", (await m.textContent("#payouts .paynote")).includes("free test season"));
  const shares = await m.$$eval("#payRows tr td:nth-child(2)", (e) => e.map((x) => parseFloat(x.textContent)));
  check("payout shares add up to 100% at 13 weeks and 4 runs", shares.reduce((a, b) => a + b, 0) + 12 * 1 + 3 * 3.75 === 100, shares.join());
  check("pot starts at $2,000 and $400 for 1st", pay[0].includes("$2,000") && pay[2].includes("$400"), pay[0]);
  await m.fill("#payWeeks", "2"); await m.selectOption("#payBowl", "5");
  pay = await payTxt();
  check("scenario adds up: 2 weekly wins and 2nd in the Bowl is $140", pay[1].includes("$140") && pay[1].includes("+$40"), pay[1]);
  await m.fill("#payRuns", "1"); await m.fill("#paySplit", "2");
  pay = await payTxt();
  check("a shared Survivor run splits its prize", pay[1].includes("$178"), pay[1]);
  await m.selectOption("#payAN", "1"); pay = await payTxt();
  check("Army-Navy adds 1% of the pot", pay[1].includes("$198"), pay[1]);
  await m.selectOption("#payAN", "0");
  check("the calculator stops at 13 weeks and 4 runs", (await m.getAttribute("#payWeeks", "max")) === "13" && (await m.getAttribute("#payRuns", "max")) === "4");
  const contests = await m.$eval("#contests", (e) => e.textContent);
  check("the Rules page lists every planned contest", ["Second Survivor run", "Conference Champion Week", "Army-Navy", "Bowl challenge", "CFP bracket", "Survivor in 2027"].every((x) => contests.includes(x)));
  await m.click('[data-paybuy="25"]'); pay = await payTxt();
  check("buy-in chips change the dollars", pay[0].includes("$500") && pay[2].includes("$100"), pay[0]);
  check("the Rules page does not mention upkeep", !/upkeep/i.test(await m.$eval("#payouts", (e) => e.textContent)));
  const pw = await m.evaluate(() => document.documentElement.scrollWidth);
  check("payouts have no sideways scroll on a phone", pw <= 390, String(pw));
  const tw = await m.$eval("#payouts .tablewrap", (e) => e.scrollWidth - e.clientWidth);
  check("payout table fits a phone without scrolling", tw <= 0, String(tw));
  await m.click('[data-paybuy="100"]');
  await m.locator("#payouts").screenshot({ path: "dev/test-payouts.png" });
  await m.evaluate(() => (location.hash = "#survivor")); await m.waitForTimeout(300);
  check("survivor board fills in", (await m.textContent("#v-survivor")).includes("MIA"));
  await m.evaluate(() => (location.hash = "#rules")); await m.waitForTimeout(300);
  check("log shows commissioner actions", (await m.textContent("#logPanel")).includes("Marked week final"));
  // ---- Teams: Polls, Power, ATS ----
  const tgames = { games: {
    1: { id: "1", wk: 9, d: "2026-10-31T19:30:00Z", a: "Florida", h: "Georgia", as: 20, hs: 31, n: false, l: -10.5, t: 48.5 },
    2: { id: "2", wk: 9, d: "2026-10-31T23:30:00Z", a: "LSU", h: "Alabama", as: 27, hs: 24, n: false, l: -3, t: 51.5 },
    3: { id: "3", wk: 1, d: "2026-08-30T17:00:00Z", a: "Austin Peay", h: "Georgia", as: 3, hs: 45, n: false, l: null, t: null },
  }, weeksDone: [1, 9], backfilledAt: "2026-10-29T18:00:00Z", updatedAt: "2026-10-29T18:00:00Z" };
  await pg.query("insert into kv (key, value) values ('teamGames', $1::jsonb) on conflict (key) do update set value = excluded.value", [JSON.stringify(tgames)]);
  const reddit = { asOf: "Week 9", stamp: "2026-w9", source: "r/CFB poll", teams: [{ rank: 1, team: "Georgia", pts: 7000, fpv: 200, prev: 3 }, { rank: 2, team: "Miami", pts: 6800, fpv: 50, prev: 1 }, { rank: 3, team: "Tulane", pts: 900, fpv: 0, prev: "NR" }], others: [{ team: "UTSA", pts: 361 }] };
  await pg.query("update kv set value = jsonb_set(value, '{reddit}', $1::jsonb) where key = 'rankings'", [JSON.stringify(reddit)]);
  await m.reload(); await m.waitForSelector("#app:not([hidden])");
  await m.evaluate(() => (location.hash = "#rankings")); await m.waitForTimeout(400);
  const segs = await m.locator("#v-rankings [data-rank]").allTextContents();
  check("Teams has Polls, Power, ATS", segs.join(",") === "Polls,Power,ATS", segs.join(","));
  check("Polls lists teams from all three polls", (await m.locator('#v-rankings [data-steam="Tulane"]').count()) === 1 && (await m.locator("#v-rankings .g-pol[data-steam]").count()) >= 26);
  await m.click('[data-tsort="polls:rc"]'); await m.waitForTimeout(200);
  check("sorting by r/CFB puts its #1 first", (await m.getAttribute("#v-rankings .g-pol[data-steam] >> nth=0", "data-steam")) === "Georgia");
  await m.click('[data-steam="Georgia"]'); await m.waitForTimeout(200);
  let det = await m.textContent(".sdet");
  check("team card shows polls, record, FCS game, and cover", det.includes("r/CFB 1") && det.includes("2-0") && det.includes("1 FCS game") && det.includes("Covered") && det.includes("no line"), det.slice(0, 240));
  let sw = await m.evaluate(() => document.documentElement.scrollWidth);
  check("Polls has no sideways scroll on a phone", sw <= 390, String(sw));
  await m.click('[data-rank="power"]'); await m.waitForTimeout(200);
  check("Power opens on ratings", (await m.locator("#v-rankings .g-rat[data-steam]").count()) > 100);
  await m.click('[data-pmode="scoring"]'); await m.waitForTimeout(200);
  check("Power scoring lists FBS teams from the game log", (await m.locator("#v-rankings .g-sco[data-steam]").count()) === 4, String(await m.locator("#v-rankings .g-sco[data-steam]").count()));
  await m.click('[data-tsort="scoring:pag"]'); await m.waitForTimeout(200);
  check("sorting by PA puts the best defense first", (await m.getAttribute("#v-rankings .g-sco[data-steam] >> nth=0", "data-steam")) === "Georgia");
  sw = await m.evaluate(() => document.documentElement.scrollWidth);
  check("Power has no sideways scroll on a phone", sw <= 390, String(sw));
  await m.click('[data-rank="ats"]'); await m.waitForTimeout(200);
  const atsText = await m.textContent("#v-rankings");
  check("ATS falls back to season records when many games lack a line", atsText.includes("Season records come from") && atsText.includes("33% of logged games"), atsText.slice(0, 300));
  await pg.query("update kv set value = jsonb_set(value, '{games,3,l}', '-40') where key = 'teamGames'");
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.evaluate(() => (location.hash = "#rankings")); await m.waitForTimeout(400);
  await m.click('[data-rank="ats"]'); await m.waitForTimeout(400);
  const atsRow = await m.textContent('#v-rankings .g-ats[data-steam="Georgia"]');
  check("ATS uses the game log when every game has a line", (await m.textContent("#v-rankings")).includes("closing lines from ESPN") && atsRow.includes("2-0+1.3"), atsRow);
  sw = await m.evaluate(() => document.documentElement.scrollWidth);
  check("ATS has no sideways scroll on a phone", sw <= 390, String(sw));
  const width = await m.evaluate(() => document.documentElement.scrollWidth);
  check("no sideways scroll on a phone", width <= 390, String(width));
  await m.evaluate(() => (location.hash = "#profile")); await m.waitForTimeout(300);
  check("profile shows own number only", (await m.textContent("#v-profile")).includes("(214) 555-0123"));
  const bg = () => m.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightBg = await bg();
  await m.click('[data-theme-set="dark"]'); await m.waitForTimeout(150);
  const darkBg = await bg();
  check("Dark choice switches the page to dark colors", (await m.getAttribute("html", "data-theme")) === "dark" && darkBg !== lightBg, lightBg + " -> " + darkBg);
  await m.reload(); await m.waitForSelector("#app:not([hidden])");
  check("Dark choice stays after a reload", (await m.getAttribute("html", "data-theme")) === "dark");
  await m.evaluate(() => (location.hash = "#profile")); await m.waitForTimeout(300);
  check("Profile shows the saved choice", (await m.getAttribute('[data-theme-set="dark"]', "aria-pressed")) === "true");
  await m.click('[data-theme-set="auto"]'); await m.waitForTimeout(150);
  check("Auto hands the choice back to the device", (await m.getAttribute("html", "data-theme")) === null && (await bg()) === lightBg);
  const mstate = await m.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("players never receive phone numbers", !JSON.stringify(mstate.players).includes("5550100") && !mstate.logins);
  check("players never receive sheet status", !mstate.sheetStatus);
  const adminTry = await m.evaluate(() => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "addPlayer", phone: "2145559999" }) }).then((r) => r.status));
  check("players cannot use commissioner actions", adminTry === 403);
  // ---- rival, what you need, your week, Iron Man, chip, line moved: a made-up league drawn on the page ----
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  const race = await m.evaluate(() => {
    const { state, rivalOf, raceFacts, yourWeek, ironOf, ironSeasons, realStats, survNeeded, renderPicks, missingItems, renderRecap } = window.tpRecap;
    const me = state.uid; const base = Object.values(state.weeks)[0];
    const games = [1, 2, 3, 4].map((n, i) => ({ id: "x" + n, slot: n, away: "Florida", awayRank: 99, home: "Georgia", homeRank: 99, homeLine: -3.5, kickoff: new Date(Date.now() - 86400e3 + i * 1000).toISOString(), neutral: false }));
    const past = new Date(Date.now() - 864e5).toISOString(), soon = new Date(Date.now() + 864e5).toISOString();
    const homeWin = { away: 10, home: 20, final: true, void: false }, awayWin = { away: 20, home: 10, final: true, void: false };
    const all = (s) => Object.fromEntries(games.map((g) => [g.id, s]));
    for (const k of Object.keys(state.weeks)) { delete state.weeks[k]; delete state.reveals[k]; }
    state.names.a = "Ann Lee"; state.names.b = "Bob Ray"; state.names.c = "Cal Poe";
    const wk = (id, week, status, deadline, results) => { state.weeks[id] = { id, season: 2026, week, status, deadline, games, results, scored: true }; };
    wk("2026-w20", 20, "final", past, all(homeWin));
    state.reveals["2026-w20"] = { excluded: [], players: {
      a: { sel: all("home"), lock: "x1", tb: 30, surv: { g: "x1", s: "home", team: "Georgia" } }, b: { sel: all("home"), tb: 30 }, [me]: { sel: { ...all("home"), x4: "away" }, tb: 30, surv: { g: "x1", s: "away", team: "Florida" } }, c: { sel: { x1: "away" }, tb: 30 } } };
    state.config = { ...state.config, season: 2026, currentWeek: "2026-w21", survivorStart: "2026-w20", survivorEnd: "2099-01-01T00:00:00Z" };
    wk("2026-w21", 21, "locked", past, { x1: homeWin, x2: awayWin });
    state.reveals["2026-w21"] = { excluded: [], players: { a: { sel: all("home"), lock: "x1", tb: 30 }, b: { sel: all("home"), tb: 30 }, [me]: { sel: all("away"), lock: "x3", tb: 30 }, c: { sel: all("home"), tb: 30 } } };
    const out = {};
    out.leaderRival = rivalOf("a", "2026-w21"); out.myRival = rivalOf(me, "2026-w21"); out.bRival = rivalOf("b", "2026-w21");
    out.locked = raceFacts("2026-w21");
    out.noRivalFirstWeek = rivalOf(me, "2026-w20");
    state.weeks["2026-w21"].results = { ...all(homeWin), x3: awayWin };
    state.weeks["2026-w21"].status = "final";
    out.yw = (({ w, l, pts, place, was, now, rival, best, worst }) => ({ w, l, pts, place, was, now, rival, best: best && best.g.id, worst: worst && worst.g.id }))(yourWeek("2026-w21"));
    state.recapWeek = "2026-w21"; renderRecap(); out.recap = document.querySelector("#v-recap .yw").textContent;
    const D = realStats();
    out.ironMe = ironOf(D, me, 2026); out.ironC = ironOf(D, "c", 2026);
    state.weeks["2026-w20"].results.x2 = { void: true, away: 0, home: 0, final: false };
    state.reveals["2026-w20"].players.c.sel = { x1: "away", x3: "home", x4: "home" };
    state.reveals["2026-w21"].players.c.sel = all("home");
    out.ironVoid = ironOf(realStats(), "c", 2026);
    state.weeks["2026-w21"].confChamp = true;
    out.ironSeason = ironSeasons(realStats(), "c");
    state.reveals["2026-w21"].players.late = { sel: all("home"), tb: 1 }; state.names.late = "Lou Vee";
    const lateD = realStats(); out.ironLate = ironOf(lateD, "late", 2026); out.ironLateSeason = ironSeasons(lateD, "late");
    // Survivor chip: my pick lost in the first week, so I am out.
    wk("2026-w22", 22, "open", soon, {});
    state.weeks["2026-w22"].games = games.map((g, i) => (i === 0 ? { ...g, pvLine: -2.5 } : g));
    state.config.currentWeek = "2026-w22";
    out.outNeeded = survNeeded("2026-w22"); out.msgs = missingItems(state.weeks["2026-w22"], "2026-w22", { sel: {}, lock: null, tb: null });
    renderPicks();
    out.chips = document.querySelector("#v-picks .cks").textContent; out.picks = document.querySelector("#v-picks").textContent;
    return out;
  });
  check("the leader's rival is the picker right behind", race.leaderRival === "b", JSON.stringify(race));
  check("your rival is the picker just above you", race.myRival === "b" && race.bRival === "a", JSON.stringify([race.myRival, race.bRival]));
  check("no rival before there are standings", race.noRivalFirstWeek === null);
  check("What you need reads the live week", /back of the lead with 2 games left\./.test(race.locked.need) && /^Your rival .*: \d+\. You: \d+\.$/.test(race.locked.rival), JSON.stringify(race.locked));
  check("Your week has record, best pick, worst beat, and rank move", race.yw.w === 1 && race.yw.l === 3 && race.yw.best === "x3" && race.yw.was != null && race.yw.now != null && !!race.yw.worst, JSON.stringify(race.yw));
  check("Your week shows at the top of the Recap", /Your week/.test(race.recap) && /Best pick/.test(race.recap) && /Worst beat/.test(race.recap) && /Season rank/.test(race.recap), race.recap);
  check("Iron Man holds with every pick in", race.ironMe && race.ironMe.weeks === 2 && race.ironMe.full, JSON.stringify(race.ironMe));
  check("a missed game ends Iron Man", race.ironC === null);
  check("a void game does not count against Iron Man", !!race.ironVoid, JSON.stringify(race.ironVoid));
  check("a full season counts once Conference Champion Week is final", race.ironSeason === 1, String(race.ironSeason));
  check("a late joiner holds the status but not the full season", race.ironLate && !race.ironLate.full && race.ironLateSeason === 0, JSON.stringify(race.ironLate));
  check("a picker who is out gets no Survivor chip or warning", race.outNeeded === false && !/Surv/.test(race.chips) && !race.msgs.some((x) => /survivor/i.test(x)), race.chips + " | " + race.msgs.join(" "));
  check("a moved line shows its tag while picks are open", /Line moved: UGA -3\.5, was -2\.5 in the preview\./.test(race.picks.replace(/−/g, "-")), race.picks.slice(0, 400));

  // ---- engagement and the page visit switch ----
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  await m.evaluate(() => (location.hash = "#rules")); await m.waitForTimeout(150);
  await m.evaluate(() => window.tpEng.flush()); await m.waitForTimeout(300);
  const mPlain = await m.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("pickers never receive engagement data", !mPlain.engage);
  const poison = await m.evaluate(() => fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pages: { admin: 5, rules: 1 }, recaps: ["bad id"] }) }).then((r) => r.status));
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.waitForTimeout(300);
  const cSt = await c.evaluate(() => fetch("/api/state").then((r) => r.json()));
  const mid = mPlain.me.id;
  check("the commissioner sees last seen and tabs", cSt.engage && cSt.engage[mid] && !!cSt.engage[mid].last && cSt.engage[mid].pages.rules >= 2, JSON.stringify(cSt.engage));
  check("unknown tabs and bad week ids are dropped", poison === 200 && !cSt.engage[mid].pages.admin && !Object.keys(cSt.engage[mid].recaps).some((k) => k === "bad id"));
  await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(250);
  await c.evaluate(() => { document.querySelectorAll('#v-commish details[data-sec]').forEach((d) => (d.open = true)); });
  check("the Engagement section lists pickers", /Engagement/.test(await c.textContent("#v-commish")) && /Last seen/.test(await c.textContent("#v-commish")));
  check("the page visit switch starts off", !(await c.isChecked("#liveChk")) && cSt.auto.live.on === false && cSt.auto.live.gap === 10 && cSt.auto.live.cap === 80);
  const badGap = await c.evaluate(() => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "autoSettings", live: { gap: 1 } }) }).then((r) => r.status));
  check("a gap under 5 minutes is refused", badGap === 400);
  await c.check("#liveChk"); await c.waitForTimeout(400);
  const onSt = await c.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("the switch saves", onSt.auto.live.on === true && onSt.config.liveRun.on === true);
  await c.evaluate(() => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "autoSettings", live: { on: false } }) }));
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  await m.screenshot({ path: "dev/test-standings.png", fullPage: false });
  // CFP bracket prototype
  const cfp25 = "Miami,Georgia,Utah,Indiana,Alabama,Kentucky,Texas,UCLA,BYU,Ole Miss,Notre Dame,Ohio State,Tennessee,LSU,Texas Tech,Wake Forest,Houston,Missouri,Iowa,USC,South Carolina,Arizona,Oregon,Florida,Boise State".split(",").map((team, i) => ({ rank: i + 1, team, record: "7-1" }));
  const cfpConf = { Miami: "ACC", "Wake Forest": "ACC", Georgia: "SEC", Alabama: "SEC", Kentucky: "SEC", Texas: "SEC", "Ole Miss": "SEC", Tennessee: "SEC", LSU: "SEC", Missouri: "SEC", "South Carolina": "SEC", Florida: "SEC", Utah: "Big 12", BYU: "Big 12", "Texas Tech": "Big 12", Houston: "Big 12", Arizona: "Big 12", Indiana: "Big Ten", UCLA: "Big Ten", "Ohio State": "Big Ten", Iowa: "Big Ten", USC: "Big Ten", Oregon: "Big Ten", "Notre Dame": "Independent", "Boise State": "Pac-12" };
  const fld = await c.evaluate(([teams, conf]) => {
    const { cfpField } = window.tpBracket;
    const now = cfpField({ teams }, conf);
    const noNd = cfpField({ teams: teams.filter((t) => t.team !== "Notre Dame").map((t, i) => ({ ...t, rank: i + 1 })).concat([{ rank: 13.5, team: "Notre Dame" }]) }, conf);
    const noG6 = cfpField({ teams: teams.filter((t) => t.team !== "Boise State") }, conf);
    const noC = cfpField({ teams }, { ...conf, Miami: "" });
    return { seeds: now.seeds.map((t) => t.team), how: now.seeds.map((t) => t.how), out: now.firstOut.team, noNd: noNd.seeds.map((t) => t.team), ndOut: noNd.seeds.length, g6: noG6.problems.join(), noC: noC.problems.join() };
  }, [cfp25, cfpConf]);
  check("CFP field matches the Nov 3 bracket", fld.seeds.join() === "Miami,Georgia,Utah,Indiana,Alabama,Kentucky,Texas,UCLA,BYU,Ole Miss,Notre Dame,Boise State", fld.seeds.join());
  check("the Group of Six team takes seed 12 from No. 25", fld.how[11] === "Group of Six, Pac-12" && fld.out === "Ohio State", fld.how[11]);
  check("Notre Dame's bid needs a top 12 rank", fld.how[10] === "Notre Dame, top 12" && fld.ndOut === 12, fld.noNd.join());
  check("the field warns on a missing Group of Six team and a missing conference", fld.g6.includes("Group of Six") && fld.noC.includes("Miami"), fld.g6);
  const casc = await c.evaluate(() => { const { brkPick } = window.tpBracket; let P = {}; P = brkPick(P, "f1", 9); P = brkPick(P, "q1", 9); P = brkPick(P, "q2", 4); P = brkPick(P, "s1", 9); P = brkPick(P, "t", 9); const a = Object.keys(P).length; P = brkPick(P, "f1", 8); return [a, Object.keys(P).join()]; });
  check("changing a pick clears later picks of the old winner", casc[0] === 5 && casc[1] === "f1,q2", casc.join("|"));
  const rk = (await pg.query("select value from kv where key = 'rankings'")).rows[0].value;
  await pg.query("update kv set value = $1::jsonb where key = 'rankings'", [JSON.stringify({ ...rk, cfp: { asOf: "Nov 3, 2026", teams: cfp25 }, ats: { teams: Object.entries(cfpConf).map(([team, conf]) => ({ team, conf, su: "7-1", ats: "4-4-0" })) } })]);
  await m.reload(); await m.waitForSelector("#app:not([hidden])");
  check("pickers see the Playoffs tab", (await m.textContent("nav.tabs")).includes("Playoffs") && !(await m.textContent("nav.tabs")).includes("Bracket"));
  await m.click('nav.tabs a[data-v="playoffs"]'); await m.waitForSelector("#v-playoffs .brkfield");
  const playTxt = await m.textContent("#v-playoffs");
  check("Playoffs says it is for fun and not the real field", playTxt.includes("Not the real field") && playTxt.includes("Nothing here counts") && playTxt.includes("Sun Dec 6"));
  await m.click('.brknarrow [data-bg="f1"][data-bs="9"]');
  check("a picker can tap a winner", (await m.locator('.brknarrow [data-bg="q1"][data-bs="9"]').count()) === 1);
  const swaps = await m.evaluate(() => { const { brkSwapTeams } = window.tpBracket; const r = ["A", "B", "C"]; const one = brkSwapTeams(r, {}, 1, "Z"); const trade = brkSwapTeams(r, {}, 1, "C"); const back = brkSwapTeams(r, one, 1, "A"); return JSON.stringify([one, trade, back]); });
  check("swap math: replace, trade seeds, and undo", swaps === '[{"1":"Z"},{"1":"C","3":"A"},{}]', swaps);
  await m.click("[data-brkswapmode]"); await m.selectOption('[data-brkseed="5"]', "LSU"); await m.waitForTimeout(100);
  check("a swapped team takes the seed in the bracket", (await m.textContent('.brknarrow [data-bg="f2"][data-bs="5"]')).includes("LSU"));
  check("the picker sees that the field is their own", (await m.textContent("#v-playoffs")).includes("this is your own field"));
  await m.click("[data-brkswapmode]");
  check("a swap shows in the field table", (await m.textContent(".brkfield")).includes("Your swap"));
  await m.reload(); await m.waitForSelector("#v-playoffs .brkfield");
  check("a swap stays after a reload", (await m.textContent('.brknarrow [data-bg="f2"][data-bs="5"]')).includes("LSU"));
  await m.click("[data-brkreset]");
  check("Back to the current field undoes swaps", (await m.textContent('.brknarrow [data-bg="f2"][data-bs="5"]')).includes("Alabama"));
  check("Playoffs has no sideways page scroll on a phone", (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await c.reload(); await c.waitForSelector("#app:not([hidden])");
  await c.evaluate(() => (location.hash = "#playoffs")); await c.waitForSelector("#v-playoffs .brkfield");
  check("the field table lists 12 seeds", (await c.locator("#v-playoffs .brkfield tbody tr").count()) === 12);
  check("the phone view shows one bracket", (await c.isVisible(".brknarrow")) && !(await c.isVisible(".brkwide")));
  await c.click('.brknarrow [data-bg="f1"][data-bs="9"]');
  check("a first round pick moves the team to the quarterfinal", (await c.locator('.brknarrow [data-bg="q1"][data-bs="9"]').count()) === 1);
  await c.click("[data-brkchalk]");
  check("Fill with higher seeds picks all 11 games", (await c.textContent("#brkMade")).includes("11 of 11"));
  check("the champion shows on the title game", (await c.textContent(".brknarrow .brkchamp")).includes("Miami"));
  await c.reload(); await c.waitForSelector("#v-playoffs .brkfield");
  check("bracket picks stay after a reload", (await c.textContent("#brkMade")).includes("11 of 11"));
  check("the bracket has no sideways page scroll on a phone", (await c.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await c.setViewportSize({ width: 1400, height: 900 }); await c.waitForTimeout(100);
  check("a wide screen shows the two sided bracket", (await c.isVisible(".brkwide")) && !(await c.isVisible(".brknarrow")));
  check("the wide bracket has no sideways page scroll", (await c.evaluate(() => document.documentElement.scrollWidth)) <= 1400);
  await c.setViewportSize({ width: 390, height: 844 });
} catch (e) {
  check("test run", false, e.message);
} finally {
  check("no page errors", errors.length === 0, errors.join(" | "));
  for (const r of results) console.log(r.join("  "));
  await browser.close();
  server.close();
}
