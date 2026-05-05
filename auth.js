// Kanboard Whiteboard — Auth Module
// SQLite-backed magic link auth + session management

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'board.db');

let db;

function init() {
  const fs = require('fs');
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Users table — maps to Kanboard user IDs
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kanboard_user_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',  -- 'admin' or 'user'
      allowed_projects TEXT NOT NULL DEFAULT '[]',  -- JSON array of project IDs
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Magic links table
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      label TEXT  -- e.g. "Site tablet", "Office TV"
    )
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      user_agent TEXT
    )
  `);

  // Activity log
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed default users if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    seedDefaults();
  }
}

function seedDefaults() {
  const insert = db.prepare(
    'INSERT INTO users (kanboard_user_id, name, role, allowed_projects) VALUES (?, ?, ?, ?)'
  );
  insert.run(1, 'Admin', 'admin', JSON.stringify([1]));
}

// ===== MAGIC LINKS =====
function createMagicLink(userId, label, expiryDays = 30) {
  const token = uuidv4();
  // 0 = never expires (100 years)
  const actualDays = expiryDays === 0 ? 36500 : expiryDays;
  const expiresAt = new Date(Date.now() + actualDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO magic_links (token, user_id, expires_at, label) VALUES (?, ?, ?, ?)'
  ).run(token, userId, expiresAt, label || null);

  logActivity(null, 'magic_link_created', `User ${userId}, label: ${label}, expires: ${expiresAt}`);
  return { token, expiresAt };
}

function validateMagicLink(token) {
  const link = db.prepare(`
    SELECT ml.*, u.kanboard_user_id, u.name, u.role, u.allowed_projects, u.is_active
    FROM magic_links ml
    JOIN users u ON u.id = ml.user_id
    WHERE ml.token = ? AND ml.used_at IS NULL AND ml.expires_at > datetime('now')
    AND u.is_active = 1
  `).get(token);

  return link || null;
}

function consumeMagicLink(token) {
  db.prepare('UPDATE magic_links SET used_at = datetime(\'now\') WHERE token = ?').run(token);
}

function revokeMagicLink(linkId) {
  db.prepare('UPDATE magic_links SET expires_at = datetime(\'now\') WHERE id = ?').run(linkId);
}

// ===== SESSIONS =====
function createSession(userId, userAgent, expiryDays = 30) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)'
  ).run(token, userId, expiresAt, userAgent || null);

  // Update user last_active
  db.prepare('UPDATE users SET last_active = datetime(\'now\') WHERE id = ?').run(userId);

  logActivity(userId, 'session_created', userAgent);
  return { token, expiresAt };
}

function validateSession(token) {
  if (!token) return null;

  const session = db.prepare(`
    SELECT s.*, u.kanboard_user_id, u.name, u.role, u.allowed_projects, u.is_active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(token);

  if (session) {
    // Touch last_active
    db.prepare('UPDATE sessions SET last_active = datetime(\'now\') WHERE id = ?').run(session.id);
    db.prepare('UPDATE users SET last_active = datetime(\'now\') WHERE id = ?').run(session.user_id);
  }

  return session || null;
}

function revokeSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ===== USERS =====
function getUsers() {
  return db.prepare('SELECT * FROM users ORDER BY name').all();
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByKanboardId(kanboardId) {
  return db.prepare('SELECT * FROM users WHERE kanboard_user_id = ?').get(kanboardId);
}

function createUser(kanboardUserId, name, role, allowedProjects) {
  const result = db.prepare(
    'INSERT INTO users (kanboard_user_id, name, role, allowed_projects) VALUES (?, ?, ?, ?)'
  ).run(kanboardUserId, name, role || 'user', JSON.stringify(allowedProjects || [5]));
  logActivity(null, 'user_created', `${name} (kanboard: ${kanboardUserId})`);
  return result.lastInsertRowid;
}

function updateUser(id, fields) {
  const allowed = ['name', 'role', 'allowed_projects', 'is_active'];
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      values.push(typeof v === 'object' ? JSON.stringify(v) : v);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// ===== ADMIN =====
function getMagicLinks() {
  return db.prepare(`
    SELECT ml.*, u.name as user_name
    FROM magic_links ml
    JOIN users u ON u.id = ml.user_id
    ORDER BY ml.created_at DESC
  `).all();
}

function getSessions() {
  return db.prepare(`
    SELECT s.*, u.name as user_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.last_active DESC
  `).all();
}

function getActivityLog(limit = 50) {
  return db.prepare(`
    SELECT al.*, u.name as user_name
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(limit);
}

// ===== PREFS =====
function getUserPrefs(kanboardUserId) {
  const row = db.prepare('SELECT * FROM users WHERE kanboard_user_id = ?').get(kanboardUserId);
  if (!row) return null;
  // Check for prefs column
  try {
    const prefs = db.prepare('SELECT prefs FROM users WHERE kanboard_user_id = ?').get(kanboardUserId);
    return prefs ? JSON.parse(prefs.prefs || '{}') : {};
  } catch {
    return {};
  }
}

function saveUserPrefs(kanboardUserId, prefs) {
  try {
    db.prepare('UPDATE users SET prefs = ? WHERE kanboard_user_id = ?')
      .run(JSON.stringify(prefs), kanboardUserId);
  } catch {
    // Prefs column might not exist — add it
    try {
      db.exec('ALTER TABLE users ADD COLUMN prefs TEXT DEFAULT \'{}\'');
      db.prepare('UPDATE users SET prefs = ? WHERE kanboard_user_id = ?')
        .run(JSON.stringify(prefs), kanboardUserId);
    } catch (e) {
      console.warn('Failed to save prefs:', e.message);
    }
  }
}

// ===== ACTIVITY LOG =====
function logActivity(userId, action, detail) {
  db.prepare(
    'INSERT INTO activity_log (user_id, action, detail) VALUES (?, ?, ?)'
  ).run(userId, action, detail || null);
}

// ===== COOKIE HELPERS =====
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [key, ...val] = c.trim().split('=');
    if (key) cookies[key] = val.join('=');
  });
  return cookies;
}

function sessionCookie(token, maxAgeDays = 30) {
  return `kw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}`;
}

function clearSessionCookie() {
  return 'kw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

module.exports = {
  init,
  createMagicLink,
  validateMagicLink,
  consumeMagicLink,
  revokeMagicLink,
  createSession,
  validateSession,
  revokeSession,
  getUsers,
  getUser,
  getUserByKanboardId,
  createUser,
  updateUser,
  getMagicLinks,
  getSessions,
  getActivityLog,
  getUserPrefs,
  saveUserPrefs,
  logActivity,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
};
