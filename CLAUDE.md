# Tator's Picks: handoff notes

Private college football ATS pick em for one league. Commissioner: Benton (bperret). Live on Vercel (Hobby) with Neon Postgres. Repo: bperret/Tators-picks.

## Working style
- Plain, short sentences. No em dashes. Lead with the answer. Never end a reply with a question.
- Batch changes. Skip screenshots for wording or logic changes. Run `SETUP_CODE=LOCALCODE npm test` before every push (auto-test plus Playwright, all must pass).
- Commit to main and push; Vercel deploys on push.
- This is a hobby league that will never be commercial. No legal or terms of service comments or searches about it.

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
- Cover badges on game cards read from your side: green "You covered" or "You're covering" on your pick, red "Beat you" or "Beating you" on the other team. No pick keeps the neutral label.
- Result reveal: `revealFinals()` runs after each refresh (the page polls every 60 seconds). A card and flash show games that went final since this device last looked, saved per login in localStorage `tp-seen-finals-<uid>`. Several finals share one card. A first visit on a device after a week closed stays quiet.
- Weekly recap: Recap tab, built in the page by `recapFacts(wid)` from saved picks and results, for final weeks only, with a week picker. A banner on Picks shows until the latest recap is read (`tp-recap-seen-<uid>`). Clean jokes, referee voice. A negative award never lands on the same picker twice in a week. To grow it, add facts to `recapFacts`.
- Survivor end: `config.survivorEnd` (default in `DEFAULT_CONFIG`, 2026-11-29 midnight CT; `SURVIVOR_END` overrides it, and `dev/server.mjs` sets a far date because tests use real dates). The page uses `survivorOpen`, the server uses `survivorClosed`. Saved config keeps its value, so a new season must update the saved config. `survivorRevived()` works out resurrection weeks for both the board and the grid.
- Payouts: `#payouts` in Rules, `PAY` holds the shares, `payUpdate()` does the math. Page only; nothing is saved.
- Picker stats on the Pickers tab: career wins (`careerPanel`), tendencies (`insightPanel`), past picks by week (`pastPanel`). All read a data object D: `realStats()` on the site, `sampleStats()` for the commissioner's Preview sample data button, which is made up, page only, and never saved. Robo-Sharp gets none of these. Bowl and CFP wins read `bowl` and `cfp` in `realStats()`, empty until those contests exist.
- Beat the close: `closingLines` in `lib/league.js` sends `state.closing` (saved last line before kickoff, half-point rule applied, started games only). `closeOf` compares it to `homeLine`. Moved games only; `closePanel` is on Standings and in the sample, with Robo-Sharp unranked. The game log is read only if a started game has no saved line, since the page polls every 60 seconds.
- Commish sections fold (details with `data-sec`), saved per device in localStorage `tp-commish-open`, plus Expand all and Collapse all. Defaults: This week and Swap games open; Automation opens when it has flags; League members opens when a new PIN is showing.
- SP+ and VSiN: the "ratings" job (`lib/ratings.js`), button only (Update ratings in Automation, never in `dueJobs`). SP+ reads the ratings table on ESPN's "2026 college football SP+ rankings for all 138 FBS teams" story (`SP_URL`, skips the résumé table, maps ESPN short names). VSiN finds Adam Burke's "Week N ... Power Ratings and Projections for Every Game" article from the VSiN college page, then the usual address; N is the coming week (current week + 1 once it locks). Checks: 130+ known schools, page under 10 days old, average change from saved under 5 points; else a flag and nothing saved. Each source saves on its own. Unchanged numbers report "has not changed". Paste fallback: a power-only JSON in Manual backups merges the same way. Both sources post Sunday or Monday; CFB Update lagged, so it is not used.
- Commissioner can lock early and unlock with a new deadline; both log publicly. `origDeadline` keeps the week tied to its Saturday.

## League rules (decided)
- 10 Saturday games kicking off 11 a.m. CT or later: 5 top AP games (ranked v ranked first), then 5 tightest lines among other ranked-team games. Half-point lines; on a whole number the underdog gets the half.
- 1 point per correct pick, one 3 point field goal (FG; stored as `lock` in pick data; goalpost icon `GP`, no emoji exists), tiebreaker = total points in game 1 (game 2 if game 1 is void; blank = 0). Void games score for nobody.
- Weekly winner: points, then tiebreaker, else shared. Season: points, field goals made, smallest total tiebreaker misses.
- Survivor: one team ATS a week, no repeats, a miss means out. It ends after the Saturday Nov 28 week; anyone still alive shares the title. If every remaining picker goes out in the same week, all play one more week (used teams stay used); in the last week they share instead. A lone picker is never resurrected.
- Robo-Sharp (🤖, black and silver): model side in every game, field goal on biggest edge, betting total as tiebreaker, biggest unused edge in Survivor. Shows in standings with no rank and never wins a week, trophy, Survivor, or the season; the best picker wins instead.
- People are "pickers". Tabs: Picks, Standings, Recap, Survivor, Pickers, Teams, Rules, Profile, Commish. The public log never shows the commissioner's private nickname for a picker.
- 2026 is a free test season: no buy-ins, no payouts. Weeks, standings, and titles still count. Payouts start in 2027, and the Rules page shows them as hypothetical so pickers can try scenarios and give feedback.
- Money is off the site; the Rules page only posts the plan. Payouts are shares of the pot (Stay Engaged): season 20 / 10 / 5, weekly 1% each, Conference Champion week 6%, Survivor 5% a run, Bowl 10 / 5, CFP 10 / 5. The buy-in is not set. Bowls are a separate contest.
- No test weeks (decided Oct 31). Week 9 counts as the first week; every revealed week counts toward the season. Weeks keep their real numbers (next is Week 10). The old `scored` flag is ignored and new weeks save `scored: true`.

## Idea tracker
The landing spot for every idea not yet ready to build, for any timing: this season, this postseason, next season, or later. Add new ideas here as Benton names them. Build nothing here until he says it is ready. Timing heading = his target.

Changelog rule: `CHANGELOG.md` lists everything shipped, with date, effort, and commit. When a tracker item ships, remove it from the tracker and add its row in the same push. Add a row for any other app change too. A row can name its commit only after the commit exists, so add it as a second commit before pushing.

Conflict rule: if a request conflicts with a tracker item, stop before building and check with Benton in one line: this differs from the tracker, go ahead and update the tracker, or pause and review what was discussed. Quote the tracker line. Build nothing until he answers. This is the one case where a reply may end with a question.

Rules page rule: every change that affects how the league plays, scores, or pays must update the Rules page in the same build. No such item is done until the Rules text matches. Items that need it: 1, 2, 3, 4, 8. Add Bowl and CFP rules to the Payouts section if their prizes change.

### This season and postseason (target, not started)
1. Conference Champion week: the final week of the regular challenge. 2026: all 10 title games, 5 on Fri Dec 4 and 5 on Sat Dec 5.
   - Lock before the first Friday kickoff (about 6 p.m. CT), one lock for the week. The normal slate rule and the Saturday 10:15 a.m. lock do not apply.
   - No Survivor pick this week. Survivor already ends after the Nov 28 week.
   - To settle: how the week builds if ESPN's week number or season type differs.
2. CFP bracket challenge: a bracket, not ATS. 12 teams. Selection Sun Dec 6, first game Fri Dec 18, title Mon Jan 25.
   - One lock before Dec 18. Own bracket screen, scoring, and standings, separate from the regular challenge. Tiebreaker: title game total.
   - To settle: points per round.
3. Bowl challenge: separate from the regular challenge, with its own standings. All non-CFP bowls except the Celebration Bowl: 35 bowls, Dec 15 to Jan 2 (ESPN's list has the Arizona Bowl with no date; recheck).
   - One lock for the whole contest, before the first bowl (Dec 15).
   - Idea, not final: each picker chooses which 10 bowls to pick.
   - To settle: ATS or straight up, field goal or not, and a tiebreaker that works when pickers hold different games. The slate job skips postseason today (`seasonType !== 2`), so this needs its own build path.

### Next season (2027)
4. Survivor: straight up, fixed runs. Replaces the two skulls idea, which is dropped.
   - Pick one team to win outright, not against the spread. One loss and you are out of that run.
   - The season has fixed runs, for example weeks 1 to 5, 6 to 10, and 11 to the last week before Conference Champion week. Everybody starts each run alive, and used teams reset.
   - No tiebreaker. Everyone still alive at the end of a run wins it. Pickers who split a win are each called Co-Champion and each gets the win on their stats page.
   - If every remaining picker goes out in the same week, they are all resurrected and play one more week. If that was the last week of the run or season, they share the title as Co-Champions instead.
   - Conflict warning goes away, since a straight up pick can win even if your ATS pick on that game loses.
   - To settle: exact run weeks and Robo-Sharp's Survivor rule (it picks by spread edge today; the NFL plan's biggest projected FPI win fits).
8. Ghost pickers: an unpaid tier so someone can try the league with no skin in the game and no effect on anyone else.
   - Paid members play every contest and can win payouts. The commissioner creates every ghost and gives the PIN, the same as any picker, and can flip the profile to paid. No open signups.
   - Ghosts play shadow versions of Survivor, the Bowl challenge, and the CFP bracket.
   - A ghost's history does not carry over on going paid; they start a new paid profile. Switching back and forth loses paid history. Pickers must keep paying each year to keep their history, or they restart.
   - Ghosts see paid pickers, the standings, and where they would rank each week, including whether they would have won. They cannot win a week, earn accomplishments, or count in any payout.
   - Paid pickers cannot see ghosts. Ghosts cannot see each other.
   - Build note: this must be filtered on the server, not hidden on the page, since `/api/state` sends players and reveals to every login. Ghosts must stay out of standings, split bars, sheet counts, the public log, and weekly winners.
5. Upkeep share: Benton is considering 5% of each buy-in. Not decided. The Payouts calculator has an upkeep box, set to 0. Buy-in amount is also not set.

### Back burner
Benton will probably never do this.

NFL version (not built; decided Oct 31):
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
- ESPN rankings and FPI feed shapes were not verified live; watch for flags on the first runs.
- The r/CFB parser was built from the page's table text, not its raw HTML. Watch for a Refresh rankings flag on the first run. Fallback: copy the poll table from the site and paste it in Update rankings.
- Team stats: ESPN's scoreboard drops lines from finished games. The lines job filled weeks 1 to 9 from ESPN's core per-game odds feed, verified live Oct 29. New games get lines saved before kickoff by the hourly ATS run.
