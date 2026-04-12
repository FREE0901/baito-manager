const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;

  const employees = req.db.prepare('SELECT * FROM employees WHERE status = ? ORDER BY name').all('active');
  const payrolls = req.db.prepare(`
    SELECT p.*, e.name as employee_name FROM payroll p
    JOIN employees e ON p.employee_id = e.id
    WHERE p.year = ? AND p.month = ? ORDER BY e.name
  `).all(year, month);

  // 各payrollに特別手当・任意控除を付与
  payrolls.forEach(p => {
    p.allowances = req.db.prepare('SELECT * FROM payroll_allowances WHERE payroll_id = ? ORDER BY id').all(p.id);
    p.deductionItems = req.db.prepare('SELECT * FROM payroll_deductions WHERE payroll_id = ? ORDER BY id').all(p.id);
  });

  res.render('payroll/index', { employees, payrolls, year, month });
});

router.post('/calculate', (req, res) => {
  const { employee_id, year, month } = req.body;
  const y = parseInt(year);
  const m = parseInt(month);
  const monthStr = `${y}-${String(m).padStart(2, '0')}`;

  const employee = req.db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!employee) return res.redirect('/payroll');

  const settings = {};
  req.db.prepare('SELECT key, value FROM settings').all().forEach(r => { settings[r.key] = r.value; });
  const overtimeRate = parseFloat(settings.overtime_rate) || 1.25;
  const nightRate = parseFloat(settings.night_rate) || 1.25;

  const attendances = req.db.prepare(`SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? || '%'`).all(employee_id, monthStr);

  let workDays = 0, totalMinutes = 0, overtimeMinutes = 0, nightMinutes = 0, officeDays = 0, remoteDays = 0;
  attendances.forEach(a => {
    if (a.clock_in && a.clock_out) {
      workDays++;
      const [inH, inM] = a.clock_in.split(':').map(Number);
      const [outH, outM] = a.clock_out.split(':').map(Number);
      const worked = outH * 60 + outM - inH * 60 - inM - (a.break_minutes || 0);
      totalMinutes += Math.max(0, worked);
      overtimeMinutes += a.overtime_minutes || 0;
      nightMinutes += a.night_minutes || 0;
      if (a.work_type === 'remote') remoteDays++;
      else officeDays++;
    }
  });

  const workHours = totalMinutes / 60;
  const otHours = overtimeMinutes / 60;
  const ntHours = nightMinutes / 60;
  const basePay = Math.round(workHours * employee.hourly_wage);
  const overtimePay = Math.round(otHours * employee.hourly_wage * (overtimeRate - 1));
  const nightPay = Math.round(ntHours * employee.hourly_wage * (nightRate - 1));

  // 交通費計算: 出社日のみ or 月額固定
  let transportCost = 0;
  if (employee.transport_type === 'daily') {
    transportCost = officeDays * (employee.transport_cost_per_day || 0);
  } else if (employee.transport_type === 'monthly') {
    transportCost = employee.transport_cost_monthly || 0;
  }

  // 既存の特別手当を保持
  const existing = req.db.prepare('SELECT * FROM payroll WHERE employee_id = ? AND year = ? AND month = ?').get(employee_id, y, m);
  let allowancesTotal = 0;
  if (existing) {
    const allowances = req.db.prepare('SELECT SUM(amount) as total FROM payroll_allowances WHERE payroll_id = ?').get(existing.id);
    allowancesTotal = allowances.total || 0;
  }

  const grossPay = basePay + overtimePay + nightPay + transportCost + allowancesTotal;

  // 任意控除: 既存payrollから or 従業員デフォルトから
  let deductionsTotal = 0;
  if (existing) {
    const ded = req.db.prepare('SELECT SUM(amount) as total FROM payroll_deductions WHERE payroll_id = ?').get(existing.id);
    deductionsTotal = ded.total || 0;
  } else {
    // 初回計算時: 従業員デフォルト控除を合算
    const defaults = req.db.prepare('SELECT SUM(amount) as total FROM employee_default_deductions WHERE employee_id = ?').get(employee_id);
    deductionsTotal = defaults.total || 0;
  }

  // 旧フィールドとの互換性: 既存の固定控除も合算
  const insurance = existing ? existing.insurance : 0;
  const otherDeduction = existing ? existing.other_deduction : 0;

  // 源泉徴収: 社会保険等控除後の課税対象額から自動計算
  const socialDeductions = insurance + deductionsTotal;
  const taxableIncome = Math.max(0, grossPay - socialDeductions);
  const incomeTax = calcWithholdingTax(taxableIncome, employee.tax_table || '乙');

  const totalDeduction = insurance + incomeTax + otherDeduction + deductionsTotal;
  const netPay = grossPay - totalDeduction;

  req.db.prepare(`
    INSERT INTO payroll (employee_id, year, month, work_days, work_hours, overtime_hours, night_hours,
      office_days, remote_days, base_pay, overtime_pay, night_pay, transport_cost, gross_pay,
      insurance, income_tax, other_deduction, total_deduction, net_pay, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    ON CONFLICT(employee_id, year, month) DO UPDATE SET
      work_days=excluded.work_days, work_hours=excluded.work_hours, overtime_hours=excluded.overtime_hours,
      night_hours=excluded.night_hours, office_days=excluded.office_days, remote_days=excluded.remote_days,
      base_pay=excluded.base_pay, overtime_pay=excluded.overtime_pay, night_pay=excluded.night_pay,
      transport_cost=excluded.transport_cost, gross_pay=excluded.gross_pay,
      insurance=excluded.insurance, income_tax=excluded.income_tax, other_deduction=excluded.other_deduction,
      total_deduction=excluded.total_deduction, net_pay=excluded.net_pay
  `).run(employee_id, y, m, workDays, workHours, otHours, ntHours,
    officeDays, remoteDays, basePay, overtimePay, nightPay, transportCost, grossPay,
    insurance, incomeTax, otherDeduction, totalDeduction, netPay);

  // 初回計算時: デフォルト控除をpayroll_deductionsにコピー
  if (!existing) {
    const payrollRow = req.db.prepare('SELECT id FROM payroll WHERE employee_id = ? AND year = ? AND month = ?').get(employee_id, y, m);
    if (payrollRow) {
      const defaults = req.db.prepare('SELECT name, amount FROM employee_default_deductions WHERE employee_id = ?').all(employee_id);
      const ins = req.db.prepare('INSERT INTO payroll_deductions (payroll_id, name, amount) VALUES (?, ?, ?)');
      defaults.forEach(d => ins.run(payrollRow.id, d.name, d.amount));
    }
  }

  res.redirect(`/payroll?year=${y}&month=${m}`);
});

// 任意控除の追加
router.post('/:id/deduction', (req, res) => {
  const { name, amount, year, month } = req.body;
  const amt = parseInt(amount) || 0;
  if (name && amt > 0) {
    req.db.prepare('INSERT INTO payroll_deductions (payroll_id, name, amount) VALUES (?, ?, ?)').run(req.params.id, name, amt);
    recalcAll(req.db, req.params.id);
  }
  res.redirect(`/payroll?year=${year}&month=${month}`);
});

// 任意控除の削除
router.post('/:id/deduction/:did/delete', (req, res) => {
  const { year, month } = req.body;
  req.db.prepare('DELETE FROM payroll_deductions WHERE id = ? AND payroll_id = ?').run(req.params.did, req.params.id);
  recalcAll(req.db, req.params.id);
  res.redirect(`/payroll?year=${year}&month=${month}`);
});

router.post('/:id/deductions', (req, res) => {
  const { insurance, income_tax, other_deduction, year, month } = req.body;
  const ins = parseInt(insurance) || 0;
  const tax = parseInt(income_tax) || 0;
  const other = parseInt(other_deduction) || 0;
  const totalDeduction = ins + tax + other;
  req.db.prepare('UPDATE payroll SET insurance=?, income_tax=?, other_deduction=?, total_deduction=? WHERE id=?')
    .run(ins, tax, other, totalDeduction, req.params.id);
  recalcGross(req.db, req.params.id);
  res.redirect(`/payroll?year=${year}&month=${month}`);
});

// 特別手当の追加
router.post('/:id/allowance', (req, res) => {
  const { name, amount, year, month } = req.body;
  const amt = parseInt(amount) || 0;
  if (name && amt !== 0) {
    req.db.prepare('INSERT INTO payroll_allowances (payroll_id, name, amount) VALUES (?, ?, ?)').run(req.params.id, name, amt);
    // gross_pay, net_pay を再計算
    recalcGross(req.db, req.params.id);
  }
  res.redirect(`/payroll?year=${year}&month=${month}`);
});

// 特別手当の削除
router.post('/:id/allowance/:aid/delete', (req, res) => {
  const { year, month } = req.body;
  req.db.prepare('DELETE FROM payroll_allowances WHERE id = ? AND payroll_id = ?').run(req.params.aid, req.params.id);
  recalcGross(req.db, req.params.id);
  res.redirect(`/payroll?year=${year}&month=${month}`);
});

function recalcGross(db, payrollId) {
  const p = db.prepare('SELECT * FROM payroll WHERE id = ?').get(payrollId);
  if (!p) return;
  const allowances = db.prepare('SELECT SUM(amount) as total FROM payroll_allowances WHERE payroll_id = ?').get(payrollId);
  const allowancesTotal = allowances.total || 0;
  const grossPay = p.base_pay + p.overtime_pay + p.night_pay + p.transport_cost + allowancesTotal;
  const netPay = grossPay - p.total_deduction;
  db.prepare('UPDATE payroll SET gross_pay = ?, net_pay = ? WHERE id = ?').run(grossPay, netPay, payrollId);
}

function recalcAll(db, payrollId) {
  const p = db.prepare('SELECT * FROM payroll WHERE id = ?').get(payrollId);
  if (!p) return;
  const allowances = db.prepare('SELECT SUM(amount) as total FROM payroll_allowances WHERE payroll_id = ?').get(payrollId);
  const deductions = db.prepare('SELECT SUM(amount) as total FROM payroll_deductions WHERE payroll_id = ?').get(payrollId);
  const allowancesTotal = allowances.total || 0;
  const deductionsTotal = deductions.total || 0;
  const grossPay = p.base_pay + p.overtime_pay + p.night_pay + p.transport_cost + allowancesTotal;
  const totalDeduction = p.insurance + p.income_tax + p.other_deduction + deductionsTotal;
  const netPay = grossPay - totalDeduction;
  db.prepare('UPDATE payroll SET gross_pay = ?, total_deduction = ?, net_pay = ? WHERE id = ?').run(grossPay, totalDeduction, netPay, payrollId);
}

router.get('/:id/detail', (req, res) => {
  const payroll = req.db.prepare(`
    SELECT p.*, e.name, e.name_kana, e.hourly_wage, e.transport_type, e.transport_cost_per_day, e.transport_cost_monthly
    FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = ?
  `).get(req.params.id);
  if (!payroll) return res.redirect('/payroll');
  const allowances = req.db.prepare('SELECT * FROM payroll_allowances WHERE payroll_id = ? ORDER BY id').all(req.params.id);
  const deductionItems = req.db.prepare('SELECT * FROM payroll_deductions WHERE payroll_id = ? ORDER BY id').all(req.params.id);
  res.render('payroll/detail', { payroll, allowances, deductionItems });
});

router.post('/:id/confirm', (req, res) => {
  const { year, month } = req.body;
  req.db.prepare('UPDATE payroll SET status = ? WHERE id = ?').run('confirmed', req.params.id);
  res.redirect(`/payroll?year=${year}&month=${month}`);
});

// 源泉徴収税額自動計算（月額表・概算、復興特別所得税込み）
// 参考: 国税庁 給与所得の源泉徴収税額表（月額表）令和6年分
function calcWithholdingTax(taxableIncome, taxTable) {
  if (taxTable === '甲') {
    // 甲欄（扶養控除等申告書提出済み・扶養0人）
    if (taxableIncome < 88000) return 0;
    if (taxableIncome < 89000) return 130;
    if (taxableIncome < 90000) return 260;
    if (taxableIncome < 91000) return 390;
    if (taxableIncome < 92000) return 520;
    if (taxableIncome < 93000) return 650;
    if (taxableIncome < 94000) return 780;
    if (taxableIncome < 95000) return 900;
    if (taxableIncome < 96000) return 1030;
    if (taxableIncome < 97000) return 1160;
    if (taxableIncome < 98000) return 1290;
    if (taxableIncome < 99000) return 1420;
    if (taxableIncome < 101000) return 1550;
    if (taxableIncome < 103000) return 1680;
    if (taxableIncome < 105000) return 1820;
    if (taxableIncome < 107000) return 1950;
    if (taxableIncome < 109000) return 2090;
    if (taxableIncome < 111000) return 2230;
    if (taxableIncome < 113000) return 2360;
    if (taxableIncome < 115000) return 2500;
    if (taxableIncome < 117000) return 2640;
    if (taxableIncome < 119000) return 2780;
    if (taxableIncome < 121000) return 2910;
    if (taxableIncome < 123000) return 3050;
    if (taxableIncome < 125000) return 3190;
    if (taxableIncome < 127000) return 3330;
    if (taxableIncome < 129000) return 3460;
    if (taxableIncome < 131000) return 3600;
    if (taxableIncome < 133000) return 3740;
    if (taxableIncome < 135000) return 3880;
    if (taxableIncome < 137000) return 4010;
    if (taxableIncome < 139000) return 4150;
    if (taxableIncome < 141000) return 4290;
    if (taxableIncome < 143000) return 4420;
    if (taxableIncome < 145000) return 4560;
    if (taxableIncome < 147000) return 4700;
    if (taxableIncome < 149000) return 4840;
    if (taxableIncome < 151000) return 4970;
    if (taxableIncome < 153000) return 5110;
    if (taxableIncome < 155000) return 5250;
    if (taxableIncome < 157000) return 5390;
    if (taxableIncome < 160000) return 5520;
    if (taxableIncome < 163000) return 5810;
    if (taxableIncome < 166000) return 6100;
    if (taxableIncome < 169000) return 6390;
    if (taxableIncome < 172000) return 6680;
    if (taxableIncome < 175000) return 6970;
    if (taxableIncome < 178000) return 7260;
    if (taxableIncome < 181000) return 7550;
    if (taxableIncome < 184000) return 7840;
    if (taxableIncome < 187000) return 8130;
    if (taxableIncome < 190000) return 8420;
    if (taxableIncome < 193000) return 8720;
    if (taxableIncome < 196000) return 9010;
    if (taxableIncome < 199000) return 9300;
    if (taxableIncome < 202000) return 9590;
    if (taxableIncome < 205000) return 9880;
    if (taxableIncome < 208000) return 10170;
    if (taxableIncome < 211000) return 10460;
    if (taxableIncome < 214000) return 10750;
    if (taxableIncome < 217000) return 11040;
    if (taxableIncome < 220000) return 11330;
    if (taxableIncome < 224000) return 11630;
    if (taxableIncome < 228000) return 12110;
    if (taxableIncome < 232000) return 12600;
    if (taxableIncome < 236000) return 13090;
    if (taxableIncome < 240000) return 13580;
    if (taxableIncome < 244000) return 14060;
    if (taxableIncome < 248000) return 14550;
    if (taxableIncome < 252000) return 15040;
    if (taxableIncome < 256000) return 15530;
    if (taxableIncome < 260000) return 16010;
    if (taxableIncome < 264000) return 16500;
    if (taxableIncome < 268000) return 16990;
    if (taxableIncome < 272000) return 17480;
    if (taxableIncome < 276000) return 17960;
    if (taxableIncome < 280000) return 18450;
    if (taxableIncome < 284000) return 18940;
    if (taxableIncome < 288000) return 19430;
    if (taxableIncome < 292000) return 19910;
    if (taxableIncome < 296000) return 20400;
    if (taxableIncome < 300000) return 20890;
    // 300,000円以上は簡略計算
    if (taxableIncome < 400000) return Math.floor((taxableIncome * 0.06126 - 2573) / 10) * 10;
    if (taxableIncome < 500000) return Math.floor((taxableIncome * 0.09188 - 14688) / 10) * 10;
    if (taxableIncome < 600000) return Math.floor((taxableIncome * 0.12252 - 29774) / 10) * 10;
    if (taxableIncome < 800000) return Math.floor((taxableIncome * 0.15315 - 48176) / 10) * 10;
    if (taxableIncome < 1000000) return Math.floor((taxableIncome * 0.18379 - 72681) / 10) * 10;
    return Math.floor((taxableIncome * 0.24504 - 133869) / 10) * 10;
  } else {
    // 乙欄（扶養控除等申告書未提出・アルバイトに多い）
    if (taxableIncome < 87000) return 0;
    if (taxableIncome < 300000) return Math.floor(taxableIncome * 0.03063 / 100) * 100;
    if (taxableIncome < 350000) return Math.floor((taxableIncome * 0.06126 - 9188) / 100) * 100;
    if (taxableIncome < 400000) return Math.floor((taxableIncome * 0.0735 - 13520) / 100) * 100;
    if (taxableIncome < 500000) return Math.floor((taxableIncome * 0.09188 - 20884) / 100) * 100;
    if (taxableIncome < 600000) return Math.floor((taxableIncome * 0.12252 - 36204) / 100) * 100;
    if (taxableIncome < 700000) return Math.floor((taxableIncome * 0.15315 - 54520) / 100) * 100;
    if (taxableIncome < 800000) return Math.floor((taxableIncome * 0.18379 - 76024) / 100) * 100;
    if (taxableIncome < 1000000) return Math.floor((taxableIncome * 0.18379 - 76024) / 100) * 100;
    return Math.floor((taxableIncome * 0.24504 - 138024) / 100) * 100;
  }
}

module.exports = router;
