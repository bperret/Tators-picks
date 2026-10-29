// Database access. In production this talks to Neon Postgres over HTTP.
// Local tests inject an in-memory Postgres with setTestDb().
import { neon } from "@neondatabase/serverless";

let runner = null;
let ready = null;

export function setTestDb(fn) {
  runner = fn;
  ready = null;
}

function getRunner() {
  if (runner) return runner;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Connect a Neon database to this Vercel project.");
  const sql = neon(url);
  runner = (text, params) => sql.query(text, params);
  return runner;
}

const SCHEMA = [
  `create table if not exists players (
    id text primary key,
    phone text unique not null,
    pin_hash text not null,
    session_v integer not null default 1,
    name text not null default '',
    emoji text not null default '',
    c1 text not null default '',
    c2 text not null default '',
    invited text not null default '',
    is_commish boolean not null default false,
    setup_done boolean not null default false,
    removed boolean not null default false,
    fail_count integer not null default 0,
    locked_until timestamptz,
    lockouts integer not null default 0,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists kv (key text primary key, value jsonb not null)`,
  `create table if not exists weeks (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`,
  `create table if not exists picks (
    player_id text not null,
    week_id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (player_id, week_id)
  )`,
  `create table if not exists pick_history (
    id bigserial primary key,
    player_id text not null,
    week_id text not null,
    at timestamptz not null default now(),
    note text not null
  )`,
  `create table if not exists log (
    id bigserial primary key,
    at timestamptz not null default now(),
    by text not null,
    action text not null,
    detail text not null default ''
  )`,
  `create table if not exists snapshots (week_id text primary key, data jsonb not null)`,
];

async function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const run = getRunner();
      for (const stmt of SCHEMA) await run(stmt, []);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export async function q(text, params = []) {
  await ensureSchema();
  return getRunner()(text, params);
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

export async function getKv(key, fallback) {
  const row = await one("select value from kv where key = $1", [key]);
  return row ? row.value : fallback;
}

export async function setKv(key, value) {
  await q(
    "insert into kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
    [key, JSON.stringify(value)]
  );
}

export async function addLog(by, action, detail = "") {
  await q("insert into log (by, action, detail) values ($1, $2, $3)", [by, action, String(detail).slice(0, 500)]);
}
