import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tool TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  cost INTEGER NOT NULL,
  status TEXT NOT NULL,              -- queued | done | failed
  model TEXT,
  request_id TEXT,
  response_url TEXT,
  status_url TEXT,
  result_url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, id DESC);
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Миграции для баз, созданных предыдущей версией
const addColumn = (table, col, def) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn('users', 'referrer_id', 'INTEGER');
addColumn('users', 'ref_earned', 'INTEGER NOT NULL DEFAULT 0');
addColumn('jobs', 'fal_usd', 'REAL NOT NULL DEFAULT 0');

const now = () => Date.now();

// referrerId учитывается только при первой регистрации и если пригласивший существует
export function upsertUser(u, bonus, referrerId) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  if (existing) {
    db.prepare('UPDATE users SET username = ?, first_name = ? WHERE id = ?')
      .run(u.username || null, u.first_name || null, u.id);
    return { ...existing, username: u.username, first_name: u.first_name };
  }
  const ref = referrerId && referrerId !== u.id && getUser(referrerId) ? referrerId : null;
  db.prepare('INSERT INTO users (id, username, first_name, balance, referrer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.id, u.username || null, u.first_name || null, bonus, ref, now());
  return getUser(u.id);
}

export const refStats = (userId) => db.prepare(`
  SELECT COUNT(*) AS invited,
         COALESCE(SUM(EXISTS(SELECT 1 FROM payments p WHERE p.user_id = u.id)), 0) AS paying
  FROM users u WHERE referrer_id = ?`).get(userId);

// Сводка для владельца бота
export function stats() {
  const day = Date.now() - 24 * 3600 * 1000;
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    users: q('SELECT COUNT(*) n FROM users').n,
    usersDay: q('SELECT COUNT(*) n FROM users WHERE created_at > ?', day).n,
    payers: q('SELECT COUNT(DISTINCT user_id) n FROM payments').n,
    stars: q('SELECT COALESCE(SUM(stars),0) n FROM payments').n,
    starsDay: q('SELECT COALESCE(SUM(stars),0) n FROM payments WHERE created_at > ?', day).n,
    jobs: q("SELECT COUNT(*) n FROM jobs WHERE status = 'done'").n,
    jobsDay: q("SELECT COUNT(*) n FROM jobs WHERE status = 'done' AND created_at > ?", day).n,
    falUsd: q("SELECT COALESCE(SUM(fal_usd),0) n FROM jobs WHERE status = 'done'").n,
    falUsdDay: q("SELECT COALESCE(SUM(fal_usd),0) n FROM jobs WHERE status = 'done' AND created_at > ?", day).n,
    refPaid: q('SELECT COALESCE(SUM(ref_earned),0) n FROM users').n,
  };
}

export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

export function addBalance(userId, amount) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
}

// Списывает монеты атомарно; false — если не хватает
export function chargeBalance(userId, amount) {
  const r = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?')
    .run(amount, userId, amount);
  return r.changes === 1;
}

// Зачисляет покупку и реферальный бонус пригласившему. Возвращает { referrerId, bonus } или null при дубле.
export const recordPayment = db.transaction((chargeId, userId, stars, credits, refPercent) => {
  const r = db.prepare('INSERT OR IGNORE INTO payments (charge_id, user_id, stars, credits, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(chargeId, userId, stars, credits, now());
  if (!r.changes) return null;
  addBalance(userId, credits);
  const referrerId = getUser(userId)?.referrer_id;
  const bonus = referrerId ? Math.floor((credits * refPercent) / 100) : 0;
  if (bonus > 0) {
    db.prepare('UPDATE users SET balance = balance + ?, ref_earned = ref_earned + ? WHERE id = ?').run(bonus, bonus, referrerId);
  }
  return { referrerId, bonus };
});

export function createJob(j) {
  const t = now();
  const r = db.prepare(`INSERT INTO jobs (user_id, tool, title, kind, cost, status, model, fal_usd, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`).run(j.userId, j.tool, j.title, j.kind, j.cost, j.model, j.falUsd || 0, t, t);
  return r.lastInsertRowid;
}

export function updateJob(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...fields, updated_at: now(), id });
}

export const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
export const userJobs = (userId) =>
  db.prepare('SELECT id, tool, title, kind, cost, status, result_url, error, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(userId);
export const pendingJobs = () =>
  db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND request_id IS NOT NULL").all();
