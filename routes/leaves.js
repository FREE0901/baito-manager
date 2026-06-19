const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const year = req.query.year || new Date().getFullYear().toString();

  // Fetch all paid leave requests for the selected year with employee name
  const leaves = req.db.prepare(`
    SELECT pl.*, e.name as employee_name
    FROM paid_leaves pl
    JOIN employees e ON e.id = pl.employee_id
    WHERE strftime('%Y', pl.date) = ?
    ORDER BY pl.created_at DESC
  `).all(year);

  // Fetch all active employees
  const employees = req.db.prepare(`
    SELECT * FROM employees WHERE status = 'active' ORDER BY name
  `).all();

  // Calculate used days per employee (approved only)
  const usedDaysRows = req.db.prepare(`
    SELECT employee_id, SUM(1) as used
    FROM paid_leaves
    WHERE status = 'approved'
    GROUP BY employee_id
  `).all();

  const usedDaysMap = {};
  usedDaysRows.forEach(row => {
    usedDaysMap[row.employee_id] = row.used;
  });

  res.render('leaves/index', { leaves, employees, usedDaysMap, year });
});

router.post('/:id/approve', (req, res) => {
  const adminNote = req.body.admin_note || '';
  req.db.prepare(`
    UPDATE paid_leaves SET status = 'approved', admin_note = ? WHERE id = ?
  `).run(adminNote, req.params.id);
  res.redirect('/leaves');
});

router.post('/:id/reject', (req, res) => {
  const adminNote = req.body.admin_note || '';
  req.db.prepare(`
    UPDATE paid_leaves SET status = 'rejected', admin_note = ? WHERE id = ?
  `).run(adminNote, req.params.id);
  res.redirect('/leaves');
});

module.exports = router;
