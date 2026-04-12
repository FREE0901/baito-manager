const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'employee' ? '/my' : '/dashboard');
  }
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = req.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'ユーザー名またはパスワードが正しくありません' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role || 'admin', employee_id: user.employee_id };
  // 初回ログイン時はパスワード変更を強制
  if (user.must_change_password) {
    return res.redirect('/change-password');
  }
  if (user.role === 'employee') {
    res.redirect('/my');
  } else {
    res.redirect('/dashboard');
  }
});

// パスワード変更（強制・任意共用）
router.get('/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('change-password', { error: null, forced: true });
});

router.post('/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { new_password, confirm_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.render('change-password', { error: 'パスワードは8文字以上にしてください', forced: true });
  }
  if (new_password !== confirm_password) {
    return res.render('change-password', { error: 'パスワードが一致しません', forced: true });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  req.db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?')
    .run(hash, req.session.user.id);
  const role = req.session.user.role;
  res.redirect(role === 'employee' ? '/my' : '/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
