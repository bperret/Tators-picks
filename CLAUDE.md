# Tator's Picks: handoff notes

Private college football ATS pick em for one league. Commissioner: Benton (bperret). Live on Vercel (Hobby) with Neon Postgres. Repo: bperret/Tators-picks.

## Working style
- Plain, short sentences. No em dashes. Lead with the answer. Never end a reply with a question.
- Batch changes. Skip screenshots for wording or logic changes. Run `SETUP_CODE=LOCALCODE npm test` before every push (auto-test plus Playwright, all must pass).
- Commit to main and push; Vercel deploys on push.

## Architecture
- `public/index.html`: the whole page (HTML, CSS, JS in one file). Source of truth.
- `api/`: `state`, `auth`, `picks`, `admin`, `cron` (5 functions). `lib/`: `db`, `http`, `league`, `auto`, `espn`, `teams`, `polls`.
- The server clock enforces the lock (423 after the deadline). Reveals are built server side only after the deadline. Drafts go to the commissioner only.
- Login: cell number plus 6 digit PIN the commissioner makes. 10 wrong tries pause 15 minutes. No texts sent.
- Automation: GitHub Actions twice an hour at :19 and :49 (`.github/workflows/automation.yml`, secrets SITE_URL and CRON_SECRET) plus a daily Vercel cron call `/api/cron`. Jobs: slate (Tue 1 p.m. CT from ESPN), open (Wed 6 p.m. CT), scores and auto final, rankings (AP, CFP, FPI from ESPN; r/CFB poll from poll.redditcfb.com HTML, `lib/polls.js`), ATS, gamelog (fills weeks 1 to now once, then rechecks the last two weeks Sunday 9 a.m.), lines (fills missing lines and totals from ESPN core per-game odds, 100 games a run, stops if a batch finds none). Failures become flags in the Commish Automation panel. Every job has a manual button. Hand-entered scores are never overwritten.
- Teams has three views. Polls: AP, CFP, r/CFB merged, sortable by any poll (CFP default once out). Power: Ratings (SP+, VSiN, FPI) or Scoring (PPG, PA, margin, SOS from opponents' current SP+; FCS left out). ATS: record, cover margin, O/U; uses the game log record when 5% or fewer of logged games lack a line, else the Covers season record. Tap any team for one shared team card with splits and its game log. Conference and slate filters carry across views. Game log comes from kv `teamGames` through `/api/state?part=teams`.
- Dark mode: follows the device by default. Profile has Auto, Light, Dark, saved per device in localStorage `tp-theme` and applied by an inline script in `<head>` before the page draws (`data-theme` on `<html>`).
- No team logos: they are trademarked marks. Teams show as color chips with abbreviations.
- Commish League members shows each picker's sheet for the week in view: complete, missing parts (picks count, field goal, tiebreaker, survivor if still alive), or not in. The server sends the commissioner game ids and yes or no only (`sheetStatus`), never sides.
- Do not edit `.github/workflows/automation.yml` from a Claude session. GitHub never fired the schedule while the "claude" account was its last editor; it started after Benton edited the cron line himself (Oct 29). Any change to that file goes to Benton to make on github.com.
- Picks page after the lock: games sort by kickoff; at the same kickoff the better game goes first (AP ranks added, unranked = 26, then best single rank, then slot). The Robo-Sharp model line hides once picks show; Robo-Sharp (🤖 Robo) appears in the pick columns under each game instead, not in the split bar counts.
- Live games: the scores job saves `period`, `clock`, `dclock`, `at` per game and `scoresAt` on the week, and saves clock-only changes without a log entry. The picks page shows "Q3 · 8:42" (Halftime, OT, End of Q2, Final) and "Scores updated" time. Your live pick gets a tier chip with cover odds: normal curve, sd = 13.5 x sqrt(minutes left / 60). Safe 90%+, Leaning 70%+, Toss up 40%+, In danger 15%+, Red alert below. Refresh rate stays as is (free ESPN, twice an hour).
- Commish sections fold (details with `data-sec`), saved per device in localStorage `tp-commish-open`, plus Expand all and Collapse all. Defaults: This week and Swap games open; Automation opens when it has flags; League members opens when a new PIN is showing.
- Commissioner can lock early and unlock with a new deadline; both log publicly. `origDeadline` keeps the week tied to its Saturday.

## League rules (decided)
- 10 Saturday games kicking off 11 a.m. CT or later: 5 top AP games (ranked v ranked first), then 5 tightest lines among other ranked-team games. Half-point lines; on a whole number the underdog gets the half.
- 1 point per correct pick, one 3 point field goal (FG; stored as `lock` in pick data; goalpost icon `GP`, no emoji exists), tiebreaker = total points in game 1 (game 2 if game 1 is void; blank = 0). Void games score for nobody.
- Weekly winner: points, then tiebreaker, else shared. Bragging rights only. Season: points, field goals made, smallest total tiebreaker misses.
- Survivor: one team ATS a week, no repeats, a miss means out.
- Robo-Sharp (🤖, black and silver): model side in every game, field goal on biggest edge, betting total as tiebreaker, biggest unused edge in Survivor. Shows in standings with no rank and never wins a week, trophy, Survivor, or the season; the best picker wins instead.
- People are "pickers". Tabs: Picks, Standings, Survivor, Pickers, Teams, Rules, Profile, Commish. The public log never shows the commissioner's private nickname for a picker.
- Money is off the site. Bowls are a separate contest.
- No test weeks (decided Oct 31). Week 9 counts as the first week; every revealed week counts toward the season. Weeks keep their real numbers (next is Week 10). The old `scored` flag is ignored and new weeks save `scored: true`.

## NFL version (planned, not built; decided Oct 31)
- A toggle at the top flips the whole site between Tator's College Picks and Tator's NFL Picks. Same tabs and navigation. One login (phone, PIN, profile look shared); everything else is fully separate per sport: weeks, picks, standings, Survivor, Teams, Pickers, log, snapshots, config, automation status. No combined views.
- Slate: every game kicking off after the lock (Sunday and Monday games). Thursday, Friday, and Saturday games are left out. Lock: Sunday 6:00 a.m. CT, one lock per week like college.
- Order: backwards, latest kickoff first (MNF at top, Sunday early games at the bottom).
- Tiebreaker: total points in the last game of the week (latest kickoff, normally MNF). Two Monday games: the later kickoff. No Monday game (Week 18): the latest Sunday game. If that game is void, the next latest. Blank = 0.
- Lines: same half-point rule as college. 1 point per correct pick, one 3 point field goal.
- Survivor: straight up (SU), one team a week, no repeats. With SU, a Survivor pick against your own ATS pick is not a sure loss, so the conflict warning does not apply. Robo-Sharp's Survivor pick: biggest projected FPI win among unused teams.
- Teams tab for NFL: standings (by division), Power (FPI and scoring), ATS. No polls, SP+, or r/CFB.
- Build behind a toggle only the commissioner sees until NFL tests pass. College tests must pass at every push.

## Open items
- Turn off the four old Claude-artifact scheduled tasks once Saturday scoring works on the new site.
- Later: switch college Survivor from ATS to straight up (SU), the same as the planned NFL Survivor. Do not change it mid-run for a Survivor already in progress; apply it at a new Survivor start or next season.
- ESPN rankings and FPI feed shapes were not verified live; watch for flags on the first runs.
- The r/CFB parser was built from the page's table text, not its raw HTML. Watch for a Refresh rankings flag on the first run. Fallback: copy the poll table from the site and paste it in Update rankings.
- Team stats: ESPN's scoreboard drops lines from finished games. The lines job filled weeks 1 to 9 from ESPN's core per-game odds feed, verified live Oct 29. New games get lines saved before kickoff by the hourly ATS run.
