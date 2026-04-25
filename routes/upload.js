import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();
router.post('/', upload.array('files', 10), (req, res) => {
  const files = (req.files || []).map((f) => ({ filename: f.filename, originalName: f.originalname, mimetype: f.mimetype, size: f.size, url: `/uploads/${f.filename}` }));
  res.json({ ok: true, files });
});
export default router;
