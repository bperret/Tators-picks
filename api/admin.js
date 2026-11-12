// Commissioner actions. Every change is written to the public log.
import bcrypt from "bcryptjs";
import { q, one, addLog, setKv, getKv } from "../lib/db.js";
import { parseRedditText } from "../lib/polls.js";
import { readBody, send, fail, currentPlayer, digits, newPin, newId } from "../lib/http.js";
import { getConfig, validateWeek, effectiveStatus, getWeek, putWeek, saveDraft, snapshotRankings } from "../lib/league.js";
import { runJob, dismissFlag, clearLiveFlags, liveCfg, LIVE_LIMITS, JOB_NAMES } from "../lib/auto.js";
import { captureRobo } from "../lib/robo.js";

const BY = "Commissioner";

const ctTime = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
// The log is public, so it shows a display name the player chose, never the commissioner's own label.
const label = (p) => (p.setup_done && p.name ? p.name : "a new entry who has not logged in yet");

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return fail(res, 405, "Use POST.");
    const me = await currentPlayer(req);
    if (!me) return fail(res, 401, "Log in first.");
    if (!me.is_commish) return fail(res, 403, "Only the commissioner can do that.");
    const b = await readBody(req);

    switch (b.action) {
      case "addPlayer": {
        const phone = digits(b.phone);
        if (phone.length !== 10) return fail(res, 400, "Enter a 10 digit cell number.");
        if (await one("select id from players where phone = $1", [phone])) return fail(res, 409, "That number is already in the league.");
        const pin = newPin();
        const invited = String(b.name || "").trim().slice(0, 24);
        await q("insert into players (id, phone, pin_hash, invited) values ($1, $2, $3, $4)", [newId(), phone, await bcrypt.hash(pin, 10), invited]);
        const n = (await one("select count(*)::int as n from players")).n - 1; // the commissioner is not counted
        await addLog(BY, "Added a picker", `Entry #${n}. The name stays private until they set up a profile.`);
        return send(res, 200, { ok: true, pin, phone });
      }
      case "resetPin": {
        const p = await one("select * from players where id = $1", [b.id]);
        if (!p) return fail(res, 404, "Picker not found.");
        const pin = newPin();
        // Raising session_v signs the player out everywhere.
        await q("update players set pin_hash = $2, session_v = session_v + 1, fail_count = 0, locked_until = null where id = $1", [p.id, await bcrypt.hash(pin, 10)]);
        await addLog(BY, "Reset a PIN", label(p));
        return send(res, 200, { ok: true, pin, phone: p.phone, self: p.id === me.id });
      }
      case "setRemoved": {
        const p = await one("select * from players where id = $1", [b.id]);
        if (!p) return fail(res, 404, "Picker not found.");
        if (p.is_commish) return fail(res, 400, "The commissioner cannot be removed.");
        await q("update players set removed = $2 where id = $1", [p.id, !!b.removed]);
        await addLog(BY, b.removed ? "Removed a picker" : "Restored a picker", label(p));
        return send(res, 200, { ok: true });
      }
      // Start over: a removed picker becomes a brand new entry with the same phone and PIN.
      // Deletes their picks, pick history, and engagement, clears the profile, and signs them out.
      case "startOver": {
        const p = await one("select * from players where id = $1", [b.id]);
        if (!p) return fail(res, 404, "Picker not found.");
        if (p.is_commish) return fail(res, 400, "The commissioner cannot be started over.");
        if (!p.removed) return fail(res, 400, "Remove the picker first, then Start over.");
        const who = label(p);
        await q("delete from picks where player_id = $1", [p.id]);
        await q("delete from pick_history where player_id = $1", [p.id]);
        await q("delete from engage where player_id = $1", [p.id]);
        await q("update players set name = '', emoji = '', c1 = '', c2 = '', setup_done = false, removed = false, session_v = session_v + 1, fail_count = 0, locked_until = null, lockouts = 0 where id = $1", [p.id]);
        await addLog(BY, "Started a picker over", who);
        return send(res, 200, { ok: true });
      }
      case "importWeek": {
        const w = b.week;
        const errs = validateWeek(w);
        if (errs.length) return fail(res, 400, errs.slice(0, 5).join(" "));
        try {
          await saveDraft(w);
        } catch (e) {
          if (e.code === 409) return fail(res, 409, e.message);
          throw e;
        }
        await addLog(BY, "Loaded a slate", `Week ${w.week}: ${w.games.length} games`);
        return send(res, 200, { ok: true });
      }
      case "setStatus": {
        const w = await getWeek(b.weekId);
        if (!w) return fail(res, 404, "Week not found.");
        const to = b.status;
        const cur = effectiveStatus(w);
        const allowed = { draft: ["open"], open: ["draft"], locked: ["final"], final: ["locked"] };
        if (!(allowed[cur] || []).includes(to)) return fail(res, 409, `A ${cur} week cannot move to ${to}.`);
        w.status = to === "locked" ? "open" : to; // past the deadline, "open" reads as locked
        // When the commissioner undoes a step, automation leaves that step to him for this week.
        if (to === "draft") w.holdOpen = true;
        if (to === "locked") w.holdFinal = true;
        await putWeek(w);
        if (to === "final") await snapshotRankings(w.id);
        const words = { open: "Opened picks", draft: "Moved the week back to draft", final: "Marked week final", locked: "Reopened scoring" };
        await addLog(BY, words[to], `Week ${w.week}`);
        return send(res, 200, { ok: true });
      }
      case "lockNow": {
        const w = await getWeek(b.weekId);
        if (!w) return fail(res, 404, "Week not found.");
        if (effectiveStatus(w) !== "open") return fail(res, 409, "Only a week with picks open can be locked.");
        const now = new Date();
        if (!w.origDeadline) w.origDeadline = w.deadline;
        const was = w.deadline;
        w.deadline = now.toISOString();
        w.lockEvents = [...(w.lockEvents || []), { at: w.deadline, action: "lock", was }];
        await putWeek(w);
        await addLog(BY, "Locked picks early", `Week ${w.week} locked ${ctTime(now)}. The deadline was ${ctTime(was)}. Everyone's picks now show.`);
        return send(res, 200, { ok: true });
      }
      case "unlock": {
        const w = await getWeek(b.weekId);
        if (!w) return fail(res, 404, "Week not found.");
        if (effectiveStatus(w) !== "locked") return fail(res, 409, w.status === "final" ? "Reopen scoring first, then unlock." : "Only a locked week can be unlocked.");
        const until = Date.parse(b.until);
        if (!Number.isFinite(until) || until <= Date.now() + 60e3) return fail(res, 400, "Choose a new deadline at least a minute from now.");
        if (until > Date.now() + 14 * 86400e3) return fail(res, 400, "Choose a new deadline within two weeks.");
        const was = w.deadline;
        if (!w.origDeadline) w.origDeadline = was; // the slate's Saturday stays tied to the first deadline
        w.deadline = new Date(until).toISOString();
        w.lockEvents = [...(w.lockEvents || []), { at: new Date().toISOString(), action: "unlock", until: w.deadline }];
        await putWeek(w);
        await addLog(BY, "Unlocked picks", `Week ${w.week} reopened ${ctTime(new Date())}. New deadline ${ctTime(w.deadline)}. Picks were showing from ${ctTime(was)} and are hidden again until the new deadline.`);
        return send(res, 200, { ok: true });
      }
      case "swap": {
        const w = await getWeek(b.weekId);
        if (!w) return fail(res, 404, "Week not found.");
        if (effectiveStatus(w) !== "draft") return fail(res, 409, "Swaps are allowed only before picks open.");
        const oldG = w.games.find((g) => g.id === b.outId);
        const newG = (w.pool || []).find((g) => g.id === b.inId);
        if (!oldG || !newG) return fail(res, 400, "Choose a game to replace and a replacement.");
        w.games = w.games.map((g) => (g.id === b.outId ? { ...newG, slot: oldG.slot, swap: true } : g));
        w.swaps = [...(w.swaps || []), { out: `${oldG.away} at ${oldG.home}`, in: `${newG.away} at ${newG.home}`, at: new Date().toISOString() }];
        await putWeek(w);
        await addLog(BY, "Swapped a game", `Week ${w.week}: ${oldG.away} at ${oldG.home} replaced by ${newG.away} at ${newG.home}`);
        return send(res, 200, { ok: true });
      }
      case "scores": {
        const w = await getWeek(b.weekId);
        if (!w) return fail(res, 404, "Week not found.");
        const results = { ...(w.results || {}) };
        const parts = [];
        for (const [gid, r] of Object.entries(b.results || {})) {
          const g = w.games.find((x) => x.id === gid);
          if (!g) continue;
          if (r.auto) {
            // Hand the game back to automation. It keeps the current score until ESPN updates it.
            if (results[gid] && results[gid].src === "manual") { results[gid] = { ...results[gid], src: "auto" }; parts.push(`${g.away} at ${g.home} back to ESPN`); }
            continue;
          }
          if (r.void) { results[gid] = { away: 0, home: 0, final: false, void: true, src: "manual" }; parts.push(`${g.away} at ${g.home} void`); continue; }
          const a = Number(r.away), h = Number(r.home);
          if (!Number.isInteger(a) || !Number.isInteger(h) || a < 0 || h < 0) continue;
          const old = results[gid];
          if (old && old.src !== "manual" && old.away === a && old.home === h && !!old.final === !!r.final && !old.void) continue; // unchanged ESPN score
          results[gid] = { away: a, home: h, final: !!r.final, void: false, src: "manual" };
          parts.push(`${g.away} ${a}, ${g.home} ${h}${r.final ? " final" : ""}`);
        }
        w.results = results;
        await putWeek(w);
        if (!parts.length) return send(res, 200, { ok: true });
        await addLog(BY, "Edited scores", `Week ${w.week}: ${parts.join("; ")}`);
        return send(res, 200, { ok: true });
      }
      case "runJob": {
        if (!JOB_NAMES.includes(b.job)) return fail(res, 400, "Unknown job.");
        const out = await runJob(b.job, { by: BY, force: !!b.force });
        return send(res, 200, { ok: true, ...out });
      }
      case "dismissFlag": {
        await dismissFlag(String(b.key || ""));
        return send(res, 200, { ok: true });
      }
      case "autoSettings": {
        const cfg = await getConfig();
        const parts = [];
        if (typeof b.autoOpen === "boolean" && b.autoOpen !== cfg.autoOpen) { cfg.autoOpen = b.autoOpen; parts.push(b.autoOpen ? "Picks open by themselves Wednesday 6 p.m." : "Picks open only when the commissioner taps Open picks"); }
        if (typeof b.autoPaused === "boolean" && b.autoPaused !== cfg.autoPaused) { cfg.autoPaused = b.autoPaused; parts.push(b.autoPaused ? "Paused automation" : "Resumed automation"); }
        if (b.live && typeof b.live === "object") {
          const was = liveCfg(cfg), next = { ...was };
          if (typeof b.live.on === "boolean") next.on = b.live.on;
          if (b.live.gap !== undefined) {
            const g = Number(b.live.gap);
            if (!Number.isInteger(g) || g < LIVE_LIMITS.gapMin || g > LIVE_LIMITS.gapMax) return fail(res, 400, `The gap must be ${LIVE_LIMITS.gapMin} to ${LIVE_LIMITS.gapMax} minutes.`);
            next.gap = g;
          }
          if (b.live.cap !== undefined) {
            const c = Number(b.live.cap);
            if (!Number.isInteger(c) || c < 1 || c > LIVE_LIMITS.capMax) return fail(res, 400, `The daily cap must be 1 to ${LIVE_LIMITS.capMax}.`);
            next.cap = c;
          }
          if (next.on !== was.on) parts.push(next.on ? "Page visits can run overdue scores and the open" : "Page visits no longer run jobs");
          if (next.gap !== was.gap || next.cap !== was.cap) parts.push(`Page visit runs: every ${next.gap} minutes, ${next.cap} a day at most`);
          cfg.liveRun = next;
          if (next.on && !was.on) await clearLiveFlags();
        }
        if (!parts.length) return send(res, 200, { ok: true });
        await setKv("config", cfg);
        await addLog(BY, "Changed automation", parts.join(". "));
        return send(res, 200, { ok: true });
      }
      case "robo": {
        const cfg = await getConfig();
        if (b.backfill) {
          // Weeks with no Robo-Sharp inputs get them now. An open week uses today's market lines and ratings.
          // A locked or final week uses the line saved last before each kickoff (the close) and the ratings
          // saved with that week if they hold SP+ or VSiN, else today's. Both are after the fact, and the note says so.
          const now = Date.now();
          const R = (await getKv("rankings", null)) || {};
          const ats = await getKv("atsAuto", { lines: {} });
          const tg = (await getKv("teamGames", null)) || { games: {} };
          const close = (id) => (ats.lines && ats.lines[id] != null ? ats.lines[id] : tg.games && tg.games[id] ? tg.games[id].l : null);
          const done = [];
          for (const r of await q("select id, data from weeks order by id")) {
            const w = r.data;
            if (w.robo && w.robo.last) continue;
            const st = effectiveStatus(w, now);
            if (st === "draft") continue;
            const day = new Date(now).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
            if (st === "open" && now < Date.parse(w.deadline)) {
              captureRobo(w, R.power, (id) => ats.lines && ats.lines[id], now, `Saved ${day}, after picks opened, so there is no opening lean to compare.`);
            } else {
              const snap = await one("select data from snapshots where week_id = $1", [w.id]);
              const sp = snap && snap.data && snap.data.power;
              const useSnap = sp && ((sp.sp && sp.sp.teams && sp.sp.teams.length) || (sp.vsin && sp.vsin.teams && sp.vsin.teams.length));
              captureRobo(w, useSnap ? sp : R.power, close, now, `Filled ${day}, after the fact: closing lines and ${useSnap ? "the ratings saved with this week" : `ratings as of ${day}`}.`);
            }
            await putWeek(w);
            done.push(w.week);
          }
          if (done.length) await addLog(BY, "Updated Robo-Sharp", `Saved its inputs for Week ${done.join(", ")}`);
          return send(res, 200, { ok: true, weeks: done });
        }
        return fail(res, 400, "Nothing to change.");
      }
      case "gmPosted": {
        // GroupMe tab: mark an announcement posted, or undo it. Private to the commissioner, so no public log entry.
        const key = String(b.key || "");
        if (!/^(pv|live|last|lock|final):\d{4}-w\d{1,2}$/.test(key)) return fail(res, 400, "Unknown post.");
        const gm = await getKv("groupme", { posted: {} });
        gm.posted = gm.posted || {};
        if (b.undo) delete gm.posted[key];
        else gm.posted[key] = new Date().toISOString();
        // Keep the newest 80 marks so the row stays small.
        gm.posted = Object.fromEntries(Object.entries(gm.posted).sort((x, y) => (x[1] < y[1] ? 1 : -1)).slice(0, 80));
        await setKv("groupme", gm);
        return send(res, 200, { ok: true, posted: gm.posted });
      }
      case "config": {
        const cfg = await getConfig();
        if (typeof b.name === "string" && b.name.trim()) cfg.name = b.name.trim().slice(0, 40);
        if (b.teamOverrides && typeof b.teamOverrides === "object") cfg.teamOverrides = b.teamOverrides;
        await setKv("config", cfg);
        await addLog(BY, b.logAction || "Changed league settings", b.logDetail || "");
        return send(res, 200, { ok: true });
      }
      case "importRankings": {
        if (!b.data || typeof b.data !== "object") return fail(res, 400, "Rankings must be JSON.");
        // Ratings only (for example {"power":{"sp":{...},"vsin":{...}}}): merge into what is saved,
        // keep the polls and the other systems, and leave the weekly snapshot alone.
        const keys = Object.keys(b.data);
        if (keys.length && keys.every((k) => k === "power") && b.data.power && typeof b.data.power === "object") {
          const sys = Object.keys(b.data.power).filter((k) => b.data.power[k] && Array.isArray(b.data.power[k].teams) && b.data.power[k].teams.length);
          if (!sys.length) return fail(res, 400, "No ratings found. Each system needs a teams list.");
          const R = (await getKv("rankings", null)) || {};
          R.power = { ...(R.power || {}) };
          for (const k of sys) R.power[k] = b.data.power[k];
          await setKv("rankings", R);
          const nameOf = { sp: "SP+", vsin: "VSiN", fpi: "FPI" };
          await addLog(BY, "Updated ratings", sys.map((k) => `${nameOf[k] || k} as of ${b.data.power[k].asOf || "today"} (${b.data.power[k].teams.length} teams)`).join("; "));
          return send(res, 200, { ok: true, merged: sys });
        }
        await setKv("rankings", b.data);
        if (b.snapshotWeek) await q("insert into snapshots (week_id, data) values ($1, $2::jsonb) on conflict (week_id) do update set data = excluded.data", [b.snapshotWeek, JSON.stringify(b.data)]);
        await addLog(BY, "Updated rankings", b.snapshotWeek ? `Saved a snapshot for ${b.snapshotWeek}` : "");
        return send(res, 200, { ok: true });
      }
      case "importRedditPoll": {
        let rp;
        try { rp = parseRedditText(b.text); } catch (e) { return fail(res, 400, "That did not look like the r/CFB poll table: " + e.message); }
        const R = (await getKv("rankings", null)) || {};
        R.reddit = { ...rp, asOf: rp.asOf || "pasted " + new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }) };
        await setKv("rankings", R);
        await addLog(BY, "Updated rankings", `r/CFB poll ${R.reddit.asOf}, pasted`);
        return send(res, 200, { ok: true, count: rp.teams.length, unknown: rp.unknown });
      }
      default:
        return fail(res, 400, "Unknown action.");
    }
  } catch (e) {
    console.error(e);
    fail(res, 500, e.message || "Server error");
  }
}
