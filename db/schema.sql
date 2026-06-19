CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  employee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_kana TEXT,
  gender TEXT,
  birth_date TEXT,
  address TEXT,
  phone TEXT,
  hourly_wage INTEGER NOT NULL DEFAULT 1200,
  hire_date TEXT,
  employment_type TEXT DEFAULT 'アルバイト',
  transport_cost_per_day INTEGER DEFAULT 0,
  transport_cost_monthly INTEGER DEFAULT 0,
  transport_type TEXT DEFAULT 'daily',
  contract_end_date TEXT,
  paid_leave_days REAL DEFAULT 0,
  memo TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS wage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  hourly_wage INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shift_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  note TEXT,
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  break_minutes INTEGER DEFAULT 0,
  overtime_minutes INTEGER DEFAULT 0,
  night_minutes INTEGER DEFAULT 0,
  work_type TEXT DEFAULT 'office',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  work_days INTEGER DEFAULT 0,
  work_hours REAL DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  night_hours REAL DEFAULT 0,
  office_days INTEGER DEFAULT 0,
  remote_days INTEGER DEFAULT 0,
  base_pay INTEGER DEFAULT 0,
  overtime_pay INTEGER DEFAULT 0,
  night_pay INTEGER DEFAULT 0,
  transport_cost INTEGER DEFAULT 0,
  gross_pay INTEGER DEFAULT 0,
  insurance INTEGER DEFAULT 0,
  income_tax INTEGER DEFAULT 0,
  other_deduction INTEGER DEFAULT 0,
  total_deduction INTEGER DEFAULT 0,
  net_pay INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE(employee_id, year, month)
);

CREATE TABLE IF NOT EXISTS payroll_allowances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (payroll_id) REFERENCES payroll(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS paid_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT DEFAULT 'paid',
  reason TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS work_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  admin_comment TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('business_name', 'WEB企画事務所FREE'),
  ('address', ''),
  ('closing_day', '末日'),
  ('pay_day', '翌月25日'),
  ('overtime_rate', '1.25'),
  ('night_rate', '1.25');
