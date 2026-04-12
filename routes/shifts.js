const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;

  const employees = req.db.prepare('SELECT * FROM employees WHERE status = ? ORDER BY name').all('active');
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const shifts = req.db.prepare(`
    SELECT s.*, e.name as employee_name FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    WHERE s.date LIKE ? || '%' ORDER BY s.date, s.start_time
  `).all(monthStr);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const calendar = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(year, month - 1, d).getDay();
    calendar.push({ day: d, date: dateStr, dow, shifts: shifts.filter(s => s.date === dateStr) });
  }

  // シフト希望一覧
  const pendingRequests = req.db.prepare(`
    SELECT sr.*, e.name as employee_name FROM shift_requests sr
    JOIN employees e ON sr.employee_id = e.id
    WHERE sr.status = 'pending' ORDER BY sr.date, sr.start_time
  `).all();

  res.render('shifts/index', { employees, calendar, year, month, firstDow, pendingRequests });
});

router.post('/', (req, res) => {
  const { employee_id, date, start_time, end_time, note } = req.body;
  req.db.prepare("INSERT INTO shifts (employee_id, date, start_time, end_time, note, status) VALUES (?, ?, ?, ?, ?, 'confirmed')")
    .run(employee_id, date, start_time, end_time, note || null);
  const d = new Date(date);
  res.redirect(`/shifts?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
});

// シフト希望を承認（シフトとして確定）
router.post('/requests/:id/approve', (req, res) => {
  const request = req.db.prepare('SELECT * FROM shift_requests WHERE id = ?').get(req.params.id);
  if (request) {
    req.db.prepare("INSERT INTO shifts (employee_id, date, start_time, end_time, note, status) VALUES (?, ?, ?, ?, ?, 'confirmed')")
      .run(request.employee_id, request.date, request.start_time, request.end_time, request.note);
    req.db.prepare("UPDATE shift_requests SET status = 'approved', admin_note = ? WHERE id = ?")
      .run(req.body.admin_note || null, req.params.id);
  }
  res.redirect('/shifts');
});

// シフト希望を却下
router.post('/requests/:id/reject', (req, res) => {
  req.db.prepare("UPDATE shift_requests SET status = 'rejected', admin_note = ? WHERE id = ?")
    .run(req.body.admin_note || null, req.params.id);
  res.redirect('/shifts');
});

router.post('/:id/delete', (req, res) => {
  const shift = req.db.prepare('SELECT date FROM shifts WHERE id = ?').get(req.params.id);
  req.db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  if (shift) {
    const d = new Date(shift.date);
    return res.redirect(`/shifts?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
  }
  res.redirect('/shifts');
});

module.exports = router;
