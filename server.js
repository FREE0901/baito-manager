const express = require('express');
const session = require('express-session');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// DB初期化
const dbPath = path.join(__dirname, 'db', 'database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// 既存DBにカラムがなければ追加（マイグレーション）
const migrate = (table, column, def) => {
  try { db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get(); }
  catch { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); }
};
migrate('users', 'role', "TEXT DEFAULT 'admin'");
migrate('users', 'employee_id', 'INTEGER');
migrate('employees', 'transport_cost_per_day', 'INTEGER DEFAULT 0');
migrate('employees', 'transport_cost_monthly', 'INTEGER DEFAULT 0');
migrate('employees', 'transport_type', "TEXT DEFAULT 'daily'");
migrate('attendance', 'work_type', "TEXT DEFAULT 'office'");
migrate('payroll', 'office_days', 'INTEGER DEFAULT 0');
migrate('payroll', 'remote_days', 'INTEGER DEFAULT 0');
migrate('shifts', 'status', "TEXT DEFAULT 'confirmed'");
migrate('employees', 'contract_end_date', 'TEXT');
migrate('employees', 'paid_leave_days', 'REAL DEFAULT 0');
migrate('employees', 'memo', 'TEXT');
migrate('employees', 'contract_end_date', 'TEXT');
migrate('employees', 'tax_table', "TEXT DEFAULT '乙'");
migrate('employees', 'dependents', 'INTEGER DEFAULT 0');
migrate('users', 'must_change_password', 'INTEGER DEFAULT 0');

// shift_requests テーブルが無ければ作成
try { db.prepare('SELECT id FROM shift_requests LIMIT 1').get(); }
catch { db.exec(`CREATE TABLE IF NOT EXISTS shift_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  status TEXT DEFAULT 'pending', note TEXT, admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
)`); }

// 新テーブルの自動作成
const ensureTable = (name, ddl) => {
  try { db.prepare(`SELECT id FROM ${name} LIMIT 1`).get(); }
  catch { db.exec(ddl); }
};
ensureTable('payroll_allowances', `CREATE TABLE IF NOT EXISTS payroll_allowances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payroll_id INTEGER NOT NULL,
  name TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (payroll_id) REFERENCES payroll(id) ON DELETE CASCADE
)`);
ensureTable('announcements', `CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
)`);
ensureTable('paid_leaves', `CREATE TABLE IF NOT EXISTS paid_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  date TEXT NOT NULL, type TEXT DEFAULT 'paid', reason TEXT,
  status TEXT DEFAULT 'pending', admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
)`);
ensureTable('tasks', `CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER,
  title TEXT NOT NULL, description TEXT, due_date TEXT,
  priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
)`);
ensureTable('work_reports', `CREATE TABLE IF NOT EXISTS work_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  date TEXT NOT NULL, content TEXT NOT NULL, admin_comment TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
)`);
ensureTable('employee_default_deductions', `CREATE TABLE IF NOT EXISTS employee_default_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  name TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
)`);
ensureTable('payroll_deductions', `CREATE TABLE IF NOT EXISTS payroll_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payroll_id INTEGER NOT NULL,
  name TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (payroll_id) REFERENCES payroll(id) ON DELETE CASCADE
)`);

// タスク持ち越し用カラム
migrate('tasks', 'original_due_date', 'TEXT');
migrate('tasks', 'carried_count', 'INTEGER DEFAULT 0');

// 初期管理者アカウント作成（初回のみ）
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const initialPass = process.env.ADMIN_INITIAL_PASSWORD || 'admin';
  const hash = bcrypt.hashSync(initialPass, 10);
  db.prepare("INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, 'admin', 1)").run('admin', hash);
  console.log(`初期管理者アカウントを作成しました。ログイン後にパスワードを変更してください。`);
}

// ミドルウェア
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Railway等のリバースプロキシ環境でreq.secureを正しく判定するために必要
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  警告: SESSION_SECRET が未設定です。本番環境では必ず設定してください。');
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    // Railway環境ではsecureをfalseにする（CDNでTLS終端されるため）
    secure: false,
    sameSite: 'lax'
  }
}));

// CDN（Fastly/Railway edge）によるSet-Cookieヘッダー除去を防ぐ
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');  // Fastly向け
  res.setHeader('Vary', 'Cookie');
  next();
});

// DBをリクエストに渡す
app.use((req, res, next) => {
  req.db = db;
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(row => {
    settings[row.key] = row.value;
  });
  res.locals.settings = settings;
  // 未承認シフト希望の数（管理者向け）
  if (req.session.user && req.session.user.role === 'admin') {
    res.locals.pendingRequests = db.prepare("SELECT COUNT(*) as cnt FROM shift_requests WHERE status = 'pending'").get().cnt;
  } else {
    res.locals.pendingRequests = 0;
  }
  next();
});

// 認証チェック
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.redirect('/my');
  next();
}
function requireEmployee(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'employee') return res.redirect('/dashboard');
  next();
}

// 管理者ルート
app.use('/', require('./routes/auth'));
app.use('/dashboard', requireAdmin, require('./routes/dashboard'));
app.use('/employees', requireAdmin, require('./routes/employees'));
app.use('/shifts', requireAdmin, require('./routes/shifts'));
app.use('/attendance', requireAdmin, require('./routes/attendance'));
app.use('/payroll', requireAdmin, require('./routes/payroll'));
app.use('/settings', requireAdmin, require('./routes/settings'));
app.use('/announcements', requireAdmin, require('./routes/announcements'));
app.use('/leaves', requireAdmin, require('./routes/leaves'));
app.use('/tasks', requireAdmin, require('./routes/tasks'));
app.use('/reports', requireAdmin, require('./routes/reports'));
app.use('/export', requireAdmin, require('./routes/export'));

// バイト用ルート
app.use('/my', requireEmployee, require('./routes/my'));


app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'employee') return res.redirect('/my');
  res.redirect('/dashboard');
});

app.listen(PORT, () => {
  console.log(`アルバイト管理システム起動: http://localhost:${PORT}`);
  console.log('管理者ログイン: admin / admin');
});
