// iCal（.ics）フィードエンドポイント
// GET /calendar/:token.ics         → 該当従業員の確定シフト
// GET /calendar/admin-all/:token.ics → 全スタッフの確定シフト（管理者向け）
// URLをGoogleカレンダーの「URLで追加」に登録すると自動同期される

const express = require('express');
const router = express.Router();

// iCal日付フォーマット（YYYYMMDDTHHMMSS）
function toICalDate(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, '');
  if (!timeStr) return d;
  const t = timeStr.replace(':', '') + '00';
  return `${d}T${t}00`;
}

// iCal文字エスケープ
function esc(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// 現在時刻をiCal形式で返す（DTSTAMP用）
function nowICalUtc() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// 共通レスポンス送信
function sendIcal(res, filename, calName, events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//アルバイト管理システム//FREE//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'X-WR-CALDESC:アルバイト管理システムの確定シフト',
  ];

  events.forEach(ev => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${nowICalUtc()}`);
    lines.push(`DTSTART;TZID=Asia/Tokyo:${ev.dtstart}`);
    lines.push(`DTEND;TZID=Asia/Tokyo:${ev.dtend}`);
    lines.push(`SUMMARY:${esc(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(lines.join('\r\n'));
}

// 期間設定（過去3ヶ月〜未来6ヶ月）
function getDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 7, 0);
  return {
    startStr: start.toISOString().split('T')[0],
    endStr: end.toISOString().split('T')[0],
  };
}

// ======== 管理者用：全スタッフ統合フィード ========
router.get('/admin-all/:token.ics', (req, res) => {
  const token = req.params.token;
  const adminTokenRow = req.db.prepare("SELECT value FROM settings WHERE key = 'admin_calendar_token'").get();
  if (!adminTokenRow || adminTokenRow.value !== token) {
    return res.status(404).send('Not found');
  }

  const { startStr, endStr } = getDateRange();

  const shifts = req.db.prepare(`
    SELECT s.*, e.name as employee_name
    FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    WHERE s.date >= ? AND s.date <= ? AND s.status = 'confirmed'
    ORDER BY s.date, s.start_time
  `).all(startStr, endStr);

  const events = shifts.map(s => ({
    uid: `shift-${s.id}@free-wpo.com`,
    dtstart: toICalDate(s.date, s.start_time),
    dtend: toICalDate(s.date, s.end_time),
    summary: s.note ? `${s.employee_name}（${s.note}）` : s.employee_name,
    description: `${s.employee_name} ${s.start_time}〜${s.end_time}${s.note ? ' ' + s.note : ''}`,
  }));

  sendIcal(res, 'all-shifts.ics', '全スタッフ シフト', events);
});

// ======== バイト個人フィード ========
router.get('/:token.ics', (req, res) => {
  const token = req.params.token;
  const employee = req.db.prepare("SELECT * FROM employees WHERE calendar_token = ?").get(token);
  if (!employee) return res.status(404).send('Not found');

  const { startStr, endStr } = getDateRange();

  const shifts = req.db.prepare(`
    SELECT * FROM shifts
    WHERE employee_id = ? AND date >= ? AND date <= ? AND status = 'confirmed'
    ORDER BY date, start_time
  `).all(employee.id, startStr, endStr);

  const events = shifts.map(s => ({
    uid: `shift-${s.id}@free-wpo.com`,
    dtstart: toICalDate(s.date, s.start_time),
    dtend: toICalDate(s.date, s.end_time),
    summary: s.note ? `シフト（${s.note}）` : 'シフト',
    description: s.note || null,
  }));

  sendIcal(res, `${employee.name}-shifts.ics`, `${employee.name} のシフト`, events);
});

module.exports = router;
