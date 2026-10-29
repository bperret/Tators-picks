# Tator's Picks

College football pick em against the spread for one league. Ten games a week, a 3x flag pick, a tiebreaker, Survivor, and Robo-Sharp, the computer player.

## How it runs

* `public/index.html` is the whole app page.
* `api/` holds four Vercel functions: `state`, `auth`, `picks`, and `admin`.
* Data lives in Neon Postgres. Tables are created on the first request.
* The server clock enforces the lock. Any pick saved at or after a week's deadline is refused.

## Setup

1. Import this repo into Vercel (framework preset: Other).
2. In the project's Storage tab, add Neon Postgres and connect it. Vercel adds `DATABASE_URL`.
3. In Settings, Environment Variables, add:
   * `SESSION_SECRET`: a random string of 48 or more characters. Keeps players signed in.
   * `SETUP_CODE`: a one-time code. Enter it on the site's first visit to create the commissioner account.
4. Redeploy, open the site, and enter the setup code with your cell number.

## Weekly use (first milestone)

* Commissioner tab, Load a slate: paste the week's JSON. It loads as a draft.
* Review, then tap Open picks.
* Enter scores as games finish, then tap Mark week final.

## Local test

```
npm install
SETUP_CODE=LOCALCODE npm test
```

The test runs the site on an in-memory Postgres and drives it in a headless browser.
