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
- Automation: GitHub Actions set for twice an hour at :19 and :49, but runs often come hours apart (`.github/workflows/automation.yml`, secrets SITE_URL and CRON_SECRET) plus a daily Vercel cron call `/api/cron`. Jobs: preview (Mon 9 a.m. CT to the slate, repulled every 6 hours), slate (Tue 1 p.m. CT from ESPN), refresh (button only, also runs inside open), open (Wed 6 p.m. CT), scores and auto final, rankings (AP, CFP, FPI from ESPN; r/CFB poll from poll.redditcfb.com HTML, `lib/polls.js`), ATS, gamelog (fills weeks 1 to now once, then rechecks the last two weeks Sunday 9 a.m.), lines (fills missing lines and totals from ESPN core per-game odds, 100 games a run, stops if a batch finds none). Failures become flags in the Commish Automation panel. Every job has a manual button. Hand-entered scores are never overwritten.
- Teams has three views. Polls: AP, CFP, r/CFB merged, sortable by any poll (CFP default once out). Power: Ratings (SP+, VSiN, FPI) or Scoring (PPG, PA, margin, SOS from opponents' current SP+; FCS left out). ATS: record, cover margin, O/U; uses the game log record when 5% or fewer of logged games lack a line, else the Covers season record. Tap any team for one shared team card with splits and its game log. Conference and slate filters carry across views. Game log comes from kv `teamGames` through `/api/state?part=teams`.
- Dark mode: follows the device by default. Profile has Auto, Light, Dark, saved per device in localStorage `tp-theme` and applied by an inline script in `<head>` before the page draws (`data-theme` on `<html>`).
- No team logos: they are trademarked marks. Teams show as color chips with abbreviations.
- Commish League members shows each picker's sheet for the week in view: complete, missing parts (picks count, field goal, tiebreaker, survivor if still alive), or not in. The server sends the commissioner game ids and yes or no only (`sheetStatus`), never sides.
- Do not edit `.github/workflows/automation.yml` from a Claude session. GitHub never fired the schedule while the "claude" account was its last editor; it started after Benton edited the cron line himself (Oct 29). Any change to that file goes to Benton to make on github.com.
- Picks page after the lock: games sort by kickoff; at the same kickoff the better game goes first (AP ranks added, unranked = 26, then best single rank, then slot). The Robo-Sharp model line hides once picks show; Robo-Sharp (🤖 Robo) appears in the pick columns under each game instead, not in the split bar counts.
- Live games: the scores job saves `period`, `clock`, `dclock`, `at` per game and `scoresAt` on the week, and saves clock-only changes without a log entry. The picks page shows "Q3 · 8:42" (Halftime, OT, End of Q2, Final) and "Scores updated" time. Your live pick gets a tier chip with cover odds: normal curve, sd = 13.5 x sqrt(minutes left / 60). Safe 90%+, Leaning 70%+, Toss up 40%+, In danger 15%+, Red alert below. Scores refresh on each scheduled run, plus page visit runs when that switch is on.
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
- Job messages: a job returns a past tense message that names the week, so it stays true when read days later. A run that did nothing returns `idle(msg)`, saved as `runs[job].idle`, and the panel says "Nothing to do" instead of "Worked". A run blocked by the lock returns `busy`. "All good" shows only with no flags, no failed last run, and no pause. The stale schedule flag fires after 12 hours and is a warning.
- Page visit runs (`liveRun`, `liveDue` in `lib/auto.js`): `buildState(me, { poll: true })` runs overdue scores or the Wednesday open from a logged in page's state request. The switch `config.liveRun` (`on`, `gap`, `cap`) is set in Automation. It is off in new setups; Benton turned it on for the live site Nov 4. Gap 5 to 60 minutes, default 10. Cap up to 160 a day, default 80. kv `liveRun` holds the day, count, and last attempt, saved behind the database lock before any ESPN call. Scores count only for 12 hours after a game's kickoff, so a postponed game cannot keep calling ESPN. Any 403 or 429 (`espn.takeBlocked`) turns the switch off with a flag. No retries. A quiet poll reads no extra rows, and a poll in a live window reads one small kv row.
- Line moved tags: the preview job keeps the first line it saw for each game in kv `preview.first`, and repulls never change it. `openJob` compares each final line to that and saves `pvLine` on games that moved. Picks shows the tag until the lock.
- Rival: `rivalOf(pid, wid)` is the picker just above you in the standings from weeks before that week, so it holds all week. The leader's rival is the picker right behind. Page only. `raceFacts(wid)` builds the What you need and rival lines; `racePanel` shows them on Picks. Head to head marks the rival with a pill.
- Your week: `yourWeek(wid)` and `yourWeekPanel` sit at the top of the Recap. Best pick is the correct pick the fewest pickers made. Worst beat is the closest miss. A field goal wins ties.
- Iron Man: `ironOf(D, pid, season)` needs a pick on every non-void game, every week from the picker's first sheet on. `ironSeasons` counts full seasons, from the season's first week through a final Conference Champion Week. 🦾 shows on Standings and Pickers. Career tile: Iron Man seasons.
- Engagement: Commissioner only (`state.engage`, `engagePanel`). The page POSTs tab opens and Recap reads to `/api/state` at most every 2 minutes, or as it hides (`engNote`, `engRecap`, `engFlush`). Polls send nothing. One row per picker in table `engage`. Sheet times come from `sheetStatus`.
- Playoffs tab (`#playoffs`, every login): an illustrative CFP bracket for fun, not the real contest. Nothing counts, and the page must say so until the real field is set. `cfpField()` builds the field and `BRK` holds the 11 games. Phones get one sided swipeable rounds; 1100px and wider gets the two sided bracket. Picks, the tiebreaker, and team swaps save per device in localStorage `tp-bracket-<uid>`, and clear if the current field changes. Swap teams: `brkSwapTeams()` puts any team on a seed, or trades seeds if the team is already in the field. Field warnings show to the commissioner only. The planned contest scoring (1, 2, 4, 8) is public on this tab; Benton confirmed that Nov 4. No server code except the `playoffs` engagement page.
- Team game lines: ESPN's scoreboard drops lines from finished games. The lines job filled weeks 1 to 9 from ESPN's core per-game odds feed, verified live Oct 29. New games get lines saved before kickoff by the ATS job on each run.
- Commissioner can lock early and unlock with a new deadline; both log publicly. `origDeadline` keeps the week tied to its Saturday.

## League rules (decided)
- 10 Saturday games kicking off 11 a.m. CT or later: 5 top AP games (ranked v ranked first), then 5 tightest lines among other ranked-team games. Half-point lines; on a whole number the underdog gets the half. Lines are final when picks open.
- 1 point per correct pick, one 3 point field goal (FG; stored as `lock` in pick data; goalpost icon `GP`, no emoji exists), tiebreaker = total points in game 1 (game 2 if game 1 is void; blank = 0). Void games score for nobody.
- Conference Champion Week is the final regular season week. Its points count in the season standings and season prizes like any week. Its winner gets a Conf Champ win, a separate career stat that is not a weekly win, and 6% instead of the 1% weekly prize. It is not one of the 14 weekly prizes. A week is flagged with `confChamp: true`.
- Weekly winner: points, then tiebreaker, else shared. Season: points, field goals made, smallest total tiebreaker misses.
- Survivor: one team ATS a week, no repeats, a miss means out. It ends after the Saturday Nov 28 week; anyone still alive shares the title. If every remaining picker goes out in the same week, all play one more week (used teams stay used); in the last week they share instead. A lone picker is never resurrected. A picker with no sheet in a Survivor's first week is out of it, and resurrection does not bring them back (`survLate`).
- Robo-Sharp (🤖, black and silver): model side in every game, field goal on biggest edge, betting total as tiebreaker, biggest unused edge in Survivor. Shows in standings with no rank and never wins a week, trophy, Survivor, or the season; the best picker wins instead.
- People are "pickers". Tabs: Picks, Standings, Recap, Survivor, Pickers, Teams, Playoffs, Rules, Profile, Commish. The public log never shows the commissioner's private nickname for a picker.
- 2026 is a free test season: no buy-ins, no payouts. Weeks, standings, and titles still count. Payouts start in 2027, and the Rules page shows them as hypothetical so pickers can try scenarios and give feedback.
- Money is off the site; the Rules page only posts the plan. Payouts are shares of the pot (Stay Engaged): season 20 / 10 / 5, weekly 1% each, Conference Champion Week 6%, Survivor 5% a run, Bowl 10 / 5, CFP 10 / 5. The buy-in is not set. Bowls are a separate contest.
- No test weeks (decided Oct 31). Week 9 counts as the first week; every revealed week counts toward the season. Weeks keep their real numbers (next is Week 10). The old `scored` flag is ignored and new weeks save `scored: true`.

## CFP field rules (2026 season, checked Nov 4)
Sources: collegefootballplayoff.com 12 team format page, NCAA.com bracket article of Nov 3, Sports Illustrated on the Group of Six change.
- Field: 12 teams from the committee's final rankings, Sun Dec 6.
- Automatic bids: the ACC, Big Ten, Big 12, and SEC champions, plus the highest ranked team from the Group of Six (AAC, Conference USA, MAC, Mountain West, Pac-12, Sun Belt). That team does not have to be a champion.
- Notre Dame is in if it finishes in the top 12.
- At-large: the highest ranked other teams fill the field to 12.
- Seeding: straight by committee rank among the 12. A low ranked automatic bid drops to the bottom seeds. No conference champion byes.
- Byes: seeds 1 to 4, the four highest ranked teams in the field, whether or not they are champions.
- First round: No. 12 at No. 5, No. 11 at No. 6, No. 10 at No. 7, No. 9 at No. 8. The higher seed hosts, on campus or at a site it names. Dec 18 and 19.
- Quarterfinals: No. 1 plays the 8/9 winner, No. 2 the 7/10 winner, No. 3 the 6/11 winner, No. 4 the 5/12 winner. No reseeding. No changes to avoid rematches or teams from the same conference. Seeds pick bowls in order, 1 first and 4 last. Fiesta Dec 30; Cotton, Peach, and Rose Jan 1.
- Semifinals: Orange Jan 14, Sugar Jan 15. Title: Mon Jan 25, Allegiant Stadium, Las Vegas.
- Prototype assumption: the highest ranked team in each conference is its champion. Benton may change this later. `cfpField()` reads the CFP list in rankings and conferences from the ATS list, so it updates with each committee release. It shows a warning for a ranked team with no conference, or a missing automatic bid.

## Idea tracker
The landing spot for every idea not yet ready to build, for any timing: this season, this postseason, next season, or later. Add new ideas here as Benton names them. Build nothing here until he says it is ready. Timing heading = his target.

Changelog rule: `CHANGELOG.md` lists everything shipped, with date, effort, and commit. When a tracker item ships, remove it from the tracker and add its row in the same push. Add a row for any other app change too. A row can name its commit only after the commit exists, so add it as a second commit before pushing.

Conflict rule: if a request conflicts with a tracker item, stop before building and check with Benton in one line: this differs from the tracker, go ahead and update the tracker, or pause and review what was discussed. Quote the tracker line. Build nothing until he answers. This is the one case where a reply may end with a question.

Rules page rule: every change that affects how the league plays, scores, or pays must update the Rules page in the same build. No such item is done until the Rules text matches. Items that need it: 1, 2, 3, 4, 8, 10. Add Bowl and CFP rules to the Payouts section if their prizes change.

### This season and postseason (target, not started)
1. Conference Champion Week: the final week of the regular challenge. 2026: all 10 title games, 5 on Fri Dec 4 and 5 on Sat Dec 5.
   - Lock before the first Friday kickoff (about 6 p.m. CT), one lock for the week. The normal slate rule and the Saturday 10:15 a.m. lock do not apply.
   - No Survivor pick this week. Survivor already ends after the Nov 28 week.
   - The build must save `confChamp: true` on this week. Career stats, Weekly titles, the recap, and the Rules page already read it or describe it.
   - To settle: how the week builds if ESPN's week number or season type differs.
2. CFP bracket challenge: a bracket, not ATS. 12 teams. Selection Sun Dec 6, first game Fri Dec 18, title Mon Jan 25.
   - Illustrative version live Nov 4: Playoffs tab, every login, for fun, with team swaps. See the CFP field rules. Picks stay on each device and nothing counts. Still to build for the real contest: server saved brackets, the lock, standings, scoring, results, and Rules text. When the field is set Dec 6, the for fun wording and swaps need a decision.
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
   - ATS, the same as 2027 (item 4).
   - Conference lock, a test for this run. Picking a team burns its conference for the run. Only the picked team's conference burns, so in a nonconference game the other team's conference stays available. Burned conferences start empty at the run's start.
   - The no-repeat team rule goes away for this run, since a burned conference already blocks the team.
   - Independents count as one group, so picking Notre Dame burns Independents.
   - If no legal game is left on the slate, the picker can pick any game, including a team already used.
   - Everyone starts the run alive, including pickers already out. A picker who joins after the run's first week and misses it is out of that run.
   - Build it all together: the second run, the conference lock, and the Rules text, in one build. The first run keeps the no-repeat team rule through Nov 7. The server must enforce the lock, as it does used teams today, and Robo-Sharp's Survivor pick must follow it.
   - Build note: the app handles one run today (`survivorStart`, `survivorEnd`, `survLate`). Career stats count one Survivor win a season. Item 4 needs runs too, so this work carries into 2027. A change needs the Rules page in the same build.

### Next season (2027)
4. Survivor: ATS, fixed runs. Decided: Survivor stays against the spread in 2026 and 2027. Replaces the two skulls idea, which is dropped.
   - Conference lock is being tested in the 2026 second run (item 10). Decide after that run whether it stays for 2027.
   - Pick one team against the spread. One loss and you are out of that run. The conflict warning stays.
   - The season has fixed runs, for example weeks 1 to 5, 6 to 10, and 11 to the last week before Conference Champion Week. Everybody starts each run alive, and used teams reset.
   - No tiebreaker. Everyone still alive at the end of a run wins it. Pickers who split a win are each called Co-Champion and each gets the win on their stats page.
   - If every remaining picker goes out in the same week, they are all resurrected and play one more week. If that was the last week of the run or season, they share the title as Co-Champions instead.
   - Robo-Sharp keeps picking by spread edge.
   - To settle: exact run weeks.
8. Ghost pickers: an unpaid tier so someone can try the league with no skin in the game and no effect on anyone else.
   - Paid members play every contest and can win payouts. The commissioner creates every ghost and gives the PIN, the same as any picker, and can flip the profile to paid. No open signups.
   - Ghosts play shadow versions of Survivor, the Bowl challenge, and the CFP bracket.
   - A ghost's history does not carry over on going paid; they start a new paid profile. Switching back and forth loses paid history. Pickers must keep paying each year to keep their history, or they restart.
   - Ghosts see paid pickers, the standings, and where they would rank each week, including whether they would have won. They cannot win a week, earn accomplishments, or count in any payout.
   - Paid pickers cannot see ghosts. Ghosts cannot see each other.
   - Build note: this must be filtered on the server, not hidden on the page, since `/api/state` sends players and reveals to every login. Ghosts must stay out of standings, split bars, sheet counts, the public log, and weekly winners.
Buy-in amount for 2027 is not set.

### Engagement review (Nov 2): Benton's calls
Design rule: this league is for people who care enough to check it without prompting. Benton sends no mass messages and follows up one person at a time by text if he wants. There is no group chat to count on. Nothing here may depend on outside prompting. Pickers who lose interest are allowed to drop off.
Keep the weekly rhythm, Picks, Recap, Survivor, weekly titles, and Robo-Sharp as they are. Fixed times are the habit: Mon preview, Wed 6 p.m. live, Sat 10:15 a.m. lock, Sunday recap.

Separate task, to investigate:
21. Backup options in case of failure. Benton wants this looked at on its own. Cover what happens if Vercel pauses the site, Neon suspends or loses data, or ESPN blocks the app, and what backups or fallback hosting would get the league running again. Investigate only, nothing built yet.

Ideas to shape later, not approved:
19. Your season recap replaces the Recap for everyone, personal to each picker. The league-wide stats move to a new area, maybe called the Record Book. Benton's idea, wording "maybe". To settle: how it fits with the current Recap, and when in the season it runs.
20. For 2027, to review: add to home screen prompt, web push (not verified), accomplishments, and a 4 week fresh start contest if the season race goes stale.
24. Model disagreement: flag teams where SP+, FPI, and VSiN differ most. Data already stored. Claude's pick of this group.
25. Edge alerts: highlight games where the model and the line differ by 3 or more points. Data already stored. Robo-Sharp's line shows today, but nothing stands out.
26. Record vs. ranked teams: add each team's record against AP-ranked opponents to the Teams tab. Data already stored.
27. Rating trends: show a team's SP+ rank across the season. Weekly snapshots are saved, but they only feed movement arrows today.
28. Consensus model line: average VSiN with an SP+ implied line, so one source does not drive Robo-Sharp. Needs a sourced home field value. Low value.
29. Bad beat note: mark a half-point loss on the game card. Data already stored. Low value, since Pickers stats already count bad beats.
30. Page visit runs: after a clean Saturday with the switch on, consider a 5 minute gap and a daily cap of 160. ESPN publishes no limit, so the cap is a judgment call.
Left out on purpose: a field goal animation, too much work for the gain.

Thrown out: 12 (group text kit). Benton will not send mass messages.
Thrown out: 5 (upkeep share). No share of buy-ins, so the whole pot pays out.
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
- Undecided: move the NFL lock to Saturday 10:15 a.m. CT, one deadline for both sports.

## Open items
- Late Saturday games: the ATS job reads ESPN's scoreboard with no date, so a late game could be missed if ESPN rolls to the next week early. The Sunday recheck should fill the game log, but it may not correct the ATS record. Not fixed.
- The four old Claude-artifact scheduled tasks are paused and stay paused at Benton's call (Nov 4). They only touched the retired page.
