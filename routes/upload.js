import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function sanitizePathSegment(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function sanitizeFilename(value = '') {
  const base = path.basename(String(value || 'upload')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.replace(/^_+/, '').slice(0, 160) || 'upload';
}

function uploadTarget(req) {
  const jobId = sanitizePathSegment(req.body?.jobId || req.query?.jobId || '');
  const category = String(req.body?.category || req.query?.category || '').trim().toLowerCase();
  if (!jobId && !category) return { dir: uploadDir, urlPrefix: '/uploads' };
  if (!jobId) throw new Error('jobId is required for job photo uploads');
  if (!['before', 'after'].includes(category)) throw new Error('category must be before or after');
  const dir = path.join(uploadDir, 'jobs', jobId, category);
  return { dir, urlPrefix: `/uploads/jobs/${jobId}/${category}` };
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const target = uploadTarget(req);
      fs.mkdirSync(target.dir, { recursive: true });
      cb(null, target.dir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (_req, file, cb) => cb(null, `${timestampForFilename()}-${sanitizeFilename(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();
router.post('/', (req, res) => {
  const handler = upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'photos', maxCount: 10 }
  ]);
  handler(req, res, (error) => {
    if (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Upload failed' });
    }
    const files = Object.values(req.files || {}).flat().map((f) => {
      const relPath = path.relative(uploadDir, f.path).split(path.sep).join('/');
      return {
        filename: f.filename,
        originalName: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        url: `/uploads/${relPath}`
      };
    });
    res.json({ ok: true, files });
  });
});
export default router;
