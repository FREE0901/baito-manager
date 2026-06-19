const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const employeeId = req.query.employee_id || '';

  const employees = req.db.prepare('SELECT * FROM employees WHERE status = ? ORDER BY name').all('active');
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  let records = [];
  let selectedEmployee = null;

  if (employeeId) {
    selectedEmployee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    const existing = req.db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? || '%' ORDER BY date").all(employeeId, monthStr);
    const existingMap = {};
    existing.forEach(r => { existingMap[r.date] = r; });

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(year, month - 1, d).getDay();
      records.push({
        day: d, date: dateStr, dow: dayNames[dow], isWeekend: dow === 0 || dow === 6,
        ...(existingMap[dateStr] || { id: null, clock_in: '', clock_out: '', break_minutes: 0, overtime_minutes: 0, night_minutes: 0, work_type: 'office', note: '' })
      });
    }
  }

  let summary = { workDays: 0, totalHours: 0, overtimeHours: 0, nightHours: 0, officeDays: 0, remoteDays: 0 };
  if (employeeId) {
    records.forEach(r => {
      if (r.clock_in && r.clock_out) {
        summary.workDays++;
        const [inH, inM] = r.clock_in.split(':').map(Number);
        const [outH, outM] = r.clock_out.split(':').map(Number);
        const worked = (outH * 60 + outM - inH * 60 - inM - (r.break_minutes || 0)) / 60;
        summary.totalHours += Math.max(0, worked);
        summary.overtimeHours += (r.overtime_minutes || 0) / 60;
        summary.nightHours += (r.night_minutes || 0) / 60;
        if (r.work_type === 'remote') summary.remoteDays++;
        else summary.officeDays++;
      }
    });
  }

  res.render('attendance/index', { employees, records, selectedEmployee, year, month, employeeId, summary });
});

router.post('/save', (req, res) => {
  const { employee_id, year, month } = req.body;
  const dates = [].concat(req.body.date || []);
  const clockIns = [].concat(req.body.clock_in || []);
  const clockOuts = [].concat(req.body.clock_out || []);
  const breaks = [].concat(req.body.break_minutes || []);
  const overtimes = [].concat(req.body.overtime_minutes || []);
  const nights = [].concat(req.body.night_minutes || []);
  const workTypes = [].concat(req.body.work_type || []);
  const notes = [].concat(req.body.note || []);

  const upsert = req.db.prepare(`
    INSERT INTO attendance (employee_id, date, clock_in, clock_out, break_minutes, overtime_minutes, night_minutes, work_type, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      clock_in=excluded.clock_in, clock_out=excluded.clock_out, break_minutes=excluded.break_minutes,
      overtime_minutes=excluded.overtime_minutes, night_minutes=excluded.night_minutes, work_type=excluded.work_type, note=excluded.note
  `);

  const tx = req.db.transaction(() => {
    for (let i = 0; i < dates.length; i++) {
      if (clockIns[i] || clockOuts[i]) {
        upsert.run(employee_id, dates[i], clockIns[i] || null, clockOuts[i] || null,
          parseInt(breaks[i]) || 0, parseInt(overtimes[i]) || 0, parseInt(nights[i]) || 0,
          workTypes[i] || 'office', notes[i] || null);
      }
    }
  });
  tx();

  res.redirect(`/attendance?year=${year}&month=${month}&employee_id=${employee_id}`);
});

module.exports = router;
