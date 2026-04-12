const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const today = now.toISOString().split('T')[0];
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`;

  const employeeCount = req.db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE status = ?').get('active').cnt;

  const todayShifts = req.db.prepare(`
    SELECT s.*, e.name FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    WHERE s.date = ? ORDER BY s.start_time
  `).all(today);

  const upcomingShifts = req.db.prepare(`
    SELECT s.*, e.name FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    WHERE s.date > ? AND s.date <= date(?, '+7 days')
    ORDER BY s.date, s.start_time LIMIT 10
  `).all(today, today);

  const monthlyAttendance = req.db.prepare(`
    SELECT COUNT(DISTINCT a.date) as work_days,
           SUM(CASE WHEN a.clock_in IS NOT NULL AND a.clock_out IS NOT NULL
               THEN (julianday(a.clock_out) - julianday(a.clock_in)) * 24 - a.break_minutes / 60.0
               ELSE 0 END) as total_hours
    FROM attendance a
    WHERE a.date BETWEEN ? AND ?
  `).get(monthStart, monthEnd);

  // 契約更新リマインダー（30日以内に契約終了）
  const contractAlerts = req.db.prepare(`
    SELECT * FROM employees
    WHERE status = 'active' AND contract_end_date IS NOT NULL
      AND contract_end_date <= date(?, '+30 days') AND contract_end_date >= ?
    ORDER BY contract_end_date
  `).all(today, today);

  // 未承認の有給申請
  const pendingLeaves = req.db.prepare(`
    SELECT pl.*, e.name as employee_name FROM paid_leaves pl
    JOIN employees e ON pl.employee_id = e.id
    WHERE pl.status = 'pending' ORDER BY pl.date
  `).all();

  // 最新の業務報告（未読＝コメントなし）
  const unrepliedReports = req.db.prepare(`
    SELECT wr.*, e.name as employee_name FROM work_reports wr
    JOIN employees e ON wr.employee_id = e.id
    WHERE wr.admin_comment IS NULL ORDER BY wr.date DESC LIMIT 5
  `).all();

  res.render('dashboard', {
    employeeCount,
    todayShifts,
    upcomingShifts,
    monthlyAttendance,
    contractAlerts,
    pendingLeaves,
    unrepliedReports,
    year,
    month,
    today
  });
});

module.exports = router;
