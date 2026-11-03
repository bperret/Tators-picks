# Tator's Picks: changelog

Every shipped feature and fix, newest first. Ideas not built yet are in the Idea tracker in `CLAUDE.md`. When an item ships, it moves from the tracker to here.

**Times** are US Central, taken from git. **Commit** is the rollback point: `git revert <commit>` undoes that change.

**Version:** 1.x is a feature. 1.x.y is a fix or small polish.

**Effort** is lines of code changed, not hours or token cost:
- S: under 50 lines
- M: 50 to 299 lines
- L: 300 lines or more

## Shipped

| Version | Date | Area | Change | Effort | Lines | Commit |
|---|---|---|---|---|---|---|
| 1.22.1 | Nov 2, 7:13 p.m. | Commish | Removed the temporary Preview result animations section | S | 21 | `bb306a2` |
| 1.22 | Nov 2, 7:10 p.m. | Commish | Removed the sample data preview; added Preview result animations | S | 35 | `f4e2a28` |
| 1.21 | Nov 2, 6:55 p.m. | Pickers | Sample data preview for the commissioner | S | Shared, 135 | `aab0c2b` |
| 1.20 | Nov 2, 6:55 p.m. | Pickers | Personal insights: teams that hurt or helped, splits, streaks, bad beats | M | Shared, 135 | `aab0c2b` |
| 1.20 | Nov 2, 6:55 p.m. | Pickers | Career wins with Co-Champion credits | S | Shared, 135 | `aab0c2b` |
| 1.20 | Nov 2, 6:55 p.m. | Pickers | Past picks by week: results, margins, rank, tiebreaker, Survivor | M | Shared, 135 | `aab0c2b` |
| 1.20 | Nov 2, 6:55 p.m. | Standings | Beat the close table, with Robo-Sharp unranked | S | Shared, 135 | `aab0c2b` |
| 1.20 | Nov 2, 6:55 p.m. | League | Closing lines sent to the page for Beat the close | S | 29 | `7dc62ed` |
| 1.19.1 | Nov 2, 6:48 p.m. | Rules | Payouts marked hypothetical: 2026 is a free test season, payouts start in 2027 | S | 16 | `dee07e2` |
| 1.19 | Nov 2, 5:40 p.m. | Rules | Payouts section on the Rules page with pot shares and a what would I win calculator | M | 81 | `8e6a480` |
| 1.18 | Nov 2, 5:38 p.m. | Survivor | Resurrection: if everyone left goes out in one week, all play one more week | M | 76 | `6a9ca5f` |
| 1.17 | Nov 2, 5:36 p.m. | Survivor | Survivor ends after the Saturday Nov 28 week; everyone still alive shares the title | S | 45 | `b7ab293` |
| 1.16.1 | Nov 2, 5:30 p.m. | Recap | Centered the recap banner | S | 2 | `a59f0b2` |
| 1.16 | Nov 2, 5:02 p.m. | Recap | Recap tab with fun facts from each final week, plus a banner on Picks | M | 167 | `dcf35b7` |
| 1.15 | Nov 2, 4:59 p.m. | Picks | Result reveal: a card and flash the first time you see a game go final | M | 64 | `c92f86c` |
| 1.14 | Nov 2, 4:57 p.m. | Picks | Cover badges read from your side, green for your pick and red for the team beating it | S | 11 | `75376a7` |
| 1.13.1 | Nov 2, 9:09 a.m. | Automation | Slate build reads the week and season from the games when ESPN leaves them off | S | 24 | `633029f` |
| 1.13 | Nov 2, 8:58 a.m. | Automation | Update ratings button pulls SP+ from ESPN and VSiN from its weekly article, with checks before saving | M | 250 | `b0b4304` |
| 1.12.2 | Nov 2, 8:40 a.m. | Commish | Ratings-only paste merges SP+ or VSiN without touching polls or snapshots | S | 28 | `3b643a6` |
| 1.12.1 | Oct 31, 1:22 p.m. | Picks | Cover tiers read quarter and clock from ESPN's status text when the fields are missing | S | 17 | `db44829` |
| 1.12 | Oct 31, 1:13 p.m. | Picks | Games sort by kickoff after the lock, better AP game first at the same kickoff | S | Shared, 160 | `3ba36bb` |
| 1.12 | Oct 31, 1:13 p.m. | Picks | Robo-Sharp shows in the pick columns after the lock; model line hides | S | Shared, 160 | `3ba36bb` |
| 1.12 | Oct 31, 1:13 p.m. | Picks | Live cover tiers with percent and color | M | Shared, 160 | `3ba36bb` |
| 1.12 | Oct 31, 1:13 p.m. | Picks | Quarter and clock on live games, plus a Scores updated time | S | Shared, 160 | `3ba36bb` |
| 1.12 | Oct 31, 1:13 p.m. | Commish | Sections fold, with Expand all and Collapse all | S | Shared, 160 | `3ba36bb` |
| 1.12 | Oct 31, 1:13 p.m. | League | No test weeks: Week 9 is the first scored week, next is Week 10 | S | Shared, 160 | `3ba36bb` |
| 1.11 | Oct 31, 11:05 a.m. | Picks | Pickers show as two plain team columns; split bar gets a white divider | S | 18 | `be2153c`, `14ef8cc` |
| 1.10.2 | Oct 29, 5:28 p.m. | Automation | Benton's cron edit, after which the GitHub schedule started firing | S | 2 | `4c53d92` |
| 1.10.1 | Oct 29, 4:35 p.m. | Picks | Game cards a third shorter; sticky bar fits on one row | S | 27 | `35b42de`, `22625f9` |
| 1.10 | Oct 29, 3:44 p.m. | Profile | Auto, Light, and Dark choice | S | 19 | `22ac064` |
| 1.9.2 | Oct 29, 3:16 p.m. | Look | Centered header, tabs, and Survivor summary; stronger title | S | 11 | `d38d482` |
| 1.9.1 | Oct 29, 2:57 p.m. | League | Flag pick renamed field goal; Me tab renamed Profile | M | 74 | `1420d77` |
| 1.9 | Oct 29, 2:43 p.m. | Commish | Each picker's sheet status in League members | M | 54 | `ee19456` |
| 1.8 | Oct 29, 1:43 p.m. | Teams | Reorganized into Polls, Power, and ATS; added the r/CFB poll | L | 500 | `5404e5a`, `878b24d` |
| 1.7.1 | Oct 29, 1:11 p.m. | Automation | GitHub schedule runs twice an hour | S | 21 | `37d3d77` |
| 1.7 | Oct 29, 12:21 p.m. | Teams | Stats view from a team game log; old lines filled from ESPN's odds feed | L | 392 | `ff0d41f`, `7cd91ab` |
| 1.6 | Oct 29, 11:53 a.m. | Commish | Commissioner's nickname in League members | S | 33 | `22722b9` |
| 1.5 | Oct 29, 10:44 a.m. | Picks | Color-coded game slots; tiebreaker game and Survivor set apart | S | 26 | `a457d3e` |
| 1.4 | Oct 29, 10:36 a.m. | Look | UX pass from an outside review | L | 311 | `088ea95` |
| 1.3 | Oct 29, 10:23 a.m. | League | Robo-Sharp became a full entry that cannot win; new names hidden in the log | M | 64 | `2430e5e`, `57e0b42` |
| 1.2 | Oct 29, 9:48 a.m. | Commish | Lock picks early and unlock | M | 67 | `41ff189` |
| 1.1 | Oct 29, 9:43 a.m. | Automation | Weekly jobs with manual fallbacks and failure flags | L | 1,106 | `57c45b0` |
| 1.0 | Oct 29, 9:00 a.m. | League | First site on Vercel: logins, picks with a server lock, standings, commissioner tools | L | 2,072 | `2f74435` |

## Notes and planning (no app change)

| Date | Change | Commit |
|---|---|---|
| Nov 2 | Idea tracker created, then built out with timing and the Rules page rule | `86e8325` through `85522d0` |
| Oct 31 | NFL plan recorded; Open items heading restored | `9d583f4`, `4dd2e20` |
| Oct 29 | Working schedule noted; Claude kept out of the workflow file | `d7ac7fe` |
| Oct 29 | Note that the old-line fill worked live | `03373ff` |

## Before the repo

Oct 28 to 29: Tator's Picks began as a Claude artifact page, with a separate demo. It has no git history. The artifacts are retired.
