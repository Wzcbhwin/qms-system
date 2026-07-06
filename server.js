/**
 * QMS 后端服务器 — Express + SQLite
 * 提供问题、用户、拖期消除数据的 CRUD API
 */
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ── 中间件 ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' })); // 支持大体积 base64 图片
app.use(express.static(__dirname, {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ── 数据库初始化 ───────────────────────────────────────
const db = new Database(path.join(__dirname, 'qms.db'));
db.pragma('journal_mode = WAL'); // 提升并发写入性能

db.exec(`
  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS dismissed_overdue (
    id TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS drafts (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    saved_at TEXT
  );
`);

// ── 默认用户初始化 ─────────────────────────────────────
function initDefaultUsers() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c > 0) return;

  const defaults = [
    { id: 'USR-ADMIN', name: '系统管理员', account: 'admin@dafor.com', phone: '13800000001', password: '123456', role: 'admin', unit: '', status: 'active', createdAt: '2026-01-01T00:00:00', remark: '默认管理员账号' },
    { id: 'USR-QUALITY', name: '张质量', account: 'quality@dafor.com', phone: '13800000002', password: '123456', role: 'quality', unit: '', status: 'active', createdAt: '2026-01-15T09:00:00', remark: '质量部门' },
    { id: 'USR-FORGE', name: '李锻造', account: 'forge@dafor.com', phone: '13800000003', password: '123456', role: 'responsible', unit: '大锻锻造车间', status: 'active', createdAt: '2026-02-01T09:00:00', remark: '锻造车间责任人' },
    { id: 'USR-TECH', name: '王技术', account: 'tech@dafor.com', phone: '13800000004', password: '123456', role: 'responsible', unit: '大锻技术中心', status: 'active', createdAt: '2026-02-01T09:00:00', remark: '技术中心责任人' },
    { id: 'USR-OUT', name: '赵外协', account: 'outsource@dafor.com', phone: '13800000005', password: '123456', role: 'responsible', unit: '外协机加工', status: 'active', createdAt: '2026-02-01T09:00:00', remark: '外协机加工责任人' },
    { id: 'USR-INIT', name: '孙检验员', account: 'jianyan@dafor.com', phone: '13800000006', password: '123456', role: 'initiator', unit: '大锻锻造车间', status: 'active', createdAt: '2026-03-01T09:00:00', remark: '锻造车间检验员' },
  ];

  const stmt = db.prepare('INSERT INTO users (id, data, created_at) VALUES (?, ?, ?)');
  defaults.forEach(u => {
    stmt.run(u.id, JSON.stringify(u), u.createdAt);
  });
  console.log(`[QMS] 已初始化 ${defaults.length} 个默认用户`);
}

initDefaultUsers();

// ═══════════════════════════════════════════════════════
// API 路由
// ═══════════════════════════════════════════════════════

// ── 问题 (Issues) ──────────────────────────────────────

// 获取所有问题
app.get('/api/issues', (req, res) => {
  const rows = db.prepare('SELECT data FROM issues ORDER BY rowid DESC').all();
  const issues = rows.map(r => JSON.parse(r.data));
  res.json({ success: true, data: issues });
});

// 获取单个问题
app.get('/api/issues/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM issues WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: '问题不存在' });
  res.json({ success: true, data: JSON.parse(row.data) });
});

// 新增问题
app.post('/api/issues', (req, res) => {
  const issue = req.body;
  const id = issue.id || 'QMS-' + Date.now().toString(36).toUpperCase();
  const now = new Date().toISOString();
  issue.id = id;
  issue.createdAt = issue.createdAt || now;
  issue.updatedAt = now;
  db.prepare('INSERT INTO issues (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(issue), issue.createdAt, issue.updatedAt);
  res.json({ success: true, data: issue });
});

// 更新问题（整体替换）
app.put('/api/issues/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT data FROM issues WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: '问题不存在' });
  const oldIssue = JSON.parse(existing.data);
  const patch = req.body;
  const updated = { ...oldIssue, ...patch, id, updatedAt: new Date().toISOString() };
  db.prepare('UPDATE issues SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(updated), updated.updatedAt, id);
  res.json({ success: true, data: updated });
});

// 删除问题
app.delete('/api/issues/:id', (req, res) => {
  const info = db.prepare('DELETE FROM issues WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ success: false, error: '问题不存在' });
  res.json({ success: true });
});

// 批量替换所有问题（用于初始化/重置）
app.put('/api/issues', (req, res) => {
  const issues = req.body;
  if (!Array.isArray(issues)) return res.status(400).json({ success: false, error: '需要数组' });
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM issues').run();
    const stmt = db.prepare('INSERT INTO issues (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)');
    issues.forEach(i => {
      i.updatedAt = i.updatedAt || new Date().toISOString();
      stmt.run(i.id, JSON.stringify(i), i.createdAt || i.updatedAt, i.updatedAt);
    });
  });
  txn();
  res.json({ success: true, count: issues.length });
});

// ── 用户 (Users) ───────────────────────────────────────

app.get('/api/users', (req, res) => {
  const rows = db.prepare('SELECT data FROM users').all();
  res.json({ success: true, data: rows.map(r => JSON.parse(r.data)) });
});

app.post('/api/users', (req, res) => {
  const u = req.body;
  const id = u.id || 'USR-' + Date.now().toString(36).toUpperCase().slice(-6);
  u.id = id;
  u.createdAt = u.createdAt || new Date().toISOString();
  u.status = u.status || 'active';
  try {
    db.prepare('INSERT INTO users (id, data, created_at) VALUES (?, ?, ?)').run(id, JSON.stringify(u), u.createdAt);
    res.json({ success: true, data: u });
  } catch (e) {
    res.status(400).json({ success: false, error: '账号已存在' });
  }
});

app.put('/api/users/:id', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT data FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: '用户不存在' });
  const oldUser = JSON.parse(row.data);
  const updated = { ...oldUser, ...req.body, id };
  db.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(updated), id);
  res.json({ success: true, data: updated });
});

app.delete('/api/users/:id', (req, res) => {
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true });
});

// ── 拖期消除 (Dismissed Overdue) ───────────────────────

app.get('/api/dismissed', (req, res) => {
  const rows = db.prepare('SELECT id FROM dismissed_overdue').all();
  res.json({ success: true, data: rows.map(r => r.id) });
});

app.post('/api/dismissed', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, error: '缺少 id' });
  db.prepare('INSERT OR IGNORE INTO dismissed_overdue (id) VALUES (?)').run(id);
  res.json({ success: true });
});

app.post('/api/dismissed/batch', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ success: false, error: '需要 id 数组' });
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM dismissed_overdue').run();
    const stmt = db.prepare('INSERT OR IGNORE INTO dismissed_overdue (id) VALUES (?)');
    ids.forEach(id => stmt.run(id));
  });
  txn();
  res.json({ success: true });
});

// ── 草稿 (Drafts) ──────────────────────────────────────

app.get('/api/draft', (req, res) => {
  const row = db.prepare('SELECT data FROM drafts WHERE key = ?').get('main');
  if (!row) return res.json({ success: true, data: null });
  res.json({ success: true, data: JSON.parse(row.data) });
});

app.post('/api/draft', (req, res) => {
  const data = JSON.stringify({ data: req.body, savedAt: new Date().toISOString() });
  db.prepare('INSERT OR REPLACE INTO drafts (key, data, saved_at) VALUES (?, ?, ?)').run('main', data, new Date().toISOString());
  res.json({ success: true });
});

app.delete('/api/draft', (req, res) => {
  db.prepare('DELETE FROM drafts WHERE key = ?').run('main');
  res.json({ success: true });
});

// ── 登录验证 ──────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { account, password } = req.body;
  if (!account || !password) return res.status(400).json({ success: false, error: '请输入账号和密码' });

  const rows = db.prepare('SELECT data FROM users').all();
  const users = rows.map(r => JSON.parse(r.data));

  // 支持邮箱或手机号登录
  const user = users.find(u =>
    (u.account === account.trim() || u.phone === account.trim()) &&
    u.password === password
  );

  if (!user) return res.status(401).json({ success: false, error: '账号或密码错误' });
  if (user.status === 'disabled') return res.status(403).json({ success: false, error: '该账号已被停用，请联系管理员' });

  // 返回用户信息（不含密码）
  const { password: _, ...safeUser } = user;
  res.json({ success: true, data: safeUser });
});

// ── 健康检查 ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const issueCount = db.prepare('SELECT COUNT(*) as c FROM issues').get().c;
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({ success: true, issues: issueCount, users: userCount, uptime: process.uptime() });
});

// ── 启动 ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[QMS] 服务器已启动: http://localhost:${PORT}`);
  console.log(`[QMS] API 文档: http://localhost:${PORT}/api/health`);
});
