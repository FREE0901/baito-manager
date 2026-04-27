const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

router.get('/', (req, res) => {
  const employees = req.db.prepare(`
    SELECT e.*, u.username as login_username FROM employees e
    LEFT JOIN users u ON u.employee_id = e.id AND u.role = 'employee'
    ORDER BY e.status, e.name
  `).all();
  res.render('employees/index', { employees });
});

router.get('/new', (req, res) => {
  res.render('employees/form', { employee: null, wageHistory: [], loginUsername: null, defaultDeductions: [] });
});

router.post('/', (req, res) => {
  const { last_name, first_name, last_name_kana, first_name_kana,
          gender, birth_date, postal_code, address, phone, hourly_wage, hire_date,
          employment_type, transport_type, transport_cost_per_day, transport_cost_monthly,
          contract_end_date, paid_leave_days, memo, tax_table, dependents,
          bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_name,
          login_username, login_password } = req.body;

  // 姓名を結合してnameカラムも維持（後方互換）
  const fullName = [last_name, first_name].filter(Boolean).join(' ') || '（未設定）';
  const fullNameKana = [last_name_kana, first_name_kana].filter(Boolean).join(' ');

  const result = req.db.prepare(`
    INSERT INTO employees (name, name_kana, last_name, first_name, last_name_kana, first_name_kana,
      gender, birth_date, postal_code, address, phone, hourly_wage, hire_date,
      employment_type, transport_type, transport_cost_per_day, transport_cost_monthly,
      contract_end_date, paid_leave_days, memo, tax_table, dependents,
      bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fullName, fullNameKana, last_name || null, first_name || null,
    last_name_kana || null, first_name_kana || null,
    gender, birth_date || null, postal_code || null, address, phone,
    parseInt(hourly_wage) || 1200, hire_date || null, employment_type || 'アルバイト',
    transport_type || 'daily', parseInt(transport_cost_per_day) || 0, parseInt(transport_cost_monthly) || 0,
    contract_end_date || null, parseFloat(paid_leave_days) || 0, memo || null,
    tax_table || '乙', parseInt(dependents) || 0,
    bank_name || null, bank_branch || null, bank_account_type || '普通',
    bank_account_number || null, bank_account_name || null);

  const empId = result.lastInsertRowid;

  req.db.prepare('INSERT INTO wage_history (employee_id, hourly_wage, effective_date, reason) VALUES (?, ?, ?, ?)')
    .run(empId, parseInt(hourly_wage) || 1200, hire_date || new Date().toISOString().split('T')[0], '入社時');

  // ログインアカウント作成
  if (login_username && login_password) {
    const hash = bcrypt.hashSync(login_password, 10);
    req.db.prepare("INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, 'employee', ?)")
      .run(login_username, hash, empId);
  }

  res.redirect('/employees');
});

router.get('/:id/edit', (req, res) => {
  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.redirect('/employees');
  const wageHistory = req.db.prepare('SELECT * FROM wage_history WHERE employee_id = ? ORDER BY effective_date DESC').all(req.params.id);
  const userRow = req.db.prepare("SELECT username FROM users WHERE employee_id = ? AND role = 'employee'").get(req.params.id);
  const defaultDeductions = req.db.prepare('SELECT * FROM employee_default_deductions WHERE employee_id = ? ORDER BY id').all(req.params.id);
  res.render('employees/form', { employee, wageHistory, loginUsername: userRow ? userRow.username : null, defaultDeductions });
});

// デフォルト控除の追加
router.post('/:id/deduction', (req, res) => {
  const { name, amount } = req.body;
  const amt = parseInt(amount) || 0;
  if (name && amt > 0) {
    req.db.prepare('INSERT INTO employee_default_deductions (employee_id, name, amount) VALUES (?, ?, ?)').run(req.params.id, name, amt);
  }
  res.redirect(`/employees/${req.params.id}/edit`);
});

// デフォルト控除の削除
router.post('/:id/deduction/:did/delete', (req, res) => {
  req.db.prepare('DELETE FROM employee_default_deductions WHERE id = ? AND employee_id = ?').run(req.params.did, req.params.id);
  res.redirect(`/employees/${req.params.id}/edit`);
});

router.post('/:id', (req, res) => {
  const { last_name, first_name, last_name_kana, first_name_kana,
          gender, birth_date, postal_code, address, phone, hourly_wage, hire_date,
          employment_type, transport_type, transport_cost_per_day, transport_cost_monthly,
          contract_end_date, paid_leave_days, memo, tax_table, dependents,
          bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_name,
          status, login_username, login_password } = req.body;

  const employee = req.db.prepare('SELECT hourly_wage FROM employees WHERE id = ?').get(req.params.id);
  const newWage = parseInt(hourly_wage) || 1200;
  const fullName = [last_name, first_name].filter(Boolean).join(' ') || '（未設定）';
  const fullNameKana = [last_name_kana, first_name_kana].filter(Boolean).join(' ');

  req.db.prepare(`
    UPDATE employees SET
      name=?, name_kana=?, last_name=?, first_name=?, last_name_kana=?, first_name_kana=?,
      gender=?, birth_date=?, postal_code=?, address=?, phone=?, hourly_wage=?,
      hire_date=?, employment_type=?, transport_type=?, transport_cost_per_day=?, transport_cost_monthly=?,
      contract_end_date=?, paid_leave_days=?, memo=?, tax_table=?, dependents=?,
      bank_name=?, bank_branch=?, bank_account_type=?, bank_account_number=?, bank_account_name=?,
      status=?
    WHERE id=?
  `).run(fullName, fullNameKana, last_name || null, first_name || null,
    last_name_kana || null, first_name_kana || null,
    gender, birth_date || null, postal_code || null, address, phone, newWage,
    hire_date || null, employment_type, transport_type || 'daily',
    parseInt(transport_cost_per_day) || 0, parseInt(transport_cost_monthly) || 0,
    contract_end_date || null, parseFloat(paid_leave_days) || 0, memo || null,
    tax_table || '乙', parseInt(dependents) || 0,
    bank_name || null, bank_branch || null, bank_account_type || '普通',
    bank_account_number || null, bank_account_name || null,
    status || 'active', req.params.id);

  if (employee && employee.hourly_wage !== newWage) {
    req.db.prepare('INSERT INTO wage_history (employee_id, hourly_wage, effective_date, reason) VALUES (?, ?, ?, ?)')
      .run(req.params.id, newWage, new Date().toISOString().split('T')[0], req.body.wage_reason || '時給変更');
  }

  // ログインアカウント更新
  const existingUser = req.db.prepare("SELECT id FROM users WHERE employee_id = ? AND role = 'employee'").get(req.params.id);
  if (login_username) {
    if (existingUser) {
      req.db.prepare('UPDATE users SET username = ? WHERE id = ?').run(login_username, existingUser.id);
      if (login_password) {
        const hash = bcrypt.hashSync(login_password, 10);
        req.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, existingUser.id);
      }
    } else if (login_password) {
      const hash = bcrypt.hashSync(login_password, 10);
      req.db.prepare("INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, 'employee', ?)")
        .run(login_username, hash, req.params.id);
    }
  }

  res.redirect('/employees');
});

router.post('/:id/delete', (req, res) => {
  req.db.prepare("DELETE FROM users WHERE employee_id = ? AND role = 'employee'").run(req.params.id);
  req.db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.redirect('/employees');
});

module.exports = router;
