const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const announcements = req.db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.render('announcements/index', { announcements });
});

router.post('/', (req, res) => {
  const { title, content } = req.body;
  req.db.prepare('INSERT INTO announcements (title, content) VALUES (?, ?)').run(title, content || '');
  res.redirect('/announcements');
});

router.post('/:id/delete', (req, res) => {
  req.db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.redirect('/announcements');
});

module.exports = router;
