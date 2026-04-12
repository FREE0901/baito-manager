const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

router.get('/', (req, res) => {
  res.render('settings');
});

router.post('/', (req, res) => {
  const { business_name, address, closing_day, pay_day, overtime_rate, night_rate } = req.body;
  const upsert = req.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  upsert.run('business_name', business_name || '');
  upsert.run('address', address || '');
  upsert.run('closing_day', closing_day || '末日');
  upsert.run('pay_day', pay_day || '翌月25日');
  upsert.run('overtime_rate', overtime_rate || '1.25');
  upsert.run('night_rate', night_rate || '1.25');
  res.redirect('/settings');
});

router.post('/password', (req, res) => {
  const { current_password, new_password } = req.body;
  const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.redirect('/settings');
  }
  const hash = bcrypt.hashSync(new_password, 10);
  req.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.user.id);
  res.redirect('/settings');
});

module.exports = router;
