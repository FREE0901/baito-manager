const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const reports = req.db.prepare(`
    SELECT wr.*, e.name as employee_name
    FROM work_reports wr
    JOIN employees e ON wr.employee_id = e.id
    WHERE wr.date LIKE ? || '%'
    ORDER BY wr.date DESC, wr.created_at DESC
  `).all(monthStr);

  res.render('reports/index', { reports, year, month });
});

router.post('/:id/comment', (req, res) => {
  const { admin_comment, year, month } = req.body;
  req.db.prepare('UPDATE work_reports SET admin_comment = ? WHERE id = ?')
    .run(admin_comment || '', req.params.id);
  res.redirect(`/reports?year=${year}&month=${month}`);
});

module.exports = router;
