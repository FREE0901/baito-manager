const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const announcements = req.db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  // 各お知らせの既読情報を取得
  const totalEmployees = req.db.prepare("SELECT COUNT(*) as cnt FROM employees WHERE status = 'active'").get().cnt;
  const readMap = {};
  announcements.forEach(a => {
    const readers = req.db.prepare(`
      SELECT e.name FROM announcement_reads ar
      JOIN employees e ON ar.employee_id = e.id
      WHERE ar.announcement_id = ? ORDER BY ar.read_at
    `).all(a.id);
    readMap[a.id] = readers;
  });
  res.render('announcements/index', { announcements, readMap, totalEmployees });
});

router.post('/', (req, res) => {
  const { title, content } = req.body;
  req.db.prepare('INSERT INTO announcements (title, content) VALUES (?, ?)').run(title, content || '');
  res.redirect('/announcements');
});

router.post('/:id/edit', (req, res) => {
  const { title, content } = req.body;
  req.db.prepare("UPDATE announcements SET title=?, content=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(title, content || '', req.params.id);
  res.redirect('/announcements');
});

router.post('/:id/delete', (req, res) => {
  req.db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.redirect('/announcements');
});

module.exports = router;
