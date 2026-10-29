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
- Automation: GitHub Actions twice an hour at :17 and :47 (`.github/workflows/automation.yml`, secrets SITE_URL and CRON_SECRET) plus a daily Vercel cron call `/api/cron`. Jobs: slate (Tue 1 p.m. CT from ESPN), open (Wed 6 p.m. CT), scores and auto final, rankings (AP, CFP, FPI from ESPN; r/CFB poll from poll.redditcfb.com HTML, `lib/polls.js`), ATS, gamelog (fills weeks 1 to now once, then rechecks the last two weeks Sunday 9 a.m.), lines (fills missing lines and totals from ESPN core per-game odds, 100 games a run, stops if a batch finds none). Failures become flags in the Commish Automation panel. Every job has a manual button. Hand-entered scores are never overwritten.
- Teams has three views. Polls: AP, CFP, r/CFB merged, sortable by any poll (CFP default once out). Power: Ratings (SP+, VSiN, FPI) or Scoring (PPG, PA, margin, SOS from opponents' current SP+; FCS left out). ATS: record, cover margin, O/U; uses the game log record when 5% or fewer of logged games lack a line, else the Covers season record. Tap any team for one shared team card with splits and its game log. Conference and slate filters carry across views. Game log comes from kv `teamGames` through `/api/state?part=teams`.
- No team logos: they are trademarked marks. Teams show as color chips with abbreviations.
- Commish League members shows each picker's sheet for the week in view: complete, missing parts (picks count, field goal, tiebreaker, survivor if still alive), or not in. The server sends the commissioner game ids and yes or no only (`sheetStatus`), never sides.
- Commissioner can lock early and unlock with a new deadline; both log publicly. `origDeadline` keeps the week tied to its Saturday.

## League rules (decided)
- 10 Saturday games kicking off 11 a.m. CT or later: 5 top AP games (ranked v ranked first), then 5 tightest lines among other ranked-team games. Half-point lines; on a whole number the underdog gets the half.
- 1 point per correct pick, one 3 point field goal (FG; stored as `lock` in pick data; goalpost icon `GP`, no emoji exists), tiebreaker = total points in game 1 (game 2 if game 1 is void; blank = 0). Void games score for nobody.
- Weekly winner: points, then tiebreaker, else shared. Bragging rights only. Season: points, field goals made, smallest total tiebreaker misses.
- Survivor: one team ATS a week, no repeats, a miss means out.
- Robo-Sharp (🤖, black and silver): model side in every game, field goal on biggest edge, betting total as tiebreaker, biggest unused edge in Survivor. Shows in standings with no rank and never wins a week, trophy, Survivor, or the season; the best picker wins instead.
- People are "pickers". Tabs: Picks, Standings, Survivor, Pickers, Teams, Rules, Profile, Commish. The public log never shows the commissioner's private nickname for a picker.
- Money is off the site. 2026 is a test season (`scored: false`). Bowls are a separate contest.

## Open items
- Turn off the four old Claude-artifact scheduled tasks once Saturday scoring works on the new site.
- ESPN rankings and FPI feed shapes were not verified live; watch for flags on the first runs.
- The r/CFB parser was built from the page's table text, not its raw HTML. Watch for a Refresh rankings flag on the first run. Fallback: copy the poll table from the site and paste it in Update rankings.
- Team stats: ESPN's scoreboard drops lines from finished games. The lines job filled weeks 1 to 9 from ESPN's core per-game odds feed, verified live Oct 29. New games get lines saved before kickoff by the hourly ATS run.
