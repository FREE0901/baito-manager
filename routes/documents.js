const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// アップロード先: Volumeマウント先の uploads/
const uploadDir = path.join('/app/data/uploads');
// ローカル開発用フォールバック
const localUploadDir = path.join(__dirname, '../data/uploads');
const effectiveUploadDir = fs.existsSync('/app/data') ? uploadDir : localUploadDir;

if (!fs.existsSync(effectiveUploadDir)) {
  fs.mkdirSync(effectiveUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, effectiveUploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `emp${req.params.empId}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('許可されていないファイル形式です'));
  }
});

// 書類一覧（従業員編集ページ内で使用）
router.get('/', (req, res) => {
  const docs = req.db.prepare('SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC').all(req.params.empId);
  res.json(docs);
});

// アップロード
router.post('/', upload.single('file'), (req, res) => {
  const { document_type, note } = req.body;
  if (!req.file) return res.redirect(`/employees/${req.params.empId}/edit`);

  req.db.prepare(`
    INSERT INTO employee_documents (employee_id, document_type, original_name, stored_name, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.empId, document_type || 'その他', req.file.originalname, req.file.filename, note || null);

  res.redirect(`/employees/${req.params.empId}/edit#documents`);
});

// ダウンロード（管理者）
router.get('/:docId/download', (req, res) => {
  const doc = req.db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?')
    .get(req.params.docId, req.params.empId);
  if (!doc) return res.status(404).send('書類が見つかりません');

  const filePath = path.join(effectiveUploadDir, doc.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).send('ファイルが見つかりません');

  res.download(filePath, doc.original_name);
});

// バイト側ダウンロード（自分の書類のみ）
router.get('/:docId/view', (req, res) => {
  const doc = req.db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?')
    .get(req.params.docId, req.params.empId);
  if (!doc) return res.status(404).send('書類が見つかりません');

  const filePath = path.join(effectiveUploadDir, doc.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).send('ファイルが見つかりません');

  res.download(filePath, doc.original_name);
});

// 削除
router.post('/:docId/delete', (req, res) => {
  const doc = req.db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?')
    .get(req.params.docId, req.params.empId);
  if (doc) {
    const filePath = path.join(effectiveUploadDir, doc.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    req.db.prepare('DELETE FROM employee_documents WHERE id = ?').run(req.params.docId);
  }
  res.redirect(`/employees/${req.params.empId}/edit#documents`);
});

module.exports = router;
