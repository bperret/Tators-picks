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
| 1.36.1 | Nov 6, 8:30 AM | Army-Navy | Patriotic redesign: flag hero, new header order, halftime then final entry cards, Go Army and Go Navy, Salute to Service, Traditions. Bowl Blitz prototype marked done | M | 77 | COMMIT |
| 1.36.0 | Nov 6, 7:55 AM | Pickers | Class badges: Redshirt Class of 2026 or Class of 20XX under each profile name, plus a Classes section listing every class (item 33, part) | S | 51 | `90c07fa` |
| 1.35.4 | Nov 6, 6:55 AM | Bowl Blitz | Tab renamed from Bowl Season; each bowl gets an emoji and its own name color, readable in light and dark (items 37, 38) | S | 39 | `e1fb5bb` |
| 1.35.3 | Nov 6, 6:51 AM | Commish | Fix: Start over's first tap armed the button only until the next Commish redraw (every 30 seconds), so a slow second tap re-armed instead of wiping. The arm now lives in state for 30 seconds | S | 9 | `2e0817c` |
| 1.35.2 | Nov 6, 6:48 AM | Rules, Picks, Commish | Consistency pass: lock says most weeks Saturday 10:15 (Conference Champion Week Friday), a Survivor run is shared by everyone alive at its end, the Survivor pick box says once a run, the Remove note says removed pickers grey out with no points | S | 10 | `08335b0` |
| 1.35.1 | Nov 6, 6:41 AM | Commish | Start over on a removed picker (two taps): deletes picks, pick history, and engagement, clears the profile, signs them out, keeps phone and PIN so the walk-on runs again. Remove note now says Remove keeps data | S | 21 | `9a3db45` |
| 1.35 | Nov 6, 6:37 AM | Army-Navy, Picks, Bowl Season | Commissioner-only Army-Navy prototype tab (final and halftime entry, checks, Before lock / Halftime / Final preview); red action dot on Picks until your sheet is saved; white "You have picked N of 10 bowls" toast | M | 137 | `f20ed86` |
| 1.34 | Nov 6, 6:19 AM | Bowl Season | Commissioner-only prototype tab: Bowl challenge with 35 sample bowls, pick 10, field goal, tiebreaker bowl, and a Before lock / After lock / Final preview; Army-Navy placeholder | M | 145 | `0e60275` |
| 1.33.1 | Nov 6, 6:27 AM | Sign in, Picks | Pick my own look is a full size gold button; the recap banner waits until a rookie's first save; late joiners get a Survivor bench card that explains the rules and why they sit the run out, with no pick box | S | 22 | `eb6d191` |
| 1.33 | Nov 5, 11:26 PM | Sign in, Picks, Commish | First login walk-on: Welcome card, jersey with a random look and Shuffle (name only required, PIN change moved to Profile), three swipe rules cards with Skip, rookie step list on Picks until the first save, You're on the roster flash with Redshirt Class of 2026, First login funnel in Engagement (item 36) | M | 164 | `b68172e` |
| 1.32.1 | Nov 5, 9:04 PM | Profile | Emoji quick row shuffles on each page load (item 32) | S | 15 | `e68d80f` |
| 1.32 | Nov 4, 9:24 PM | Standings | Season table lists only pickers with at least one game picked, including 0-0; new Pct column; tap Pts or Pct to sort, # stays the real rank | M | 54 | `354fb0e` |
| 1.31 | Nov 4, 7:49 PM | Commish, Picks | League members table with chips, search, open rows, and Add picker on top; Save button turns red on a change and green once saved | M | 120 | `4a4ad3e` |
| 1.30.1 | Nov 4, 6:36 PM | All tabs | Around the league tiles on every tab but Commish, with a Picks tile, new Playoffs line, and necktie on Profile | S | 40 | `6357b70` |
| 1.30 | Nov 4, 5:38 PM | Picks | Around the league: 8 turf green tiles at the bottom of Picks that link to the other tabs | S | 41 | `f9b40f4` |
| 1.29.1 | Nov 4, 11:37 a.m. | Rules | Contests still to come section; payouts at 13 weekly prizes, Army-Navy 1%, and 4 Survivor runs at 3.75%; calculator updated | M | 75 | `b4343cd` |
| 1.29 | Nov 4, 8:43 a.m. | Playoffs | Bracket renamed Playoffs and opened to every login as a for fun illustration; team swaps on each device | M | 80 | `c9643b6` |
| 1.28 | Nov 4, 8:21 a.m. | Bracket | CFP bracket prototype, commissioner only: field from current CFP rankings, tap to advance, picks saved per device | M | 140 | `efa83df` |
| 1.27.9 | Nov 4, 8:11 a.m. | Rules | Removed Upkeep from the payouts calculator; the whole pot pays out | S | 6 | `2fa0fe2` |
| 1.27.8 | Nov 3, 12:33 p.m. | Picks | Line moved tags compare to the first preview line, not the last | S | 9 | `ffa7494` |
| 1.27.7 | Nov 3, 12:18 p.m. | Commish | Engagement view: last seen, sheet time, Recap reads, days, and tabs, commissioner only | M | Shared, 431 | `3e6c438` |
| 1.27.6 | Nov 3, 12:18 p.m. | Stats | Iron Man status, full season accomplishment, and Rules text | M | Shared, 431 | `3e6c438` |
| 1.27.5 | Nov 3, 12:18 p.m. | Recap | Your week: record, best pick, worst beat, and rank move at the top of the Recap | M | Shared, 431 | `3e6c438` |
| 1.27.4 | Nov 3, 12:18 p.m. | Picks | Weekly rival on Picks, the Recap, and Head to head, plus the live What you need line | M | Shared, 431 | `3e6c438` |
| 1.27.3 | Nov 3, 12:18 p.m. | Automation | Page visits can run overdue scores and the Wednesday open, behind a switch that starts off, with a gap, a daily cap, and a stop on 403 or 429 | M | Shared, 431 | `3e6c438` |
| 1.27.2 | Nov 3, 12:18 p.m. | Picks | Line moved tags while picks are open | S | Shared, 431 | `3e6c438` |
| 1.27.1 | Nov 3, 12:18 p.m. | Commish | Job messages: past tense with the week named, Nothing to do for idle runs, partial rankings results, Fill lines retry, true schedule wording, and a 12 hour stale flag | M | Shared, 431 | `3e6c438` |
| 1.27 | Nov 3, 12:18 p.m. | Picks | No Survivor chip for pickers who are out | S | Shared, 431 | `3e6c438` |
| 1.26.3 | Nov 2, 8:39 p.m. | Survivor | Late pickers who miss the first week show as out, with no resurrection; no missing-pick warning once out | S | 37 | `923072b` |
| 1.26.2 | Nov 2, 8:04 p.m. | Standings | Removed the Referee Report; the Recap replaces it | S | 26 | `9652562` |
| 1.26.1 | Nov 2, 8:00 p.m. | Picks | Commissioner sees the picker preview above his draft; clearer Build preview message | S | 16 | `86548b8` |
| 1.26 | Nov 2, 7:51 p.m. | Picks | Picks are live alert: flash and card once a week, skipped if your sheet is in | S | Shared, 289 | `d83b582` |
| 1.25 | Nov 2, 7:51 p.m. | Picks | Preview slate: likely games and current lines with no picks allowed, Monday through the open | M | Shared, 289 | `d83b582` |
| 1.24 | Nov 2, 7:51 p.m. | Automation | Refresh lines button; lines refresh when picks open and are final after that; Build preview and Open picks buttons in Automation | M | Shared, 289 | `d83b582` |
| 1.23 | Nov 2, 7:23 p.m. | Rules | Conference Champion Week: separate career stat and clearer Rules; points still count for the season | S | 24 | `d18f67d` |
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
| Nov 4 | Item 32 added to the tracker: shuffle the emoji quick row | `7f53972` |
| Nov 4 | Army-Navy contest added to the tracker; payouts planned at 13 weekly prizes and 14 weeks in all | `504ea5e` |
| Nov 4 | Survivor plan: second run moves to Nov 21 through Conference Champion Week; 4 runs in 2027 | `99bfc75` |
| Nov 4 | Tracker cleanup: checks cleared, ideas 24 to 30 added, Survivor stays ATS, upkeep thrown out | `c512e73` |
| Nov 2 | Idea tracker created, then built out with timing and the Rules page rule | `86e8325` through `85522d0` |
| Oct 31 | NFL plan recorded; Open items heading restored | `9d583f4`, `4dd2e20` |
| Oct 29 | Working schedule noted; Claude kept out of the workflow file | `d7ac7fe` |
| Oct 29 | Note that the old-line fill worked live | `03373ff` |

## Before the repo

Oct 28 to 29: Tator's Picks began as a Claude artifact page, with a separate demo. It has no git history. The artifacts are retired.
