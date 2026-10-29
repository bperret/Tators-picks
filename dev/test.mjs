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
  await c.fill("#slateJson", JSON.stringify(slate));
  await c.click("#slateForm button[type=submit]"); await c.waitForTimeout(400);
  check("slate loads as draft", (await c.textContent("#v-commish")).includes("Status: draft"));
  await c.click('[data-act="open"]'); await c.waitForTimeout(400);
  check("picks open", (await c.textContent("#statusBadge")).toLowerCase().includes("picks open"));
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
  await m.reload(); await m.waitForSelector("#app:not([hidden])"); await m.evaluate(() => (location.hash = "#standings")); await m.waitForTimeout(300);
  const st = await m.textContent("#v-standings");
  check("standings show the week", st.includes("Week 10") && st.includes("Mike T."));
  check("Robo-Sharp plays", st.includes("Robo-Sharp"));
  await m.evaluate(() => (location.hash = "#survivor")); await m.waitForTimeout(300);
  check("survivor board fills in", (await m.textContent("#v-survivor")).includes("MIA"));
  await m.evaluate(() => (location.hash = "#rules")); await m.waitForTimeout(300);
  check("log shows commissioner actions", (await m.textContent("#logPanel")).includes("Marked week final"));
  const width = await m.evaluate(() => document.documentElement.scrollWidth);
  check("no sideways scroll on a phone", width <= 390, String(width));
  await m.evaluate(() => (location.hash = "#profile")); await m.waitForTimeout(300);
  check("profile shows own number only", (await m.textContent("#v-profile")).includes("(214) 555-0123"));
  const mstate = await m.evaluate(() => fetch("/api/state").then((r) => r.json()));
  check("players never receive phone numbers", !JSON.stringify(mstate.players).includes("5550100") && !mstate.logins);
  const adminTry = await m.evaluate(() => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "addPlayer", phone: "2145559999" }) }).then((r) => r.status));
  check("players cannot use commissioner actions", adminTry === 403);
  await m.screenshot({ path: "dev/test-standings.png", fullPage: false });
} catch (e) {
  check("test run", false, e.message);
} finally {
  check("no page errors", errors.length === 0, errors.join(" | "));
  for (const r of results) console.log(r.join("  "));
  await browser.close();
  server.close();
}
