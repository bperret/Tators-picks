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
// First login walk-on: Welcome, Jersey, Rules. Pass skip to skip the rules cards.
async function walkOn(p, name, emoji, c1, c2, skip) {
  await p.waitForSelector("#welcomeCard:not([hidden])");
  await p.click("#onbGo");
  await p.waitForSelector("#setupForm:not([hidden])");
  await p.fill("#setupName", name);
  await p.click("#setupCustom summary");
  await pickLook(p, "setup", emoji, c1, c2);
  await p.click("#setupForm button[type=submit]");
  await p.waitForSelector("#rulesCard:not([hidden])");
  if (skip) await p.click("#rulesSkip");
  else for (let i = 0; i < 3; i++) { await p.click("#rulesNext"); await p.waitForTimeout(150); }
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
  await c.waitForSelector("#welcomeCard:not([hidden])");
  check("first login opens on the welcome card", (await c.textContent("#welcomeCard")).includes("You made the roster") && !(await c.isVisible("#setupForm")));
  await c.screenshot({ path: "dev/test-welcome.png" });
  await c.click("#onbGo");
  await c.waitForSelector("#setupForm:not([hidden])");
  const pre = await c.evaluate(() => ({ prev: document.querySelector("#setupPrev").textContent, pressed: ["emoji", "c1", "c2"].filter((k) => document.querySelector(`#setupLook [data-pick="setup:${k}"][aria-pressed="true"]`)).length, custom: document.querySelector("#setupCustom").open, pin: !!document.querySelector("#setupPin1") }));
  check("the jersey comes pre-filled with an emoji and two colors", pre.pressed === 3 && pre.prev.includes("#1") && !pre.custom && !pre.pin, JSON.stringify(pre));
  const look1 = await c.evaluate(() => document.querySelector("#setupPrev .ptag").getAttribute("style"));
  let shuffled = false; for (let i = 0; i < 5 && !shuffled; i++) { await c.click("#onbShuffle"); shuffled = (await c.evaluate(() => document.querySelector("#setupPrev .ptag").getAttribute("style"))) !== look1; }
  check("Shuffle changes the look", shuffled);
  const cust = await c.evaluate(() => { const a = document.querySelector("#onbShuffle").getBoundingClientRect(), b = document.querySelector("#setupCustom summary").getBoundingClientRect(); return { w: Math.round(b.width - a.width), h: Math.round(b.height - a.height), bg: getComputedStyle(document.querySelector("#setupCustom summary")).backgroundColor } });
  check("Pick my own is a full size gold button like Shuffle", Math.abs(cust.w) <= 2 && Math.abs(cust.h) <= 4 && cust.bg === "rgb(255, 209, 0)", JSON.stringify(cust));
  await c.click("#setupForm button[type=submit]");
  check("the jersey needs only a name", (await c.textContent("#setupErr")).includes("display name") && (await c.isVisible("#setupForm")));
  await c.fill("#setupName", "Tator");
  await c.screenshot({ path: "dev/test-jersey.png" });
  await c.click("#setupForm button[type=submit]");
  await c.waitForSelector("#rulesCard:not([hidden])");
  check("the rules cards come after the jersey", (await c.locator(".rcard").count()) === 3 && (await c.textContent("#rulesNext")) === "Next");
  await c.screenshot({ path: "dev/test-rules.png" });
  await c.reload(); await c.waitForSelector("#app:not([hidden])");
  check("a reload during the rules lands in the app, with the jersey saved", (await c.evaluate(() => window.tpRecap.state.names[window.tpRecap.state.uid])) === "Tator");
  await c.evaluate(() => (location.hash = "#picks"));
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
  check("expand all opens every section", (await c.locator('#v-commish details[data-sec]:not([data-noall]):not([open])').count()) === 0);
  check("expand all skips Setup and one-time tools", (await c.locator('#v-commish details[data-sec="tools"]:not([open])').count()) === 1);
  {
    const auto = await c.textContent('[data-sec="auto"]'), tools = await c.textContent('[data-sec="tools"]');
    check("one-time jobs live in Setup and one-time tools, not Automation", (await c.locator('[data-sec="auto"] [data-job="gamelog"], [data-sec="auto"] [data-job="lines"]').count()) === 0 && (await c.locator('[data-sec="tools"] [data-job="gamelog"], [data-sec="tools"] [data-job="lines"]').count()) === 2 && auto.length > 0 && tools.length > 0);
    check("Automation has no second Open picks or Pull scores button", (await c.locator('[data-sec="auto"] [data-job="open"], [data-sec="auto"] [data-job="scores"]').count()) === 0);
    check("set-once settings sit in Setup and one-time tools", (await c.locator('[data-sec="tools"] #liveChk, [data-sec="tools"] #ovTeam, [data-sec="tools"] #nameInput, [data-sec="tools"] #slateForm').count()) === 4);
  check("Commish keeps the Robo-Sharp section but has no switch or Save inputs", (await c.locator('#v-commish [data-sec="robo"]').count()) === 1 && (await c.locator('#roboChk, [data-act="roboFill"]').count()) === 0);
  }
  await c.click(".mbadd summary");
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
  const mikeRow = c.locator(".mbitem", { hasText: "Mike" });
  await mikeRow.locator(".mbrow").click();
  await mikeRow.locator('[data-dact="reset"]').click(); await c.waitForTimeout(400);
  const pin2 = (await c.textContent(".bigpin")).trim();
  await c.click('[data-dact="hidepin"]');
  await m.fill("#loginPin", pin2); await m.click("#loginBtn");
  await m.evaluate(() => (location.hash = "#survivor"));
  await walkOn(m, "Mike T.", "🤠", "Maroon", "White");
  await m.waitForSelector("#app:not([hidden])");
  check("player finishes first login", !(await m.isVisible("#commishTab")));
  check("Make my picks lands on Picks", (await m.evaluate(() => location.hash)) === "#picks");
  await m.waitForTimeout(300);
  const rk0 = await m.textContent("#rookie");
  check("a rookie sees the first sheet steps at the top", rk0.includes("Your first sheet") && rk0.includes("0 of 5") && (await m.evaluate(() => document.querySelector("#v-picks").firstElementChild.id)) === "rookie", rk0);
  check("a rookie gets no Picks are live pop-up", !(await m.isVisible("#reveal")));
  check("a rookie gets no recap banner", await m.evaluate(() => { const { state, render } = window.tpRecap; render(); return !document.querySelector("#v-picks .recapban, #v-picks [data-recapban]") && !/recap is in/i.test(document.querySelector("#v-picks").textContent) }));
  await m.screenshot({ path: "dev/test-rookie.png", fullPage: false });
  await m.evaluate(() => { const { state } = window.tpRecap; state.isOwner = false; });
  await m.evaluate(() => { const { state, revealLive } = window.tpRecap; state.pickedIn = [state.uid]; revealLive(); });
  await m.waitForSelector("#reveal.live");
  check("a picker past the rookie sheet sees the Picks are live alert", (await m.textContent("#reveal.live")).includes("lines are final"));
  await m.waitForTimeout(1000); await m.screenshot({ path: "dev/test-live.png" });
  await m.click("[data-rvgo]"); await m.waitForTimeout(100);
  check("Make my picks closes the alert and goes to Picks", !(await m.isVisible("#reveal")) && (await m.evaluate(() => location.hash)) === "#picks");
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
  check("the alert shows once a week", !(await m.isVisible("#reveal")));
  await m.evaluate(() => { const { state, revealLive } = window.tpRecap; localStorage.removeItem("tp-seen-live-" + state.uid); state.sheetsIn = [state.uid]; state.pickedIn = [state.uid]; revealLive(); });
  check("the alert skips a picker whose sheet is in", !(await m.isVisible("#reveal")));
  await m.evaluate(() => { const { state, render } = window.tpRecap; localStorage.removeItem("tp-seen-live-" + state.uid); state.sheetsIn = []; state.pickedIn = []; render(); });

  // ---- picks with warnings, then complete ----
  const sides = m.locator(".side:not([disabled])");
  const saveCls = async () => { const b = m.locator("#saveBtn"); return { cls: await b.getAttribute("class"), text: await b.textContent(), off: await b.isDisabled() } };
  const save0 = await saveCls();
  check("an open week with no saved sheet shows the Picks dot", ((await m.getAttribute("#picksTab", "class")) || "").includes("hot"));
  check("Save stays plain with nothing to save", !/unsaved|\bsaved/.test(save0.cls) && save0.text === "Save picks" && save0.off, JSON.stringify(save0));
  await sides.nth(0).click(); await sides.nth(3).click();
  const save1 = await saveCls();
  check("a change turns Save red", /unsaved/.test(save1.cls) && !save1.off, JSON.stringify(save1));
  await m.click("#saveBtn"); await m.waitForTimeout(200);
  check("incomplete sheet warns", (await m.textContent(".warn")).includes("no pick"));
  await m.click("#warnBack");
  await sides.nth(4).click(); await sides.nth(7).click(); await sides.nth(8).click();
  await m.locator(".flagbtn").nth(1).click();
  await m.fill("#tbInput", "51");
  await m.selectOption("#survSel", "g1|home");
  check("survivor conflict warns", (await m.locator("#survPanel .conflict").count()) === 1);
  await m.selectOption("#survSel", "g5|away");
  check("rookie steps tick as the sheet fills", (await m.locator("#rookie li.ok").count()) >= 3, await m.textContent("#rookie"));
  await m.click("#saveBtn"); await m.waitForTimeout(500);
  check("complete sheet saves", (await m.textContent(".phist summary")).includes("last saved"));
  check("the first save shows You're on the roster with the Redshirt class", (await m.textContent("#reveal.roster")).includes("Redshirt Class of 2026"));
  await m.waitForTimeout(800); await m.screenshot({ path: "dev/test-roster.png" });
  await m.click("#reveal [data-rvclose]");
  check("the rookie steps leave after the first save", !(await m.isVisible("#rookie")));
  const save2 = await saveCls();
  check("a saved sheet clears the Picks dot", !((await m.getAttribute("#picksTab", "class")) || "").includes("hot"));
  check("a saved sheet turns Save green", /(^| )saved/.test(save2.cls) && !/unsaved/.test(save2.cls) && save2.text === "Saved" && save2.off, JSON.stringify(save2));
  await m.fill("#tbInput", "52");
  check("a tiebreaker change turns Save red again", /unsaved/.test((await saveCls()).cls));
  await m.fill("#tbInput", "51");
  await m.click("#saveBtn"); await m.waitForTimeout(500);
  const save3 = await saveCls();
  check("a second save turns Save green", /(^| )saved/.test(save3.cls) && save3.text === "Saved", JSON.stringify(save3));
  const before = await c.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("picks hidden from others before the lock", !before.reveals["2026-w10"]);
  const ss = Object.values((before.sheetStatus || {})["2026-w10"] || {});
  check("commissioner gets sheet status without sides", ss.length === 1 && ss[0].games.length === 5 && ss[0].flag && ss[0].tb && ss[0].surv && !/"(home|away)"/.test(JSON.stringify(before.sheetStatus)), JSON.stringify(before.sheetStatus));
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  const cm = await c.textContent("#v-commish");
  check("League members shows who is in and who is complete", cm.includes("Week 10 sheets") && cm.includes("Not in 1") && cm.includes("Missing parts 0") && cm.includes("Complete 1") && cm.includes("No sheet"), cm.slice(cm.indexOf("League members"), cm.indexOf("League members") + 400));
  // The commissioner saves a partial sheet: two picks, no field goal, no tiebreaker.
  await c.evaluate(() => (location.hash = "#picks")); await c.waitForTimeout(300);
  const cs = c.locator(".side:not([disabled])");
  await cs.nth(0).click(); await cs.nth(2).click();
  await c.click("#saveBtn"); await c.waitForTimeout(200);
  if (await c.isVisible("#warnSave")) { await c.click("#warnSave"); await c.waitForTimeout(400); }
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  const cm2 = await c.textContent("#v-commish");
  check("partial sheet lists what is missing", cm2.includes("Missing parts 1") && cm2.includes("2 of 5 picks, no field goal, no tiebreaker"), cm2.slice(cm2.indexOf("League members"), cm2.indexOf("League members") + 500));
  // ---- League members table ----
  await c.evaluate(() => { const d = document.querySelector('details[data-sec="members"]'); d.open = true });
  const whoFirst = await c.textContent(".mbitem:first-child .mbwho");
  check("the table puts pickers who need attention first", whoFirst.includes("(you)"), whoFirst);
  await c.click('[data-mbf="done"]');
  check("a chip filters the table", (await c.locator(".mbitem").count()) === 1 && (await c.textContent(".mbitem")).includes("Mike"));
  await c.evaluate(() => (location.hash = "#rules")); await c.waitForTimeout(100); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(200);
  check("the filter survives a redraw", (await c.locator(".mbitem").count()) === 1 && (await c.getAttribute('[data-mbf="done"]', "aria-pressed")) === "true");
  await c.click('[data-mbf="removed"]');
  check("an empty filter says so", (await c.textContent("#mbBox")).includes("No pickers here."));
  await c.fill("#mbQ", "0123");
  check("search finds a picker by phone across every filter", (await c.locator(".mbitem").count()) === 1 && (await c.isVisible("#mbQ")) && (await c.evaluate(() => document.activeElement.id)) === "mbQ");
  await c.fill("#mbQ", "");
  await c.click('[data-mbf="all"]');
  check("All shows the active pickers", (await c.locator(".mbitem").count()) === 2);
  const mikeOpen = c.locator(".mbitem", { hasText: "Mike" });
  check("a closed row hides the buttons", (await mikeOpen.locator('[data-dact="reset"]').count()) === 0);
  await mikeOpen.locator(".mbrow").click();
  check("an open row has the text link, Reset PIN, and Remove", (await mikeOpen.locator('a[href="sms:+12145550123"]').count()) === 1 && (await mikeOpen.locator('[data-dact="reset"]').count()) === 1 && (await mikeOpen.locator('[data-dact="remove"]').count()) === 1);
  check("the open row shows the full sheet line", (await mikeOpen.textContent()).includes("Week 10: Complete"));
  check("the table adds no sideways scroll on a phone", (await c.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await mikeOpen.locator(".mbrow").click();

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

  check("Scoreboard tab hides while picks are open", await m.$eval("#sbTab", (e) => e.hidden));
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

  // ---- Scoreboard tab (item 48) ----
  {
    const wk = (await pg.query("select data from weeks where id = '2026-w10'")).rows[0].data;
    const keep = JSON.stringify(wk.results || {});
    const ids = wk.games.map((g) => g.id);
    const lr = (h, a, period, dclock, fin) => ({ home: h, away: a, period, dclock, clock: dclock ? +dclock.split(":")[0] * 60 + +dclock.split(":")[1] : null, status: "", final: !!fin, void: false, src: "auto", at: iso(new Date()) });
    const res = { [ids[0]]: lr(24, 10, 4, "0:00", true), [ids[1]]: lr(14, 13, 3, "6:10") };
    await pg.query("update weeks set data = jsonb_set(jsonb_set(data, '{results}', $1::jsonb), '{scoresAt}', to_jsonb($2::text)) where id = '2026-w10'", [JSON.stringify(res), iso(new Date())]);
    const bg = (id, an, ar, as, hn, hr, hs, s, p, dc, l) => ({ id, k: iso(new Date()), s, c: s === "post", p, dc, tx: s === "post" ? "Final" : "", a: { n: an, r: ar, sc: as }, h: { n: hn, r: hr, sc: hs }, l, t: 50, ns: false });
    const board = { day: "20261107", at: iso(new Date()), games: [bg("x1", "Duke", null, 14, "NC State", null, 3, "in", 2, "12:04", -3), bg("x2", "Texas", 7, 7, "Missouri", 18, 10, "in", 2, "5:20", 3.5), bg("x3", "Tulsa", null, 24, "Tulane", null, 21, "post", 4, "0:00", 3), bg("x4", "Arkansas", null, null, "Auburn", null, null, "pre", 0, "", -6.5)] };
    await pg.query("insert into kv (key, value) values ('dayBoard', $1::jsonb) on conflict (key) do update set value = excluded.value", [JSON.stringify(board)]);
    await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.waitForTimeout(300);
    check("Scoreboard tab shows after the lock, first in the bar, with the live dot", await m.evaluate(() => { const t = document.querySelector("#sbTab"); return !t.hidden && t.classList.contains("hot") && t.parentNode.firstElementChild === t; }));
    await m.evaluate(() => (location.hash = "#scoreboard")); await m.waitForSelector("#v-scoreboard .sbt");
    const ours = await m.evaluate(() => [...document.querySelectorAll("#v-scoreboard .sbt")].map((b) => b.className + "|" + b.dataset.sbt));
    check("Our 10 shows every slate game, live first, finals last", ours.length === ids.length && /\bin\b/.test(ours[0]) && /\bpost\b/.test(ours[ours.length - 1]), ours.join(" / "));
    check("your picks get the gold edge and the You line", (await m.locator("#v-scoreboard .sbt.mine").count()) > 0 && (await m.locator("#v-scoreboard .sbm").count()) === ids.length);
    await m.click('[data-sbf="all"]'); await m.waitForFunction(() => document.querySelectorAll("#v-scoreboard .sbt").length > 5, null, { timeout: 5000 });
    const allB = await m.evaluate(() => [...document.querySelectorAll("#v-scoreboard .sbt")].map((b) => b.dataset.sbt + "|" + b.querySelector(".sbf").textContent.trim()));
    check("All FBS adds ESPN's other games from the day board", allB.length === ids.length + 4, allB.join(" / "));
    check("other games show who is covering from ESPN's line", allB.some((x) => x.startsWith("b:x1|") && /covering/.test(x)) && allB.some((x) => x.startsWith("b:x3|") && /Push/.test(x)), allB.join(" / "));
    await m.click('[data-sbf="top"]'); await m.waitForTimeout(150);
    const topB = await m.evaluate(() => [...document.querySelectorAll("#v-scoreboard .sbt")].map((b) => b.dataset.sbt));
    check("filter buttons show no game counts", await m.evaluate(() => [...document.querySelectorAll("#v-scoreboard [data-sbf]")].map((b) => b.textContent.trim()).join("|") === "Our 10|Top 25|All FBS"));
    check("Top 25 keeps ranked games and our games", topB.includes("b:x2") && !topB.includes("b:x1") && topB.filter((k) => k.startsWith("s:")).length === ids.length, topB.join());
    await m.click('[data-sbf="ours"]'); await m.waitForTimeout(150);
    const w390 = await m.evaluate(() => document.documentElement.scrollWidth);
    check("the tile grid fits a phone with no side scroll", w390 <= 400, String(w390));
    await m.evaluate(() => window.scrollTo(0, 0)); await m.screenshot({ path: "dev/test-board.png", fullPage: false });
    await m.click(`[data-sbt="s:${ids[1]}"]`); await m.waitForTimeout(400);
    check("tapping one of our games jumps to it on Picks", await m.evaluate(() => location.hash === "#picks"));
    await m.evaluate(() => (location.hash = "#scoreboard")); await m.waitForSelector("#v-scoreboard .sbt"); await m.click('[data-sbf="all"]'); await m.waitForSelector('[data-sbt="b:x2"]');
    await m.click('[data-sbt="b:x2"]'); await m.waitForTimeout(400);
    check("tapping another game opens the Matchup", await m.evaluate(() => location.hash === "#rankings" && !!document.querySelector("#v-rankings .mubackp, #v-rankings select#muA, #v-rankings [id^=mu]")));
    await m.evaluate(() => (location.hash = "#picks"));
    await pg.query("update weeks set data = jsonb_set(data, '{results}', $1::jsonb) where id = '2026-w10'", [keep]);
    await m.reload(); await m.waitForSelector("#app:not([hidden])");
  }

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
  const bb = await m.evaluate(() => { const { state, curWeek, currentWeekId, weekPlayers, coverSide, margin } = window.tpRecap; const w = curWeek(), d = weekPlayers(currentWeekId())[state.uid] || {}, rs = w.results || {}; let want = 0, ok = true;
    for (const g of w.games) { const r = rs[g.id], c = coverSide(g, r), pk = (d.sel || {})[g.id]; const card = document.getElementById("g-" + g.id); const has = !!(card && card.querySelector(".res .bb"));
      const exp = !!(c && pk && pk !== c && Math.abs(margin(g, r)) <= 1.5); if (exp) want++; if (has !== exp) ok = false; }
    return { ok, want, tags: [...document.querySelectorAll("#v-picks .res .bb")].map((x) => x.textContent) }; });
  check("bad beat tags mark only picks that missed by 1.5 or less", bb.ok, JSON.stringify(bb));
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
  // Season table: who shows, correct pick %, and the sort.
  const season = await m.evaluate(async () => {
    const { state } = window.tpRecap; const { seasonRows, pickPct, pctText, seasonSort } = window.tpStats;
    const server = await (await fetch("/api/state")).json();
    const keep = { roster: state.roster, pickedIn: state.pickedIn, sort: state.seasonSort };
    state.roster = [...state.roster, "open0", "tbOnly"]; state.pickedIn = [...state.pickedIn, "open0"];
    const ids = seasonRows(false, true).map((r) => r.pid);
    const zero = seasonRows(false, true).find((r) => r.pid === "open0");
    Object.assign(state, { roster: keep.roster, pickedIn: keep.pickedIn });
    const a = { pid: "a", w: 6, l: 4 }, b = { pid: "b", w: 3, l: 1 }, c = { pid: "c", w: 0, l: 0 }, d = { pid: "d", w: 3, l: 2 }, e = { pid: "e", w: 6, l: 4 }, f = { pid: "f", w: 12, l: 8 };
    state.seasonSort = "pct"; const order = seasonSort([c, a, e, f, b, d]).map((r) => r.pid).join(""); state.seasonSort = "pts"; const plain = seasonSort([c, a]).map((r) => r.pid).join(""); state.seasonSort = keep.sort;
    return { me: server.pickedIn.includes(state.uid), noSides: server.pickedIn.every((x) => typeof x === "string"), zero: ids.includes("open0"), rec: zero && [zero.w, zero.l, zero.pts], tbOnly: ids.includes("tbOnly"), bot: ids.includes("__bot") || ids.some((x) => /bot|robo/i.test(x)), order, plain, pct: pctText({ w: 5, l: 3 }), none: pctText({ w: 0, l: 0 }), nullPct: pickPct({ w: 0, l: 0 }) };
  });
  check("a picker with one game in shows at 0-0; an empty sheet does not", season.me && season.noSides && season.zero && season.rec.join() === "0,0,0" && !season.tbOnly, JSON.stringify(season));
  // Class badges: server sends each picker's first season; Redshirt for 2026; none for Robo-Sharp; removed pickers left off the Classes panel.
  const cls = await m.evaluate(async () => {
    const { state } = window.tpRecap; const { classYear, classBadge, classPanel } = window.tpStats;
    const server = await (await fetch("/api/state")).json();
    const keep = { classOf: state.classOf, pickedIn: state.pickedIn, config: state.config };
    state.classOf = { ...state.classOf, r26: 2026, n27: 2027, gone: 2026 }; state.pickedIn = [...state.pickedIn, "r26", "n27", "gone"];
    state.config = { ...state.config, removed: [...((state.config && state.config.removed) || []), "gone"] };
    const out = { mine: server.classOf && server.classOf[server.me.id], rs: classBadge("r26"), std: classBadge("n27"), bot: classBadge("__bot") + (classYear("__bot") || ""), none: classBadge("nobody"), panel: classPanel("r26") };
    Object.assign(state, keep); return out;
  });
  check("class badges: Redshirt 2026, Class of 2027, none for Robo-Sharp", cls.mine === 2026 && /Redshirt Class of 2026/.test(cls.rs) && /clsb rs/.test(cls.rs) && /Class of 2027/.test(cls.std) && !/ rs/.test(cls.std) && cls.bot === "" && cls.none === "", JSON.stringify({ mine: cls.mine, bot: cls.bot }));
  check("Classes panel lists each class and hides removed pickers", /Classes/.test(cls.panel) && /data-pk="r26"/.test(cls.panel) && /data-pk="n27"/.test(cls.panel) && !/data-pk="gone"/.test(cls.panel) && cls.panel.indexOf("Redshirt") < cls.panel.indexOf("Class of 2027"));
  check("correct pick % reads 62.5%, a dash before any graded pick", season.pct === "62.5%" && season.none === "–" && season.nullPct === null, JSON.stringify(season));
  check("Pct sort: best first, more correct picks on a tie, no graded picks last", season.order === "bfaedc" && season.plain === "ca", JSON.stringify(season));
  const rankBefore = await m.locator("#v-standings .board:has(h2:text-matches('Season')) tbody tr td:first-child").allTextContents();
  await m.click("[data-seasonsort=pct]");
  check("tapping Pct says the sort is on and # stays the real rank", (await m.textContent("#v-standings")).includes("Sorted by correct pick %") && (await m.getAttribute("[data-seasonsort=pct]", "aria-pressed")) === "true" && [...(await m.locator("#v-standings .board:has(h2:text-matches('Season')) tbody tr td:first-child").allTextContents())].sort().join() === [...rankBefore].sort().join());
  await m.click("[data-seasonsort=pts]");
  check("tapping Pts goes back to points", !(await m.textContent("#v-standings")).includes("Sorted by correct pick %"));
  // A full season's numbers and long names must fit a phone with no sideways scroll.
  const vp = m.viewportSize();
  for (const width of [360, 390]) {
    await m.setViewportSize({ width, height: 740 });
    const fit = await m.evaluate(() => { const box = [...document.querySelectorAll("#v-standings .board")].find((b) => /Season/.test(b.querySelector("h2").textContent)).querySelector(".tablewrap");
      box.querySelectorAll("tbody tr").forEach((tr) => { const c = tr.children; c[1].lastChild.textContent = "Christopher Montgomery"; ["112", "78-52", "60.0%", "14-6", "123"].forEach((t, i) => (c[i + 2].textContent = t)); });
      return { sw: box.scrollWidth, cw: box.clientWidth }; });
    check(`season table fits a ${width} wide phone`, fit.sw <= fit.cw, JSON.stringify(fit));
  }
  await m.setViewportSize(vp);
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
  check("the preview has no pick buttons", (await m.locator("#pvbox button:not(.mulink)").count()) === 0);
  check("each preview game links to its matchup", (await m.locator("#pvbox .mulink").count()) === (await m.locator("#pvbox .pvg").count()));
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
  // Drop worst week (item 42): a tiny controlled league.
  const dw = await c.evaluate(() => {
    const { tallySeason } = window.tpStats;
    const mk = (k, n, cc) => ({ id: k, season: 2099, week: n, status: "final", confChamp: !!cc, games: [0, 1, 2].map((i) => ({ id: k + i, slot: i + 1, away: "A" + i, home: "H" + i, homeLine: -0.5 })), results: Object.fromEntries([0, 1, 2].map((i) => [k + i, { home: 10, away: 0, final: true, void: false }])) });
    const sh = (k, n, fg, tb) => ({ sel: Object.fromEntries([0, 1, 2].map((i) => [k + i, i < n ? "home" : "away"])), lock: fg ? k + "0" : null, tb });
    const W = ["w1", "w2", "w3", "w4", "w5", "w6"]; const weeks = Object.fromEntries(W.map((k, i) => [k, mk(k, i + 1, k === "w6")]));
    const P = { w1: { a: sh("w1", 3, 1, 10), b: sh("w1", 3, 0, 10), c: sh("w1", 1, 1, 10), d: sh("w1", 2, 0, 10) }, w2: { a: sh("w2", 2, 0, 10), c: sh("w2", 3, 0, 10), d: sh("w2", 2, 0, 30) },
      w3: { a: sh("w3", 1, 0, 10), b: sh("w3", 3, 0, 10), c: sh("w3", 3, 1, 10), d: sh("w3", 3, 1, 10) }, w4: { a: sh("w4", 3, 0, 10), b: sh("w4", 3, 0, 10), c: sh("w4", 3, 1, 10), d: sh("w4", 3, 1, 10) },
      w5: { a: sh("w5", 3, 0, 10), b: sh("w5", 3, 0, 10), c: sh("w5", 3, 1, 10), d: sh("w5", 3, 1, 10) }, w6: { a: sh("w6", 0, 0, 10), b: sh("w6", 3, 0, 10), c: sh("w6", 3, 1, 10), d: sh("w6", 3, 1, 10) } };
    const run = (ks) => tallySeason(ks, (k) => weeks[k], (k) => P[k], ["a", "b", "c", "d"]);
    const four = run(W.slice(0, 4)), all = run(W); const r = (T, id) => T.rows.find((x) => x.pid === id);
    const A4 = r(four, "a"), A = r(all, "a"), B = r(all, "b"), C = r(all, "c"), D = r(all, "d");
    return { fourOfficial: four.official, fourCan: four.can, fourSame: A4.cpts === A4.pts, fourDrop: A4.drop, official: all.official, locked: all.locked,
      aDrop: A.drop, aCount: A.cpts === A.pts - 1, aWL: A.w + A.l, bDrop: B.drop, bMissTb: B.wk.w2.tb, bPlayed: B.weeks, cDrop: C.drop, dDrop: D.drop };
  });
  check("drop worst week is a projection before 5 regular weeks are final", !dw.fourOfficial && dw.fourCan && dw.fourSame && dw.fourDrop === "w3", JSON.stringify(dw));
  check("drop worst week counts once 5 regular weeks are final, never Conference Champion Week", dw.official && dw.locked && dw.aDrop === "w3" && dw.aCount, JSON.stringify(dw));
  check("drop worst week keeps every game in W-L", dw.aWL === 18, JSON.stringify(dw));
  check("a missed week scores 0 with a tiebreaker guess of 0, and it drops", dw.bDrop === "w2" && dw.bMissTb === 10 && dw.bPlayed === 5, JSON.stringify(dw));
  check("a tie for lowest drops fewer field goals made, then the larger tiebreaker miss", dw.cDrop === "w2" && dw.dDrop === "w2", JSON.stringify(dw));
  await m.evaluate(() => (location.hash = "#standings")); await m.waitForTimeout(300);
  const dvw = await m.evaluate(() => { const g = document.querySelector("#v-standings .sview"); if (!g) return { none: true, rule: !!document.getElementById("dropRule") };
    const b = g.querySelector('[data-seasonview="drop"]'); const was = b.getAttribute("aria-pressed"); if (was !== "true") b.click();
    const tags = document.querySelectorAll("#v-standings .dropwk").length; return { tags, rule: !!document.getElementById("dropRule"), width: document.documentElement.scrollWidth }; });
  await m.screenshot({ path: "dev/test-drop.png", fullPage: true });
  check("Standings shows the drop worst week view and the Rules explain it", dvw.rule && (dvw.none || (dvw.tags > 0 && dvw.width <= 400)), JSON.stringify(dvw));
  // Fake extra final weeks so the toggle shows, then restore.
  const dv2 = await m.evaluate(() => { const { state, render } = window.tpRecap; const ks = Object.keys(state.weeks).filter((k) => state.weeks[k].status === "final" && state.reveals[k]);
    if (!ks.length) return { skip: true }; const src = ks[0]; const W0 = state.weeks, R0 = state.reveals; state.weeks = { ...W0 }; state.reveals = { ...R0 };
    const ids = [];
    for (let i = 1; i <= 4; i++) { const k = src + "x" + i; ids.push(k); const w = JSON.parse(JSON.stringify(W0[src])); w.id = k; w.week = (w.week || 0) + i; state.weeks[k] = w;
      const rv = JSON.parse(JSON.stringify(R0[src])); const pids = Object.keys(rv.players || {}); if (i === 2 && pids[0]) delete rv.players[pids[0]]; state.reveals[k] = rv; }
    state.seasonView = "drop"; location.hash = "#standings"; render();
    const out = { proj: document.querySelector("#v-standings .sview") ? document.querySelector("#v-standings .sview").textContent : "", tags: document.querySelectorAll("#v-standings .dropwk").length, missed: [...document.querySelectorAll("#v-standings .dropwk")].some((x) => x.textContent.includes("missed")), width: document.documentElement.scrollWidth };
    window.__dropRestore = () => { state.weeks = W0; state.reveals = R0; state.seasonView = undefined; render(); }; return out; });
  await m.waitForTimeout(200); await m.screenshot({ path: "dev/test-drop.png", fullPage: true });
  await m.evaluate(() => { if (window.__dropRestore) window.__dropRestore(); });
  check("the drop view tags each picker's dropped week, a missed week included", dv2.skip || (dv2.tags > 0 && dv2.missed && dv2.width <= 400), JSON.stringify(dv2));
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
  check("Teams has Polls, Power, ATS, Matchup", segs.join(",") === "Polls,Power,ATS,Matchup", segs.join(","));
  const rec = await m.evaluate(() => { const { state, suRec } = window.tpRecap; const R = state.rankings || {}; const t = ((R.ats && R.ats.teams) || []).find((x) => x.su) || ((R.ap && R.ap.teams) || []).find((x) => x.record); return t ? { team: t.team, want: t.su || t.record, got: suRec(t.team) } : null; });
  check("the pick card record reads the ATS list, else the AP poll", !rec || rec.got === rec.want, JSON.stringify(rec));
  await m.evaluate(() => { window.tpRecap.state.rankView = "polls"; window.tpRecap.render(); });
  const inf = await m.evaluate(async () => { const d = document.querySelector('#v-rankings details.info[data-info="polls"]'); if (!d) return "missing"; const shut = !d.open; d.open = true; await new Promise((r) => setTimeout(r, 50)); window.tpRecap.render(); const d2 = document.querySelector('#v-rankings details.info[data-info="polls"]'); const kept = !!(d2 && d2.open); d2.open = false; await new Promise((r) => setTimeout(r, 50)); return shut && kept ? "ok" : JSON.stringify({ shut, kept }); });
  check("long notes sit behind an info button that stays open on redraw", inf === "ok", inf);
  check("Polls lists teams from all three polls", (await m.locator('#v-rankings [data-steam="Tulane"]').count()) === 1 && (await m.locator("#v-rankings .g-pol[data-steam]").count()) >= 26);
  await m.click('[data-tsort="polls:rc"]'); await m.waitForTimeout(200);
  check("sorting by r/CFB puts its #1 first", (await m.getAttribute("#v-rankings .g-pol[data-steam] >> nth=0", "data-steam")) === "Georgia");
  await m.click('[data-steam="Georgia"]'); await m.waitForTimeout(200);
  let det = await m.textContent(".sdet");
  check("team card shows polls, record, FCS game, and cover", det.includes("r/CFB 1") && det.includes("2-0") && det.includes("1 FCS game") && det.includes("Covered") && det.includes("no line"), det.slice(0, 240));
  check("team card splits the record vs today's SP+ top 5, 15, and 25", /vs SP\+ today.*Top 5 \d+-\d+ · Top 15 \d+-\d+ · Top 25 \d+-\d+/.test(det), det.slice(0, 400));
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
  // ---- Matchup preview (item 39) ----
  const hfa = await m.evaluate(() => { const { hfaOf, muProject } = window.tpMatchup;
    const C = { sp: { Texas: { rating: 20 }, Purdue: { rating: 2 } }, fpi: { Texas: { rating: 15 }, Purdue: { rating: 5 } }, vsin: {} };
    return { olemiss: hfaOf("Ole Miss"), uconn: hfaOf("UConn"), pitt: hfaOf("Pittsburgh"), mioh: hfaOf("Miami (OH)"), rice: hfaOf("Rice"), umass: hfaOf("UMass"),
      neutral: muProject(C, "Texas", "Purdue", "n").map((x) => x.m), purdueHome: muProject(C, "Texas", "Purdue", "h").map((x) => x.m), texasHome: muProject(C, "Texas", "Purdue", "a").map((x) => x.m) }; });
  check("home field uses VSiN's team values, 2 by default", hfa.olemiss === 3.5 && hfa.uconn === 3 && hfa.pitt === 2.5 && hfa.mioh === 3.5 && hfa.rice === 2 && hfa.umass === 1, JSON.stringify(hfa));
  check("model spreads: ratings gap plus home field, none when neutral, missing ratings stay empty", hfa.neutral.join() === "-18,-10," && hfa.purdueHome.join() === "-17,-9," && hfa.texasHome.join() === "-21.5,-13.5,", JSON.stringify(hfa));
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(300);
  const muLink = await m.evaluate(() => { const b = document.querySelector("#v-picks .mulink"); if (!b) return null; const { state } = window.tpRecap; const w = state.weeks[state.config.currentWeek]; const g = w.games.find((x) => x.id === b.dataset.mu); return { id: b.dataset.mu, away: g.away, home: g.home, neutral: !!g.neutral }; });
  check("each game on Picks has a Matchup link", !!muLink && (await m.locator("#v-picks .mulink").count()) >= 1, JSON.stringify(muLink));
  if (muLink) {
    await m.click(`#v-picks .mulink[data-mu="${muLink.id}"]`); await m.waitForTimeout(400);
    const mu = await m.evaluate(() => ({ hash: location.hash, seg: (document.querySelector('#v-rankings [data-rank="matchup"]') || {}).ariaPressed || document.querySelector('#v-rankings [data-rank="matchup"]').getAttribute("aria-pressed"),
      a: document.querySelector("#muA").value, h: document.querySelector("#muH").value, site: (document.querySelector('#v-rankings [data-musite][aria-pressed="true"]') || {}).dataset.musite,
      text: document.querySelector("#v-rankings").textContent, back: !!document.querySelector("[data-muback]") }));
    check("the link opens Matchup with both teams and the home team filled in", mu.hash === "#rankings" && mu.seg === "true" && mu.site === (muLink.neutral ? "n" : "h") && mu.back, JSON.stringify({ ...mu, text: undefined }));
    check("Matchup shows each model, the betting line, Robo-Sharp, and side by side", ["SP+", "FPI", "VSiN", "Betting line", "Side by side", "Home field", "SP+ rank by week"].every((x) => mu.text.includes(x)), mu.text.slice(0, 400));
    await m.click('[data-musite="n"]'); await m.waitForTimeout(150);
    const mu2 = await m.textContent("#v-rankings");
    check("changing home field off the real site asks to match it before comparing to the line", muLink.neutral || (mu2.includes("Neutral site: no home field added.") && mu2.includes("to compare with the betting line")), mu2.slice(0, 300));
    await m.click("[data-muswap]"); await m.waitForTimeout(150);
    check("swap trades the two teams", (await m.inputValue("#muA")) === mu.h && (await m.inputValue("#muH")) === mu.a);
    sw = await m.evaluate(() => document.documentElement.scrollWidth);
    check("Matchup has no sideways scroll on a phone", sw <= 390, String(sw));
    await m.selectOption("#muA", "Rice"); await m.waitForTimeout(150);
    check("picking a team by hand starts a new matchup with no back link", (await m.inputValue("#muA")) === "Rice" && !(await m.locator("[data-muback]").count()));
  }
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
    const { state, rivalOf, raceFacts, yourWeek, ironOf, ironSeasons, realStats, survNeeded, renderPicks, missingItems, renderRecap, render } = window.tpRecap;
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
    // A picker who joins after the run's first week: bench card, no Survivor pick, a bench line in the rookie steps.
    const was = { uid: state.uid, owner: state.isOwner, pickedIn: state.pickedIn, draft: state.draft };
    state.uid = "newbie"; state.isOwner = false; state.pickedIn = []; state.draft = { sel: {}, lock: null, tb: null, surv: null };
    renderPicks();
    out.benchNeeded = survNeeded("2026-w22"); out.bench = (document.querySelector("#survBench") || {}).textContent || ""; out.benchSel = !!document.querySelector("#survSel");
    out.benchRookie = (document.querySelector("#rookie") || {}).textContent || "";
    const view = state.view; state.view = "picks"; render(); out.banRookie = !!document.querySelector("#v-picks .recapban");
    state.pickedIn = ["newbie"]; render(); out.banVet = !!document.querySelector("#v-picks .recapban"); state.view = view;
    state.pickedIn = []; renderPicks(); window.__was = was;
    return out;
  });
  const hash0 = await m.evaluate(() => location.hash);
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(250);
  { const bb = m.locator("#survBench"); await bb.scrollIntoViewIfNeeded(); await bb.screenshot({ path: "dev/test-bench.png" }); }
  await m.evaluate((h) => { const { state, renderPicks } = window.tpRecap; Object.assign(state, window.__was); renderPicks(); location.hash = h; }, hash0); await m.waitForTimeout(150);
  check("the leader's rival is the picker right behind", race.leaderRival === "b", JSON.stringify(race));
  check("your rival is the picker just above you", race.myRival === "b" && race.bRival === "a", JSON.stringify([race.myRival, race.bRival]));
  check("no rival before there are standings", race.noRivalFirstWeek === null);
  check("What you need reads the live week", /back of the lead with 2 games left\. You are tied for 2nd\..* You can still score up to \d+ points?\./.test(race.locked.need) && /^Your rival .*: \d+\. You: \d+\.$/.test(race.locked.rival), JSON.stringify(race.locked));
  check("Your week has record, best pick, worst beat, and rank move", race.yw.w === 1 && race.yw.l === 3 && race.yw.best === "x3" && race.yw.was != null && race.yw.now != null && !!race.yw.worst, JSON.stringify(race.yw));
  check("Your week shows at the top of the Recap", /Your week/.test(race.recap) && /Best pick/.test(race.recap) && /Worst beat/.test(race.recap) && /Season rank/.test(race.recap), race.recap);
  check("Iron Man holds with every pick in", race.ironMe && race.ironMe.weeks === 2 && race.ironMe.full, JSON.stringify(race.ironMe));
  check("a missed game ends Iron Man", race.ironC === null);
  check("a void game does not count against Iron Man", !!race.ironVoid, JSON.stringify(race.ironVoid));
  check("a full season counts once Conference Champion Week is final", race.ironSeason === 1, String(race.ironSeason));
  check("a late joiner holds the status but not the full season", race.ironLate && !race.ironLate.full && race.ironLateSeason === 0, JSON.stringify(race.ironLate));
  check("a late joiner gets the Survivor bench card instead of a pick", race.bench.includes("On the bench this run") && race.bench.includes("You're in for the next run") && !race.benchSel && race.benchNeeded === false, JSON.stringify([race.bench, race.benchSel, race.benchNeeded]));
  check("the recap banner waits until a rookie's first save", race.banRookie === false && race.banVet === true, JSON.stringify([race.banRookie, race.banVet]));
  check("a late joiner's first sheet steps say they sit Survivor out", race.benchRookie.includes("Survivor: you sit this run out") && !race.benchRookie.includes("Make your Survivor pick"), race.benchRookie);
  check("a picker who is out gets no Survivor chip or warning", race.outNeeded === false && !/Surv/.test(race.chips) && !race.msgs.some((x) => /survivor/i.test(x)), race.chips + " | " + race.msgs.join(" "));
  check("a moved line shows its tag while picks are open", /Line moved: UGA -3\.5, was -2\.5 in the preview\./.test(race.picks.replace(/−/g, "-")), race.picks.slice(0, 400));

  // ---- tab tiles at the bottom of every tab ----
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.evaluate(() => (location.hash = "#picks")); await m.waitForSelector("#goFoot .gotile");
  const tabs = await m.$$eval("nav.tabs a", (a) => a.filter((x) => !x.hidden).map((x) => x.getAttribute("href")));
  check("pickers have 9 tabs and no Commish", tabs.length === 9 && !tabs.includes("#commish"), JSON.stringify(tabs));
  const tileMiss = [];
  for (const t of tabs) {
    await m.evaluate((h) => (location.hash = h), t); await m.waitForTimeout(80);
    const got = await m.$$eval("#goFoot .gotile", (a) => a.map((x) => x.getAttribute("href")));
    if (got.length !== 8 || got.includes(t) || !tabs.filter((x) => x !== t).every((x) => got.includes(x))) tileMiss.push(t + ":" + got.join(","));
  }
  check("every tab links to all the other tabs", tileMiss.length === 0, tileMiss.join(" | "));
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(100);
  check("the tiles sit below the sheet and are not warnings", await m.evaluate(() => { const t = document.querySelector(".gotiles"), b = document.querySelector(".savebar"); return !t.closest(".warn,.savebar") && (!b || !!(b.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) }));
  check("the tiles add no sideways scroll on a phone", (await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await m.locator(".gotile[href='#rules']").scrollIntoViewIfNeeded(); await m.click(".gotile[href='#rules']"); await m.waitForTimeout(150);
  check("a tile opens its tab at the top of the page", (await m.isVisible("#v-rules")) && (await m.evaluate(() => scrollY)) === 0);
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(100);
  await c.evaluate(() => (location.hash = "#standings")); await c.waitForSelector("#goFoot .gotile");
  check("the commissioner's tiles never link to Commish", !(await c.locator("#goFoot .gotile[href='#commish']").count()));
  await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(150);
  check("the Commish tab has no tiles", (await c.locator("#goFoot .gotile").count()) === 0);

  // ---- emoji quick row ----
  const quickRow = async () => { await m.evaluate(() => (location.hash = "#profile")); await m.waitForSelector("#v-profile .emgrid"); return (await m.$$eval("#v-profile .emgrid", (g) => [...g[0].children].map((b) => b.textContent.trim()))); };
  const qa = await quickRow();
  await m.locator("#v-profile .emgrid").first().locator("button").nth(3).click(); await m.waitForTimeout(100);
  const qa2 = await quickRow();
  await m.reload(); await m.waitForSelector("#app:not([hidden])");
  const qb = await quickRow();
  check("the quick row holds still while a picker chooses", qa.join() === qa2.join());
  check("the quick row keeps all 20 emojis in a new order on each load", qa.length === 20 && qb.length === 20 && [...qa].sort().join() === [...qb].sort().join() && qa.join() !== qb.join(), qa.join("") + " / " + qb.join(""));
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(100);

  // ---- Bowl challenge prototype ----
  check("pickers do not see the Bowl Blitz tab", await m.isHidden("#bowlsTab"));
  await m.evaluate(() => (location.hash = "#bowls")); await m.waitForTimeout(150);
  check("a picker cannot open the Bowl Blitz tab", (await m.isVisible("#v-picks")) && !(await m.isVisible("#v-bowls")));
  await m.evaluate(() => (location.hash = "#picks")); await m.waitForTimeout(100);
  check("the commissioner sees the Bowl Blitz tab", await c.isVisible("#bowlsTab"));
  await c.evaluate(() => (location.hash = "#bowls")); await c.waitForSelector("#v-bowls .game");
  check("the prototype lists 35 bowls and no Celebration Bowl", (await c.locator("#v-bowls .game").count()) === 35 && !(await c.textContent("#v-bowls")).includes("Celebration"));
  check("the tab is named Bowl Blitz", (await c.textContent("#bowlsTab")).trim() === "Bowl Blitz");
  check("every bowl has an emoji and its own name color", await c.evaluate(() => { const n = [...document.querySelectorAll("#v-bowls .bwname")]; return n.length === 35 && n.every((x) => /^\S+ /.test(x.textContent) && x.style.getPropertyValue("--bc").startsWith("var(--bc-")) && new Set(n.map((x) => getComputedStyle(x).color)).size >= 8 }));
  check("the tiebreaker bowl is pinned first", (await c.locator("#v-bowls .bwlist > .game").first().getAttribute("class")).includes("tbgame"));
  check("the Bowl Blitz tab has no tiles", (await c.locator("#goFoot .gotile").count()) === 0);
  check("the unfinished sheet shows the dot", (await c.getAttribute("#bowlsTab", "class") || "").includes("hot"));
  const bwSides = () => c.locator('#v-bowls .side[data-bws="away"]');
  await c.locator("#v-bowls .flagbtn").nth(2).click();
  check("a field goal needs a pick first", (await c.getAttribute("#v-bowls .flagbtn >> nth=2", "aria-pressed")) === "false");
  await bwSides().nth(0).click();
  check("each pick shows a white count", (await c.textContent("#toast")) === "You have picked 1 of 10 bowls." && (await c.getAttribute("#toast", "class")).includes("info"));
  for (let i = 1; i < 10; i++) await bwSides().nth(i).click();
  await bwSides().nth(10).click();
  check("the 11th pick warns in yellow", (await c.textContent("#toast")).startsWith("You have 10 bowls") && !(await c.getAttribute("#toast", "class")).includes("info"));
  check("an 11th pick is blocked", (await c.locator('#v-bowls .side[aria-pressed="true"]').count()) === 10 && (await c.textContent("#bwStat")).startsWith("10 of 10"));
  await c.locator("#v-bowls .flagbtn").nth(2).click();
  await c.fill("#bwTb", "55");
  check("a full sheet clears the dot", (await c.textContent("#bwStat")).includes("Sheet complete") && !((await c.getAttribute("#bowlsTab", "class")) || "").includes("hot"));
  await c.click('[data-bwf="mine"]');
  check("My picks shows the 10 picks", (await c.locator('#v-bowls .side[aria-pressed="true"]').count()) === 10 && (await c.locator("#v-bowls .game").count()) <= 11);
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#bowls")); await c.waitForSelector("#v-bowls .game");
  check("prototype picks survive a reload on this device", (await c.locator('#v-bowls .side[aria-pressed="true"]').count()) === 10);
  await c.click('[data-bwph="final"]');
  const bwFinal = await c.textContent("#v-bowls .bwt");
  check("Final shows standings with Robo-Sharp unranked", bwFinal.includes("Robo-Sharp") && bwFinal.includes("You") && (await c.locator("#v-bowls .bwt tr", { hasText: "Robo-Sharp" }).locator("td").first().textContent()) === "—");
  check("picks are read only after the lock", (await c.locator("#v-bowls .side:not([disabled])").count()) === 0);
  await c.click('[data-bwph="live"]');
  check("After lock shows some bowls not played yet", (await c.textContent("#v-bowls")).includes("Not played yet") && (await c.textContent("#v-bowls")).includes("Final:"));
  check("the prototype adds no sideways scroll on a phone", (await c.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await c.click('[data-bwph="pre"]');
  await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(100);

  // ---- Army-Navy prototype ----
  check("pickers do not see the Army-Navy tab", await m.isHidden("#anTab"));
  await c.evaluate(() => (location.hash = "#armynavy")); await c.waitForSelector("#an-fa");
  check("the Army-Navy tab has no tiles and shows the dot", (await c.locator("#goFoot .gotile").count()) === 0 && ((await c.getAttribute("#anTab", "class")) || "").includes("hot"));
  const anTop = await c.evaluate(() => { const v = document.querySelector("#v-armynavy"); const ps = [...v.querySelectorAll(".anplate p, .anplate h2")].map((x) => x.textContent.trim()); const ids = [...v.querySelectorAll(".anbox")].map((x) => x.id); return { ps, ids, salute: !!v.querySelector(".ansalute"), trad: v.querySelectorAll(".antrad > div").length }; });
  check("Army-Navy header: helmet, Army-Navy, anchor, then date and place, then straight up, then lock on separate lines", /^\u{1FA96} Army-Navy \u2693$/u.test(anTop.ps[1]) && anTop.ps[2].startsWith("Sat Dec 12") && anTop.ps[2].endsWith("East Rutherford, New Jersey") && anTop.ps[3].startsWith("Straight up") && anTop.ps[4] === "Lock time is not set.", JSON.stringify(anTop.ps));
  check("Army-Navy asks halftime first, then final, Army before Navy", anTop.ids.join() === "an-ha,an-hn,an-fa,an-fn", anTop.ids.join());
  check("Army-Navy has Salute to Service and traditions", anTop.salute && anTop.trad === 6);
  await c.fill("#an-fa", "17"); await c.fill("#an-fn", "17"); await c.fill("#an-ha", "7"); await c.fill("#an-hn", "3");
  check("a tied final is refused", (await c.textContent("#anErr")).includes("no ties"));
  await c.fill("#an-fn", "20"); await c.fill("#an-hn", "24");
  check("a halftime above the final is refused", (await c.textContent("#anErr")).includes("halftime"));
  await c.fill("#an-hn", "10");
  check("a full entry reads back and clears the dot", (await c.textContent("#anRead")).includes("Navy wins by 3") && !((await c.getAttribute("#anTab", "class")) || "").includes("hot"));
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#armynavy")); await c.waitForSelector("#an-fa");
  check("the Army-Navy entry survives a reload", (await c.inputValue("#an-fn")) === "20");
  await c.click('[data-anph="final"]');
  const anT = await c.textContent("#v-armynavy .bwt");
  check("Army-Navy final ranks by winner, then final, then halftime", anT.includes("You") && anT.includes("Robo-Sharp") && (await c.locator("#v-armynavy .bwt tr", { hasText: "Robo-Sharp" }).locator("td").first().textContent()) === "—" && (await c.isDisabled("#an-fa")));
  await c.click('[data-anph="half"]');
  check("halftime view has no winner yet", (await c.textContent("#v-armynavy")).includes("The final decides it"));
  check("the Army-Navy tab adds no sideways scroll on a phone", (await c.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await c.click('[data-anph="pre"]'); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(100);

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
  const ob = cSt.engage[mid].onboard || {};
  check("the walk-on steps are recorded once each", ["welcome", "suit", "jersey", "rules", "sheet"].every((k) => ob[k]) && !ob.skip, JSON.stringify(ob));
  const fun = await c.textContent("#v-commish");
  check("Engagement shows the first login funnel", /First login/.test(fun) && /Welcome 1 · Let's go 1 · Jersey 1 · Rules 1 \(skipped 0\) · First sheet 1/.test(fun), fun.slice(fun.indexOf("First login"), fun.indexOf("First login") + 200));
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
  // ---- Remove keeps data; Start over wipes it and runs the walk-on again ----
  const mid2 = (await m.evaluate(() => fetch("/api/state").then((r) => r.json()))).me.id;
  const adm = (body) => c.evaluate((b) => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()), body);
  const early = await adm({ action: "startOver", id: mid2 });
  check("Start over needs a removed picker", !early.ok && /Remove the picker first/.test(early.error), JSON.stringify(early));
  await adm({ action: "setRemoved", id: mid2, removed: true });
  check("Remove keeps the picks", (await pg.query("select count(*)::int n from picks where player_id = $1", [mid2])).rows[0].n > 0);
  await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
  await c.evaluate(() => { document.querySelectorAll('#v-commish details[data-sec]').forEach((d) => (d.open = true)); });
  await c.click('[data-mbf="removed"]'); await c.waitForTimeout(100);
  const gone = c.locator(".mbitem", { hasText: "Mike" }); await gone.locator(".mbrow").click();
  await gone.locator('[data-dact="startover"]').click();
  check("Start over asks for a second tap", (await gone.locator('[data-dact="startover"]').textContent()).includes("Tap again"));
  await c.evaluate(() => window.tpRecap.renderCommish && window.tpRecap.renderCommish());
  await c.evaluate(() => { document.querySelectorAll('#v-commish details[data-sec]').forEach((d) => (d.open = true)); });
  check("a Commish redraw keeps Start over armed", (await gone.locator('[data-dact="startover"]').textContent()).includes("Tap again"));
  await gone.locator('[data-dact="startover"]').click(); await c.waitForTimeout(600);
  const rows = async (t) => (await pg.query(`select count(*)::int n from ${t} where player_id = $1`, [mid2])).rows[0].n;
  const pl = (await pg.query("select name, setup_done, removed from players where id = $1", [mid2])).rows[0];
  check("Start over wipes picks, history, and engagement", (await rows("picks")) === 0 && (await rows("pick_history")) === 0 && (await rows("engage")) === 0);
  check("Start over clears the profile and restores the picker", pl.name === "" && !pl.setup_done && !pl.removed, JSON.stringify(pl));
  await m.reload(); await m.waitForSelector("#loginForm:not([hidden])");
  check("Start over signs the picker out", await m.isVisible("#loginForm"));
  await m.fill("#loginPhone", "2145550123"); await m.fill("#loginPin", pin2); await m.click("#loginBtn");
  await m.waitForSelector("#welcomeCard:not([hidden])");
  check("the same PIN logs in and the walk-on runs again", (await m.textContent("#welcomeCard")).includes("You made the roster"));
  // ---- Robo-Sharp: new model, inputs, switch, flip alert ----
  {
    const ev = await c.evaluate(() => {
      const { roboEval } = window.tpRobo;
      const base = { away: "Florida", home: "Georgia", neutral: true };
      const a = roboEval({ ...base, homeLine: -7.5, modelLine: -7.5 }, { mkt: -10 });
      const b = roboEval({ ...base, homeLine: -6.5, modelLine: -6.5 }, { mkt: -8 });
      const d = roboEval({ ...base, homeLine: -7.5, modelLine: -6 }, { sp: [10, 20], vs: [80, 85] });
      return { a, b, d };
    });
    check("Robo-Sharp follows the market when the ratings sit on our line", ev.a.side === "home" && Math.abs(ev.a.s + 1.5) < 0.01, JSON.stringify(ev.a));
    check("Robo-Sharp adds a little when its line crosses 7", Math.abs(ev.b.s + 1.4) < 0.01, JSON.stringify(ev.b));
    check("Robo-Sharp blends three ratings and counts who agrees", ev.d.side === "away" && ev.d.cons === -7 && ev.d.agree === 2 && ev.d.n === 3, JSON.stringify(ev.d));
    await c.reload(); await c.waitForSelector("#app:not([hidden])"); await c.evaluate(() => (location.hash = "#commish")); await c.waitForTimeout(300);
    await c.evaluate(() => { document.querySelectorAll('#v-commish details[data-sec]').forEach((d) => (d.open = true)); });
    {
      const panel = await c.textContent('[data-sec="robo"]');
      check("the Robo-Sharp section shows the bands and the model scoreboard, no old vs new", /Confidence bands/.test(panel) && /Model scoreboard/.test(panel) && !/old vs new/i.test(panel) && !/Field goal:/.test(panel), panel.slice(0, 300));
      check("week bands read as counts when a week has inputs", !/Week \d+\./.test(panel) || /Bands: \d+ heavy, \d+ leans, \d+ slight, \d+ coin flip\./.test(panel), panel.slice(0, 300));
    }
    await c.evaluate(() => (location.hash = "#rules")); await c.waitForTimeout(300);
    check("Rules show only the new Robo-Sharp text", await c.evaluate(() => !document.querySelector("#roboRulesNew").hidden && !document.querySelector("#roboRulesOld")));
    const flip = await c.evaluate(() => {
      const g = { id: "x1", slot: 1, away: "Florida", home: "Georgia", neutral: true, homeLine: -7.5, modelLine: -7.5 };
      const w = { id: "2099-w01", games: [g], robo: { v: 2, first: { g: { x1: { mkt: -7.5 } } }, last: { g: { x1: { mkt: -11 } } } } };
      return window.tpRobo.roboFlips(w).map((f) => f.from + ">" + f.to);
    });
    const why = await c.evaluate(() => {
      const { roboEval, roboWhy } = window.tpRobo;
      const g = { away: "Texas", home: "Ole Miss", neutral: true, homeLine: -2.5, modelLine: -1 };
      const mk = roboEval(g, { mkt: -6 }), rt = roboEval({ ...g, modelLine: -6 }, {}), both = roboEval({ ...g, modelLine: -6 }, { mkt: -6 }), flat = roboEval({ ...g, modelLine: -2.5 }, { mkt: -2.5 });
      return [roboWhy(g, mk), roboWhy(g, rt), roboWhy(g, both), roboWhy(g, flat)];
    });
    check("Robo's card names what drove the pick", why[0].startsWith("Market call:") && why[0].includes("\u22126") || why[0].includes("-6"), why.join(" | "));
    check("Robo's card says ratings call, both, or coin flip", why[1] === "Ratings call: 1 of 1 like it" && why[2] === "Ratings and market agree" && why[3] === "Ratings split, market flat", why.join(" | "));
    const bands = await c.evaluate(() => { const { roboEval, roboBand } = window.tpRobo; const g = { away: "Texas", home: "Ole Miss", neutral: true, homeLine: -10.5 };
      return [0.3, 0.8, 1.6, 3].map((e) => roboBand(roboEval({ ...g, modelLine: -10.5 - e }, {}).p)[2]); });
    check("Robo's confidence bands run from coin flip to heavy lean", bands.join() === "Coin flip,Slight lean,Leans,Heavy lean", bands.join());
    check("a market move after the open shows as a Robo flip", flip.join() === "away>home", flip.join());
  }
} catch (e) {
  check("test run", false, e.message);
} finally {
  check("no page errors", errors.length === 0, errors.join(" | "));
  for (const r of results) console.log(r.join("  "));
  await browser.close();
  server.close();
}
