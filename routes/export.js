const express = require('express');
const router = express.Router();
const path = require('path');

// GET / - export page
router.get('/', (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  res.render('export/index', { year, month });
});

// GET /backup - download SQLite database file
router.get('/backup', (req, res) => {
  const dbPath = path.join(__dirname, '..', 'db', 'database.sqlite');
  res.download(dbPath, 'baito-backup.sqlite');
});

// GET /attendance-csv - download attendance CSV for a month
router.get('/attendance-csv', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const rows = req.db.prepare(`
    SELECT a.*, e.name FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    WHERE a.date LIKE ? || '%'
    ORDER BY a.date, e.name
  `).all(monthStr);

  const header = '日付,氏名,出勤,退勤,休憩(分),区分,備考';
  const csvLines = [header];
  rows.forEach(r => {
    const cols = [
      r.date,
      r.name,
      r.clock_in || '',
      r.clock_out || '',
      r.break_minutes || 0,
      r.work_type || '',
      (r.note || '').replace(/,/g, '，').replace(/\n/g, ' ')
    ];
    csvLines.push(cols.join(','));
  });

  const csv = '\uFEFF' + csvLines.join('\n');
  const filename = `attendance_${monthStr}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
});

// GET /payroll-csv - download payroll CSV for a month
router.get('/payroll-csv', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;

  const rows = req.db.prepare(`
    SELECT p.*, e.name FROM payroll p
    JOIN employees e ON p.employee_id = e.id
    WHERE p.year = ? AND p.month = ?
    ORDER BY e.name
  `).all(year, month);

  const header = '氏名,勤務日数,労働時間,基本給,時間外手当,深夜手当,交通費,総支給額,雇用保険,所得税,その他控除,控除合計,差引支給額';
  const csvLines = [header];
  rows.forEach(r => {
    const cols = [
      r.name,
      r.work_days || 0,
      r.work_hours || 0,
      r.base_pay || 0,
      r.overtime_pay || 0,
      r.night_pay || 0,
      r.transport_pay || 0,
      r.gross_pay || 0,
      r.employment_insurance || 0,
      r.income_tax || 0,
      r.other_deduction || 0,
      r.total_deduction || 0,
      r.net_pay || 0
    ];
    csvLines.push(cols.join(','));
  });

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const csv = '\uFEFF' + csvLines.join('\n');
  const filename = `payroll_${monthStr}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
});

// GET /annual - annual summary page
router.get('/annual', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();

  const rows = req.db.prepare(`
    SELECT e.name, e.id as employee_id,
      SUM(p.work_days) as work_days,
      SUM(p.work_hours) as work_hours,
      SUM(p.gross_pay) as gross_pay,
      SUM(p.total_deduction) as total_deduction,
      SUM(p.net_pay) as net_pay
    FROM payroll p
    JOIN employees e ON p.employee_id = e.id
    WHERE p.year = ?
    GROUP BY p.employee_id
    ORDER BY e.name
  `).all(year);

  res.render('export/annual', { year, rows });
});

module.exports = router;
