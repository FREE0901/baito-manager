const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status || '';

  let query = `
    SELECT t.*, e.name as employee_name
    FROM tasks t
    LEFT JOIN employees e ON t.employee_id = e.id
  `;
  const params = [];

  if (status && ['pending', 'in_progress', 'completed'].includes(status)) {
    query += ' WHERE t.status = ?';
    params.push(status);
  }

  query += ' ORDER BY t.created_at DESC';

  const tasks = req.db.prepare(query).all(...params);
  const employees = req.db.prepare("SELECT id, name FROM employees WHERE status = 'active' ORDER BY name").all();

  res.render('tasks/index', { tasks, employees, currentStatus: status });
});

router.post('/', (req, res) => {
  const { employee_id, title, description, due_date, priority } = req.body;

  req.db.prepare(`
    INSERT INTO tasks (employee_id, title, description, due_date, priority)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    employee_id || null,
    title,
    description || null,
    due_date || null,
    priority || 'normal'
  );

  res.redirect('/tasks');
});

router.post('/:id/update', (req, res) => {
  const { status } = req.body;
  if (['pending', 'in_progress', 'completed'].includes(status)) {
    req.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  res.redirect('/tasks');
});

// タスク持ち越し
router.post('/:id/carry-over', (req, res) => {
  const task = req.db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
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
  res.redirect('/tasks');
});

router.post('/:id/delete', (req, res) => {
  req.db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.redirect('/tasks');
});

module.exports = router;
