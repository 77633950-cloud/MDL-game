import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(path.join(dataDir, 'game.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_stars (
    user_id INTEGER NOT NULL,
    level_id TEXT NOT NULL,
    stars INTEGER NOT NULL DEFAULT 0,
    best_paid REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, level_id)
  );
  CREATE TABLE IF NOT EXISTS user_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    level_id TEXT NOT NULL,
    level_label TEXT NOT NULL,
    level_name TEXT NOT NULL,
    stars INTEGER NOT NULL,
    paid REAL NOT NULL,
    subtotal REAL NOT NULL,
    discount_rate REAL NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );
  CREATE TABLE IF NOT EXISTS user_checkins (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS user_shares (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    store_code TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash, salt, coins, created_at) VALUES (?, ?, ?, 0, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  sessionByToken: db.prepare('SELECT token, user_id FROM sessions WHERE token = ? AND expires_at > ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  stars: db.prepare('SELECT level_id, stars, best_paid FROM user_stars WHERE user_id = ?'),
  starOne: db.prepare('SELECT stars FROM user_stars WHERE user_id = ? AND level_id = ?'),
  upsertStar: db.prepare(`
    INSERT INTO user_stars (user_id, level_id, stars, best_paid, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, level_id) DO UPDATE SET
      stars = excluded.stars,
      best_paid = COALESCE(excluded.best_paid, user_stars.best_paid),
      updated_at = excluded.updated_at
  `),
  updateBest: db.prepare('UPDATE user_stars SET best_paid = ?, updated_at = ? WHERE user_id = ? AND level_id = ?'),
  addCoins: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
  spendCoins: db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?'),
  addHistory: db.prepare(`
    INSERT INTO user_history (user_id, level_id, level_label, level_name, stars, paid, subtotal, discount_rate, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  history: db.prepare('SELECT * FROM user_history WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
  achievements: db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?'),
  addAchievement: db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)'),
  checkinDay: db.prepare('SELECT day FROM user_checkins WHERE user_id = ? ORDER BY day DESC LIMIT 1'),
  checkin: db.prepare('INSERT OR IGNORE INTO user_checkins (user_id, day) VALUES (?, ?)'),
  share: db.prepare('SELECT count FROM user_shares WHERE user_id = ? AND day = ?'),
  addShare: db.prepare(`
    INSERT INTO user_shares (user_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1
  `),
  settings: db.prepare('SELECT store_code FROM user_settings WHERE user_id = ?'),
  saveSettings: db.prepare(`
    INSERT INTO user_settings (user_id, store_code, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET store_code = excluded.store_code, updated_at = excluded.updated_at
  `)
}

export const todayKey = () => new Date().toLocaleDateString('sv-SE')

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') }
}

function verifyPassword(password, salt, hash) {
  const next = scryptSync(password, salt, 64)
  const prev = Buffer.from(hash, 'hex')
  return prev.length === next.length && timingSafeEqual(prev, next)
}

export function validateAccount(username, password) {
  if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(username || '')) return '用户名需 2-20 位，支持中文、字母、数字、下划线'
  if (typeof password !== 'string' || password.length < 6) return '密码至少 6 位'
  if (password.length > 64) return '密码过长'
  return null
}

function issueToken(userId) {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  const now = Date.now()
  q.insertSession.run(token, userId, now + 1000 * 60 * 60 * 24 * 30, new Date(now).toISOString())
  return token
}

export function register(username, password) {
  if (q.userByName.get(username)) return { error: '这个用户名已经被注册了' }
  const { salt, hash } = hashPassword(password)
  const result = q.insertUser.run(username, hash, salt, new Date().toISOString())
  const userId = Number(result.lastInsertRowid)
  return { token: issueToken(userId), userId }
}

export function login(username, password) {
  const user = q.userByName.get(username)
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return { error: '用户名或密码不正确' }
  }
  q.purgeSessions.run(Date.now())
  return { token: issueToken(user.id), userId: user.id }
}

export function logout(token) {
  q.deleteSession.run(token)
}

export function userByToken(token) {
  if (!token) return null
  const row = q.sessionByToken.get(token, Date.now())
  if (!row) return null
  return q.userById.get(row.user_id) || null
}

export function getProfileData(userId) {
  const user = q.userById.get(userId)
  if (!user) return null
  const stars = {}
  const bestPaid = {}
  for (const row of q.stars.all(userId)) {
    stars[row.level_id] = row.stars
    if (row.best_paid != null) bestPaid[row.level_id] = row.best_paid
  }
  return {
    user: { id: user.id, username: user.username, coins: user.coins, createdAt: user.created_at },
    stars,
    bestPaid,
    history: q.history.all(userId, 12),
    achievementIds: q.achievements.all(userId).map((row) => row.achievement_id),
    lastCheckin: q.checkinDay.get(userId)?.day || null,
    shareCount: q.share.get(userId, todayKey())?.count || 0
  }
}

export function getCoins(userId) {
  return q.userById.get(userId)?.coins ?? 0
}

export function addCoins(userId, amount) {
  if (amount) q.addCoins.run(amount, userId)
}

export function spendCoins(userId, amount) {
  return q.spendCoins.run(amount, userId, amount).changes > 0
}

export function setStar(userId, levelId, stars, bestPaid) {
  q.upsertStar.run(userId, levelId, stars, bestPaid ?? null, new Date().toISOString())
}

export function updateBest(userId, levelId, bestPaid) {
  q.updateBest.run(bestPaid ?? null, new Date().toISOString(), userId, levelId)
}

export function addHistory(userId, record) {
  q.addHistory.run(
    userId,
    record.levelId,
    record.levelLabel,
    record.levelName,
    record.stars,
    record.paid,
    record.subtotal,
    record.discountRate,
    new Date().toISOString()
  )
}

export function achievementIds(userId) {
  return q.achievements.all(userId).map((row) => row.achievement_id)
}

export function unlockAchievement(userId, achievementId) {
  q.addAchievement.run(userId, achievementId, new Date().toISOString())
}

export function checkin(userId) {
  const day = todayKey()
  const result = q.checkin.run(userId, day)
  return result.changes > 0 ? { ok: true, day } : { ok: false, day }
}

export function shareCountToday(userId) {
  return q.share.get(userId, todayKey())?.count || 0
}

export function addShare(userId) {
  q.addShare.run(userId, todayKey())
}

export function getStoreCode(userId) {
  return q.settings.get(userId)?.store_code || null
}

export function setStoreCode(userId, storeCode) {
  q.saveSettings.run(userId, storeCode, new Date().toISOString())
}
