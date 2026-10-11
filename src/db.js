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

const now = () => Date.now();

export function upsertUser(u, bonus) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  if (existing) {
    db.prepare('UPDATE users SET username = ?, first_name = ? WHERE id = ?')
      .run(u.username || null, u.first_name || null, u.id);
    return { ...existing, username: u.username, first_name: u.first_name };
  }
  db.prepare('INSERT INTO users (id, username, first_name, balance, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, u.username || null, u.first_name || null, bonus, now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
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

export const recordPayment = db.transaction((chargeId, userId, stars, credits) => {
  const r = db.prepare('INSERT OR IGNORE INTO payments VALUES (?, ?, ?, ?, ?)')
    .run(chargeId, userId, stars, credits, now());
  if (r.changes) addBalance(userId, credits);
  return r.changes === 1;
});

export function createJob(j) {
  const t = now();
  const r = db.prepare(`INSERT INTO jobs (user_id, tool, title, kind, cost, status, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`).run(j.userId, j.tool, j.title, j.kind, j.cost, j.model, t, t);
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
