// iCal（.ics）フィードエンドポイント
// GET /calendar/:token.ics  → 該当従業員の確定シフトをiCal形式で返す
// このURLをGoogleカレンダーの「URLで追加」に登録すると自動同期される

const express = require('express');
const router = express.Router();

// iCal日付フォーマット（YYYYMMDDTHHMMSSZ）
function toICalDate(dateStr, timeStr) {
  // dateStr: 'YYYY-MM-DD', timeStr: 'HH:MM'
  const d = dateStr.replace(/-/g, '');
  if (!timeStr) return d; // 終日イベント
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

router.get('/:token.ics', (req, res) => {
  const token = req.params.token;
  const employee = req.db.prepare("SELECT * FROM employees WHERE calendar_token = ?").get(token);

  if (!employee) {
    return res.status(404).send('Not found');
  }

  // 過去3ヶ月〜未来6ヶ月の確定シフトを取得
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 7, 0);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  const shifts = req.db.prepare(`
    SELECT * FROM shifts
    WHERE employee_id = ? AND date >= ? AND date <= ? AND status = 'confirmed'
    ORDER BY date, start_time
  `).all(employee.id, startStr, endStr);

  // iCalendar形式で出力
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//アルバイト管理システム//FREE//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(employee.name)} のシフト`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'X-WR-CALDESC:アルバイト管理システムの確定シフト',
  ];

  shifts.forEach(shift => {
    const uid = `shift-${shift.id}@free-wpo.com`;
    const dtstart = toICalDate(shift.date, shift.start_time);
    const dtend = toICalDate(shift.date, shift.end_time);
    const summary = shift.note ? `シフト（${shift.note}）` : 'シフト';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowICalUtc()}`);
    lines.push(`DTSTART;TZID=Asia/Tokyo:${dtstart}`);
    lines.push(`DTEND;TZID=Asia/Tokyo:${dtend}`);
    lines.push(`SUMMARY:${esc(summary)}`);
    if (shift.note) lines.push(`DESCRIPTION:${esc(shift.note)}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${employee.name}-shifts.ics"`);
  // キャッシュさせない（Googleカレンダーが定期取得したとき最新を返すため）
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(lines.join('\r\n'));
});

module.exports = router;
