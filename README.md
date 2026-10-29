# Tator's Picks

College football pick em against the spread for one league. Ten games a week, a 3x flag pick, a tiebreaker, Survivor, and Robo-Sharp, the computer player.

## How it runs

* `public/index.html` is the whole app page.
* `api/` holds five Vercel functions: `state`, `auth`, `picks`, `admin`, and `cron`.
* Data lives in Neon Postgres. Tables are created on the first request.
* The server clock enforces the lock. Any pick saved at or after a week's deadline is refused.

## Setup

1. Import this repo into Vercel (framework preset: Other).
2. In the project's Storage tab, add Neon Postgres and connect it. Vercel adds `DATABASE_URL`.
3. In Settings, Environment Variables, add:
   * `SESSION_SECRET`: a random string of 48 or more characters. Keeps players signed in.
   * `SETUP_CODE`: a one-time code. Enter it on the site's first visit to create the commissioner account.
   * `CRON_SECRET`: a random string of 16 or more characters. Lets the schedule run the weekly jobs.
4. Redeploy, open the site, and enter the setup code with your cell number.
5. In GitHub, Settings, Secrets and variables, Actions, add two repository secrets:
   * `SITE_URL`: the site's address, for example `https://tators-picks.vercel.app`.
   * `CRON_SECRET`: the same value as in Vercel.

## Weekly automation

GitHub Actions (`.github/workflows/automation.yml`) calls `/api/cron` every hour. Vercel's daily cron calls it once a day as a backup. The site decides what is due:

| When (Central) | Job | Manual fallback in the Commissioner tab |
|---|---|---|
| Tue 1 p.m. to Fri | Build the coming Saturday's slate from ESPN as a draft | Build from ESPN, or Load a slate |
| Wed 6 p.m. | Open picks, unless turned off or moved back to draft | Open picks |
| After the lock | Pull scores hourly, mark the week final when every game is final or void | Pull scores now, Scores, Mark week final |
| Every 6 hours | AP, CFP, and FPI from ESPN | Refresh rankings, Update rankings |
| Every hour | Save lines before kickoff, add finished games to team ATS records | Update ATS |
| First run, then Sunday 9 a.m. | Fill the team game log for weeks 1 to now, then recheck the last two weeks | Fill game log |
| Every hour until done | Add lines and totals to logged games that lack them, from ESPN's per-game odds feed (100 games a run). Stops itself if the feed has no old lines. | Fill lines |

Any failed job becomes a flag in the Automation panel with the manual fallback. The panel also flags a missing `CRON_SECRET` and a schedule that has not run for three hours. GitHub turns off scheduled workflows in a public repo after 60 days with no repo activity; the stale flag catches that.

Rules the automation keeps:

* Scores entered by hand are never overwritten. Set a game back to ESPN to hand it back.
* A postponed or canceled game waits for the commissioner to void it.
* Moving a week back to draft stops the automatic open for that week. Reopening scoring stops the automatic final.
* Robo-Sharp's line is ESPN FPI's projected margin for each game. SP+ and VSiN stay as last loaded.
* The team game log keeps every finished FBS game: scores, the line saved before kickoff, and the total. The hourly ATS run adds games as they finish. Teams, Stats reads it from `/api/state?part=teams`, so the main state stays small. A hand-entered slate score shows in place of ESPN's.

ESPN's feeds are unofficial and can change without notice.

## Local test

```
npm install
SETUP_CODE=LOCALCODE npm test
```

`dev/auto-test.mjs` runs a full automated week against saved ESPN-shaped responses. `dev/test.mjs` runs the site on an in-memory Postgres and drives it in a headless browser.
