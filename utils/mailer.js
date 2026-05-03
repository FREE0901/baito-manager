// メール送信ユーティリティ
// Railway 環境変数で設定:
//   SMTP_HOST   例: smtp.gmail.com または sv***.xserver.jp
//   SMTP_PORT   例: 587
//   SMTP_USER   例: info@free-wpo.com
//   SMTP_PASS   アプリパスワード または XserverSMTPパスワード
//   NOTIFY_TO   通知先アドレス（省略時: info@free-wpo.com）

const nodemailer = require('nodemailer');

// 設定が揃っていない場合はダミートランスポート（ログのみ）
const configured =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

let transporter;

if (configured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: parseInt(process.env.SMTP_PORT || '587') === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
} else {
  console.warn('⚠️  SMTP設定が未完了です。メール通知は無効です。');
  // ダミートランスポート（送信せずログだけ出す）
  transporter = nodemailer.createTransport({ jsonTransport: true });
}

const NOTIFY_TO = process.env.NOTIFY_TO || 'info@free-wpo.com';
const FROM = process.env.SMTP_USER ? `"アルバイト管理システム" <${process.env.SMTP_USER}>` : 'no-reply@example.com';

/**
 * メール送信（エラーが出ても画面に影響させない）
 */
async function sendMail({ subject, text }) {
  if (!configured) {
    console.log(`[メール通知スキップ] ${subject}\n${text}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: FROM,
      to: NOTIFY_TO,
      subject,
      text,
    });
    console.log(`[メール送信成功] ${subject}`);
  } catch (err) {
    console.error(`[メール送信失敗] ${subject}`, err.message);
  }
}

/**
 * シフト希望提出通知
 */
function notifyShiftRequest({ employeeName, date, startTime, endTime, workType, note }) {
  const workTypeLabel = workType === 'remote' ? 'リモート' : '出社';
  const text = [
    `${employeeName} さんがシフト希望を提出しました。`,
    '',
    `　日付　　: ${date}`,
    `　時間　　: ${startTime} 〜 ${endTime}`,
    `　勤務形態: ${workTypeLabel}`,
    note ? `　備考　　: ${note}` : '',
    '',
    `管理画面で確認・承認してください。`,
  ].filter(line => line !== null && line !== undefined).join('\n');

  sendMail({ subject: `【シフト希望】${employeeName} さんから提出がありました`, text });
}

/**
 * 出勤打刻通知
 */
function notifyClockIn({ employeeName, date, time, workType }) {
  const workTypeLabel = workType === 'remote' ? 'リモート' : '出社';
  const text = [
    `${employeeName} さんが出勤しました。`,
    '',
    `　日付　: ${date}`,
    `　時刻　: ${time}`,
    `　勤務　: ${workTypeLabel}`,
  ].join('\n');

  sendMail({ subject: `【出勤】${employeeName} さんが出勤しました`, text });
}

module.exports = { notifyShiftRequest, notifyClockIn };
