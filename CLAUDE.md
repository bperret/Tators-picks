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
- Automation: GitHub Actions twice an hour at :19 and :49 (`.github/workflows/automation.yml`, secrets SITE_URL and CRON_SECRET) plus a daily Vercel cron call `/api/cron`. Jobs: preview (Mon 9 a.m. CT to the slate, repulled every 6 hours), slate (Tue 1 p.m. CT from ESPN), refresh (button only, also runs inside open), open (Wed 6 p.m. CT), scores and auto final, rankings (AP, CFP, FPI from ESPN; r/CFB poll from poll.redditcfb.com HTML, `lib/polls.js`), ATS, gamelog (fills weeks 1 to now once, then rechecks the last two weeks Sunday 9 a.m.), lines (fills missing lines and totals from ESPN core per-game odds, 100 games a run, stops if a batch finds none). Failures become flags in the Commish Automation panel. Every job has a manual button. Hand-entered scores are never overwritten.
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
- Picker stats on the Pickers tab: career wins (`careerPanel`), tendencies (`insightPanel`), past picks by week (`pastPanel`). All read a data object D from `realStats()`, so tests can feed them a dummy league (see `dev/test.mjs`). Robo-Sharp gets none of these. Bowl and CFP wins read `bowl` and `cfp` in `realStats()`, empty until those contests exist.
- Beat the close: `closingLines` in `lib/league.js` sends `state.closing` (saved last line before kickoff, half-point rule applied, started games only). `closeOf` compares it to `homeLine`. Moved games only; `closePanel` is on Standings, with Robo-Sharp unranked. The game log is read only if a started game has no saved line, since the page polls every 60 seconds.
- Commish sections fold (details with `data-sec`), saved per device in localStorage `tp-commish-open`, plus Expand all and Collapse all. Defaults: This week and Swap games open; Automation opens when it has flags; League members opens when a new PIN is showing.
- SP+ and VSiN: the "ratings" job (`lib/ratings.js`), button only (Update ratings in Automation, never in `dueJobs`). SP+ reads the ratings table on ESPN's "2026 college football SP+ rankings for all 138 FBS teams" story (`SP_URL`, skips the résumé table, maps ESPN short names). VSiN finds Adam Burke's "Week N ... Power Ratings and Projections for Every Game" article from the VSiN college page, then the usual address; N is the coming week (current week + 1 once it locks). Checks: 130+ known schools, page under 10 days old, average change from saved under 5 points; else a flag and nothing saved. Each source saves on its own. Unchanged numbers report "has not changed". Paste fallback: a power-only JSON in Manual backups merges the same way. Both sources post Sunday or Monday; CFB Update lagged, so it is not used.
- Preview slate: the `preview` job saves kv `preview` (the slate rule's games and current lines) and no week, so it takes no picks and touches no standings. `buildState` sends `state.preview` to every login: the kv record until a week exists, then the draft's games with no model lines, so swaps and rebuilds show on their own. The commissioner sees the same panel above his draft view. `previewPanel()` sits on top of Picks. ESPN's line coverage on Monday is not verified live; a short preview raises a flag.
- Lines: `refreshDraft` updates a draft's lines, totals, and pool from ESPN with the half-point rule and logs moved lines. It keeps Robo-Sharp's FPI lines. `openJob` runs it first, both on schedule and from either Open picks button, so lines are final when picks open. If ESPN fails, picks still open on saved lines with a flag. The `refresh` job updates the draft, or the preview if no draft exists, and refuses once picks are open. It does not run on a schedule.
- Picks are live alert: `revealLive()` runs after each refresh. Once per week per device (`tp-seen-live-<uid>`), skipped when the picker's sheet is in. It reaches only pickers who open the site.
- Commissioner can lock early and unlock with a new deadline; both log publicly. `origDeadline` keeps the week tied to its Saturday.

## League rules (decided)
- 10 Saturday games kicking off 11 a.m. CT or later: 5 top AP games (ranked v ranked first), then 5 tightest lines among other ranked-team games. Half-point lines; on a whole number the underdog gets the half. Lines are final when picks open.
- 1 point per correct pick, one 3 point field goal (FG; stored as `lock` in pick data; goalpost icon `GP`, no emoji exists), tiebreaker = total points in game 1 (game 2 if game 1 is void; blank = 0). Void games score for nobody.
- Conference Champion Week is the final regular season week. Its points count in the season standings and season prizes like any week. Its winner gets a Conf Champ win, a separate career stat that is not a weekly win, and 6% instead of the 1% weekly prize. It is not one of the 14 weekly prizes. A week is flagged with `confChamp: true`.
- Weekly winner: points, then tiebreaker, else shared. Season: points, field goals made, smallest total tiebreaker misses.
- Survivor: one team ATS a week, no repeats, a miss means out. It ends after the Saturday Nov 28 week; anyone still alive shares the title. If every remaining picker goes out in the same week, all play one more week (used teams stay used); in the last week they share instead. A lone picker is never resurrected. A picker with no sheet in a Survivor's first week is out of it, and resurrection does not bring them back (`survLate`).
- Robo-Sharp (🤖, black and silver): model side in every game, field goal on biggest edge, betting total as tiebreaker, biggest unused edge in Survivor. Shows in standings with no rank and never wins a week, trophy, Survivor, or the season; the best picker wins instead.
- People are "pickers". Tabs: Picks, Standings, Recap, Survivor, Pickers, Teams, Rules, Profile, Commish. The public log never shows the commissioner's private nickname for a picker.
- 2026 is a free test season: no buy-ins, no payouts. Weeks, standings, and titles still count. Payouts start in 2027, and the Rules page shows them as hypothetical so pickers can try scenarios and give feedback.
- Money is off the site; the Rules page only posts the plan. Payouts are shares of the pot (Stay Engaged): season 20 / 10 / 5, weekly 1% each, Conference Champion Week 6%, Survivor 5% a run, Bowl 10 / 5, CFP 10 / 5. The buy-in is not set. Bowls are a separate contest.
- No test weeks (decided Oct 31). Week 9 counts as the first week; every revealed week counts toward the season. Weeks keep their real numbers (next is Week 10). The old `scored` flag is ignored and new weeks save `scored: true`.

## Idea tracker
The landing spot for every idea not yet ready to build, for any timing: this season, this postseason, next season, or later. Add new ideas here as Benton names them. Build nothing here until he says it is ready. Timing heading = his target.

Changelog rule: `CHANGELOG.md` lists everything shipped, with date, effort, and commit. When a tracker item ships, remove it from the tracker and add its row in the same push. Add a row for any other app change too. A row can name its commit only after the commit exists, so add it as a second commit before pushing.

Conflict rule: if a request conflicts with a tracker item, stop before building and check with Benton in one line: this differs from the tracker, go ahead and update the tracker, or pause and review what was discussed. Quote the tracker line. Build nothing until he answers. This is the one case where a reply may end with a question.

Rules page rule: every change that affects how the league plays, scores, or pays must update the Rules page in the same build. No such item is done until the Rules text matches. Items that need it: 1, 2, 3, 4, 8, 10, 18. Add Bowl and CFP rules to the Payouts section if their prizes change.

### This season and postseason (target, not started)
1. Conference Champion Week: the final week of the regular challenge. 2026: all 10 title games, 5 on Fri Dec 4 and 5 on Sat Dec 5.
   - Lock before the first Friday kickoff (about 6 p.m. CT), one lock for the week. The normal slate rule and the Saturday 10:15 a.m. lock do not apply.
   - No Survivor pick this week. Survivor already ends after the Nov 28 week.
   - The build must save `confChamp: true` on this week. Career stats, Weekly titles, the recap, and the Rules page already read it or describe it.
   - To settle: how the week builds if ESPN's week number or season type differs.
2. CFP bracket challenge: a bracket, not ATS. 12 teams. Selection Sun Dec 6, first game Fri Dec 18, title Mon Jan 25.
   - One bracket, fully filled out, with one lock before Dec 18. Own bracket screen, scoring, and standings, separate from the regular challenge. Tiebreaker: title game total.
   - The top four seeds have byes, so they earn no first round points. Nobody re-picks: a pick on a team that is already out scores 0.
   - Scoring doubles each round, so the title game counts the most: first round 1, quarterfinals 2, semifinals 4, title game 8. Perfect bracket = 28.
3. Bowl challenge: separate from the regular challenge, with its own standings. All non-CFP bowls except the Celebration Bowl: 35 bowls, Dec 15 to Jan 2 (ESPN's list has the Arizona Bowl with no date; recheck).
   - Each picker chooses 10 bowls and picks them against the spread. One 3 point field goal. A blank pick scores 0.
   - One lock for the whole contest, Tuesday Dec 15 before the first kickoff.
   - Tiebreaker: everyone guesses the total points in one fixed bowl, picked or not: the bowl with the highest ranked AP teams. Use AP ranks added, unranked = 26, then the best single rank, the same as the kickoff order rule.
   - Lines are set once, sometime after Dec 6. Timing not decided. A void game scores for nobody and cannot be replaced after the lock.
   - Robo-Sharp plays unranked and cannot win. It takes its 10 biggest edges. Unlike a regular week, its picks and model lines stay hidden until the lock.
   - The slate job skips postseason today (`seasonType !== 2`), so this needs its own build path.
10. Second Survivor run this season. Decided, waiting on Benton's go to build. It must be live before the Nov 14 week opens, Wednesday Nov 11.
   - It starts the Nov 14 week and runs through Nov 28, 3 weeks. The first run ends with the Nov 7 week, and anyone alive then shares it.
   - ATS for all of 2026; straight up starts in 2027 (item 4), though that is under review.
   - Conference lock, a test for this run. Picking a team burns its conference for the run. Only the picked team's conference burns, so in a nonconference game the other team's conference stays available. Burned conferences start empty at the run's start.
   - The no-repeat team rule goes away for this run, since a burned conference already blocks the team.
   - Independents count as one group, so picking Notre Dame burns Independents.
   - If no legal game is left on the slate, the picker can pick any game, including a team already used.
   - Everyone starts the run alive, including pickers already out. A picker who joins after the run's first week and misses it is out of that run.
   - Build it all together: the second run, the conference lock, and the Rules text, in one build. The first run keeps the no-repeat team rule through Nov 7. The server must enforce the lock, as it does used teams today, and Robo-Sharp's Survivor pick must follow it.
   - Build note: the app handles one run today (`survivorStart`, `survivorEnd`, `survLate`). Career stats count one Survivor win a season. Item 4 needs runs too, so this work carries into 2027. A change needs the Rules page in the same build.
22. Survivor chip on the save bar. A picker who is out of Survivor should not see the Survivor chip light up as a warning.
   - The missing pick warning on save already skips pickers who are out (`missingItems`, 1.26.3). The chip in the `.cks` row does not. It checks only `survivorStart()`, not whether the picker is alive.
   - Build note: use the same test as `missingItems`: survivor open, and alive or pending. That test also drops the chip after Survivor ends, such as in Conference Champion Week. Keep it in step with item 10.

### Next season (2027)
4. Survivor: straight up, fixed runs. Replaces the two skulls idea, which is dropped.
   - Conference lock is being tested in the 2026 second run (item 10). Decide after that run whether it stays for 2027.
   - Under review (Nov 2): Benton is thinking of keeping ATS in 2027, since 5 week runs need quick eliminations. Not decided. A rough model at 20 pickers: ATS gives a solo winner about 70% of runs; straight up leaves 9 to 11 alive after 5 weeks.
   - Pick one team to win outright, not against the spread. One loss and you are out of that run.
   - The season has fixed runs, for example weeks 1 to 5, 6 to 10, and 11 to the last week before Conference Champion Week. Everybody starts each run alive, and used teams reset.
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
5. Upkeep share: Benton is considering 5% of each buy-in. Not decided. Vercel lists "receiving payment to create, update, or host the site" as commercial use, which Hobby does not allow, so taking this share means moving to Pro, $20 a seat a month. Check with Vercel support before 2027 buy-ins either way. The Payouts calculator has an upkeep box, set to 0. Buy-in amount is also not set.

### Engagement review (Nov 2): Benton's calls
Design rule: this league is for people who care enough to check it without prompting. Benton sends no mass messages and follows up one person at a time by text if he wants. There is no group chat to count on. Nothing here may depend on outside prompting. Pickers who lose interest are allowed to drop off.
Keep the weekly rhythm, Picks, Recap, Survivor, weekly titles, and Robo-Sharp as they are. Fixed times are the habit: Mon preview, Wed 6 p.m. live, Sat 10:15 a.m. lock, Sunday recap.

Approved for this season, not started:
13. Weekly rival. Each picker gets the picker just above them in the season standings, shown on Picks, during games, and in the Recap. Page only, from saved picks. Rival record feeds Head to head. To settle: who the top picker's rival is.
14. What you need. A live Saturday line, such as "1 back of the lead with 3 games left", plus your rival's score.
15. Your week at the top of the Recap: your record, best pick, worst beat, and rank move.
16. Line moved tags: on the Wednesday slate, show each line's move since the preview. Only if it stays small, with no real upkeep.
17. Engagement view for the commissioner, in Commish or its own tab: engagement by person and by page, including last seen, sheet time, and Recap reads. Only if it stays small, with no real upkeep. Commissioner only.
18. Iron Man. A status for a picker who makes all 10 picks before the lock every regular season week. Tiebreaker and Survivor do not count. Conference Champion Week counts. Bowl and CFP do not. A full season Iron Man is a historical accomplishment on the stats pages. No penalty status for pickers who are not Iron Men. To settle: how it treats a late joiner and a void game. A change needs the Rules page in the same build.

Hold, risk review first:
11. Reliable scores and timing. Benton likes it but nothing gets built until the risks are checked. GitHub ran 6 times on Sat Oct 31, about every 3 hours, with a median gap of 6 hours across Oct 29 to Nov 2, not twice an hour. Idea: when a logged in page polls and a job is overdue, the site runs it (scores while games are live, open at Wed 6 p.m., preview Monday). No new service. The page says "about twice an hour", which must match what is true.
   - Risk review done Nov 2: safe to build with the guardrails below. Waiting on Benton's go, after he checks the Vercel and Neon usage pages.
   - Scope: scores and the Wednesday open only. Rankings, ATS, lines, slate, and preview stay on the schedule.
   - Trigger: a logged in page poll, only while a locked week has a game kicked off and not final, or when a draft is past its open time.
   - Guardrails: at least 10 minutes between attempts, saved before the ESPN call behind the existing database lock, so traffic cannot multiply calls. A daily cap of 80 attempts. A Commish on and off switch that starts off, with today's count shown. Any 403 or 429 turns it off and raises a flag until Benton resets it. No retries.
   - Decided Nov 2: start at every 10 minutes. The gap is a Commish setting, so it can change with no code push. Try 10 for a Saturday. If the count looks right and nothing flags, consider 5, with a daily cap of 160.
   - Math: at most 75 ESPN scoreboard calls on a 12.5 hour Saturday. ESPN publishes no limit, so that cap is a judgment call, not a safe number from ESPN.
   - Bigger risk than item 11: the 60 second page poll sends the full state. Estimated Vercel transfer is 0.5 to 9.4 GB a month against 10 GB, and Neon transfer is unmeasured against 5 GB. If either page shows over 30% used, build a light version check first, so the full state loads only when something changed.
   - Fix the page wording in the same build: scores about every 10 minutes while games are live.

Separate task, to investigate:
21. Backup options in case of failure. Benton wants this looked at on its own. Cover what happens if Vercel pauses the site, Neon suspends or loses data, or ESPN blocks the app, and what backups or fallback hosting would get the league running again. Investigate only, nothing built yet.

Ideas to shape later, not approved:
19. Your season recap replaces the Recap for everyone, personal to each picker. The league-wide stats move to a new area, maybe called the Record Book. Benton's idea, wording "maybe". To settle: how it fits with the current Recap, and when in the season it runs.
20. For 2027, to review: add to home screen prompt, web push (not verified), accomplishments, and a 4 week fresh start contest if the season race goes stale.

Thrown out: 12 (group text kit). Benton will not send mass messages.
Do not add: daily check ins, points currency, in-app chat, more contests this season.

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
