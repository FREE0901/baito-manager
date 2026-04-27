const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

// バイト用ダッシュボード
router.get('/', (req, res) => {
  const empId = req.session.user.employee_id;
  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  const today = new Date().toISOString().split('T')[0];

  const todayShift = req.db.prepare("SELECT * FROM shifts WHERE employee_id = ? AND date = ? AND status = 'confirmed'").get(empId, today);

  // カレンダー表示用：今月と来月のシフトを取得
  const calNow = new Date();
  const calStart = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, '0')}-01`;
  const calNextEnd = new Date(calNow.getFullYear(), calNow.getMonth() + 2, 0);
  const calEnd = `${calNextEnd.getFullYear()}-${String(calNextEnd.getMonth() + 1).padStart(2, '0')}-${String(calNextEnd.getDate()).padStart(2, '0')}`;
  const calendarShifts = req.db.prepare(`
    SELECT * FROM shifts WHERE employee_id = ? AND date >= ? AND date <= ? AND status = 'confirmed'
    ORDER BY date, start_time
  `).all(empId, calStart, calEnd);

  const pendingRequests = req.db.prepare("SELECT * FROM shift_requests WHERE employee_id = ? AND status = 'pending' ORDER BY date").all(empId);

  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthAttendance = req.db.prepare(`
    SELECT COUNT(*) as days,
      SUM(CASE WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL
        THEN (julianday(clock_out) - julianday(clock_in)) * 24 - break_minutes / 60.0 ELSE 0 END) as hours
    FROM attendance WHERE employee_id = ? AND date LIKE ? || '%' AND clock_in IS NOT NULL
  `).get(empId, monthStr);

  // 今日の出退勤
  const todayAttendance = req.db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, today);

  // お知らせ（最新5件）
  const announcements = req.db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5').all();

  // 担当タスク（未完了）
  const myTasks = req.db.prepare("SELECT * FROM tasks WHERE (employee_id = ? OR employee_id IS NULL) AND status != 'completed' ORDER BY priority DESC, due_date").all(empId);

  // 有給残日数
  const usedLeaves = req.db.prepare("SELECT COUNT(*) as cnt FROM paid_leaves WHERE employee_id = ? AND status = 'approved'").get(empId);
  const leaveRemaining = (employee.paid_leave_days || 0) - (usedLeaves.cnt || 0);

  res.render('my/index', { employee, todayShift, calendarShifts, pendingRequests, monthAttendance, today, todayAttendance, announcements, myTasks, leaveRemaining });
});

// --- 打刻 ---
router.post('/clock-in', (req, res) => {
  const empId = req.session.user.employee_id;
  const today = new Date().toISOString().split('T')[0];
  const nowTime = new Date().toTimeString().slice(0, 5);
  const workType = req.body.work_type || 'office';

  const existing = req.db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, today);
  if (!existing) {
    req.db.prepare('INSERT INTO attendance (employee_id, date, clock_in, work_type) VALUES (?, ?, ?, ?)')
      .run(empId, today, nowTime, workType);
  }
  res.redirect('/my');
});

router.post('/clock-out', (req, res) => {
  const empId = req.session.user.employee_id;
  const today = new Date().toISOString().split('T')[0];
  const nowTime = new Date().toTimeString().slice(0, 5);
  const breakMin = parseInt(req.body.break_minutes) || 0;
  const workType = req.body.work_type || 'office';

  req.db.prepare('UPDATE attendance SET clock_out = ?, break_minutes = ?, work_type = ? WHERE employee_id = ? AND date = ?')
    .run(nowTime, breakMin, workType, empId, today);
  res.redirect('/my');
});

// --- シフト希望 ---
router.get('/shift-request', (req, res) => {
  const empId = req.session.user.employee_id;
  const requests = req.db.prepare('SELECT * FROM shift_requests WHERE employee_id = ? ORDER BY date DESC LIMIT 30').all(empId);
  res.render('my/shift-request', { requests });
});

router.post('/shift-request', (req, res) => {
  const empId = req.session.user.employee_id;
  const { date, start_time, end_time, work_type, note } = req.body;
  req.db.prepare('INSERT INTO shift_requests (employee_id, date, start_time, end_time, work_type, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(empId, date, start_time, end_time, work_type || 'office', note || null);
  res.redirect('/my/shift-request');
});

router.post('/shift-request/:id/cancel', (req, res) => {
  const empId = req.session.user.employee_id;
  req.db.prepare("DELETE FROM shift_requests WHERE id = ? AND employee_id = ? AND status = 'pending'").run(req.params.id, empId);
  res.redirect('/my/shift-request');
});

// --- 出退勤確認 ---
router.get('/attendance', (req, res) => {
  const empId = req.session.user.employee_id;
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  const records = req.db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? || '%' ORDER BY date").all(empId, monthStr);

  let summary = { workDays: 0, totalHours: 0, officeDays: 0, remoteDays: 0 };
  records.forEach(r => {
    if (r.clock_in && r.clock_out) {
      summary.workDays++;
      const [inH, inM] = r.clock_in.split(':').map(Number);
      const [outH, outM] = r.clock_out.split(':').map(Number);
      summary.totalHours += Math.max(0, (outH * 60 + outM - inH * 60 - inM - (r.break_minutes || 0)) / 60);
      if (r.work_type === 'remote') summary.remoteDays++;
      else summary.officeDays++;
    }
  });

  res.render('my/attendance', { employee, records, year, month, summary });
});

// --- 業務タスク ---
router.get('/tasks', (req, res) => {
  const empId = req.session.user.employee_id;
  const tasks = req.db.prepare("SELECT * FROM tasks WHERE employee_id = ? OR employee_id IS NULL ORDER BY status, priority DESC, due_date").all(empId);
  res.render('my/tasks', { tasks });
});

router.post('/tasks/:id/update', (req, res) => {
  const empId = req.session.user.employee_id;
  const { status } = req.body;
  req.db.prepare("UPDATE tasks SET status = ? WHERE id = ? AND (employee_id = ? OR employee_id IS NULL)").run(status, req.params.id, empId);
  const referer = req.headers.referer || '/my/tasks';
  res.redirect(referer);
});

// タスク持ち越し（従業員側）
router.post('/tasks/:id/carry-over', (req, res) => {
  const empId = req.session.user.employee_id;
  const task = req.db.prepare('SELECT * FROM tasks WHERE id = ? AND (employee_id = ? OR employee_id IS NULL)').get(req.params.id, empId);
  if (task) {
    const newDate = req.body.new_due_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    })();
    const originalDate = task.original_due_date || task.due_date;
    const carriedCount = (task.carried_count || 0) + 1;
    req.db.prepare('UPDATE tasks SET due_date = ?, original_due_date = ?, carried_count = ?, status = ? WHERE id = ?')
      .run(newDate, originalDate, carriedCount, task.status === 'completed' ? 'pending' : task.status, req.params.id);
  }
  res.redirect('/my/tasks');
});

// --- 業務報告 ---
router.get('/report', (req, res) => {
  const empId = req.session.user.employee_id;
  const today = new Date().toISOString().split('T')[0];
  const reports = req.db.prepare('SELECT * FROM work_reports WHERE employee_id = ? ORDER BY date DESC LIMIT 30').all(empId);
  res.render('my/report', { reports, today });
});

router.post('/report', (req, res) => {
  const empId = req.session.user.employee_id;
  const { date, content } = req.body;
  req.db.prepare('INSERT INTO work_reports (employee_id, date, content) VALUES (?, ?, ?)').run(empId, date, content);
  res.redirect('/my/report');
});

// --- 有給申請 ---
router.get('/leave', (req, res) => {
  const empId = req.session.user.employee_id;
  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  const leaves = req.db.prepare('SELECT * FROM paid_leaves WHERE employee_id = ? ORDER BY date DESC').all(empId);
  const usedLeaves = req.db.prepare("SELECT COUNT(*) as cnt FROM paid_leaves WHERE employee_id = ? AND status = 'approved'").get(empId);
  const remaining = (employee.paid_leave_days || 0) - (usedLeaves.cnt || 0);
  res.render('my/leave', { leaves, remaining, employee });
});

router.post('/leave', (req, res) => {
  const empId = req.session.user.employee_id;
  const { date, reason } = req.body;
  req.db.prepare('INSERT INTO paid_leaves (employee_id, date, reason) VALUES (?, ?, ?)').run(empId, date, reason || null);
  res.redirect('/my/leave');
});

router.post('/leave/:id/cancel', (req, res) => {
  const empId = req.session.user.employee_id;
  req.db.prepare("DELETE FROM paid_leaves WHERE id = ? AND employee_id = ? AND status = 'pending'").run(req.params.id, empId);
  res.redirect('/my/leave');
});

// --- プロフィール編集 ---
router.get('/profile', (req, res) => {
  const empId = req.session.user.employee_id;
  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  const userRow = req.db.prepare("SELECT username FROM users WHERE employee_id = ? AND role = 'employee'").get(empId);
  res.render('my/profile', { employee, loginUsername: userRow ? userRow.username : '', error: null, success: null });
});

router.post('/profile', (req, res) => {
  const empId = req.session.user.employee_id;
  const { last_name, first_name, last_name_kana, first_name_kana, postal_code, address, phone, new_password, new_password_confirm } = req.body;
  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  const userRow = req.db.prepare("SELECT * FROM users WHERE employee_id = ? AND role = 'employee'").get(empId);

  // パスワード変更（入力があれば）
  if (new_password) {
    if (new_password.length < 8) {
      return res.render('my/profile', { employee, loginUsername: userRow ? userRow.username : '', error: 'パスワードは8文字以上で設定してください', success: null });
    }
    if (new_password !== new_password_confirm) {
      return res.render('my/profile', { employee, loginUsername: userRow ? userRow.username : '', error: 'パスワードが一致しません', success: null });
    }
    if (userRow) {
      const hash = bcrypt.hashSync(new_password, 10);
      req.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, userRow.id);
    }
  }

  const fullName = [last_name, first_name].filter(Boolean).join(' ') || employee.name;
  const fullNameKana = [last_name_kana, first_name_kana].filter(Boolean).join(' ');

  req.db.prepare(`
    UPDATE employees SET
      last_name=?, first_name=?, last_name_kana=?, first_name_kana=?,
      name=?, name_kana=?, postal_code=?, address=?, phone=?
    WHERE id=?
  `).run(last_name || null, first_name || null, last_name_kana || null, first_name_kana || null,
    fullName, fullNameKana, postal_code || null, address || null, phone || null, empId);

  const updatedEmployee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  res.render('my/profile', { employee: updatedEmployee, loginUsername: userRow ? userRow.username : '', error: null, success: '保存しました' });
});

// --- 給与明細 ---
router.get('/payroll', (req, res) => {
  const empId = req.session.user.employee_id;
  const payrolls = req.db.prepare("SELECT * FROM payroll WHERE employee_id = ? ORDER BY year DESC, month DESC").all(empId);
  res.render('my/payroll', { payrolls });
});

router.get('/payroll/:id', (req, res) => {
  const empId = req.session.user.employee_id;
  const payroll = req.db.prepare(`
    SELECT p.*, e.name, e.name_kana, e.hourly_wage, e.transport_type, e.transport_cost_per_day, e.transport_cost_monthly
    FROM payroll p JOIN employees e ON p.employee_id = e.id
    WHERE p.id = ? AND p.employee_id = ?
  `).get(req.params.id, empId);
  if (!payroll) return res.redirect('/my/payroll');
  const allowances = req.db.prepare('SELECT * FROM payroll_allowances WHERE payroll_id = ? ORDER BY id').all(req.params.id);
  const deductionItems = req.db.prepare('SELECT * FROM payroll_deductions WHERE payroll_id = ? ORDER BY id').all(req.params.id);
  res.render('payroll/detail', { payroll, allowances, deductionItems });
});

module.exports = router;
