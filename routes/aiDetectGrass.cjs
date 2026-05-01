const express = require('express');
const router = express.Router();
const VISION_URL = process.env.TURFLYNK_VISION_URL || process.env.VISION_SERVICE_URL || 'http://127.0.0.1:4220';
async function proxyVision(req, res) {
  try {
    const upstream = await fetch(`${VISION_URL.replace(/\/$/, '')}/detect-grass`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {})
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Vision service unavailable', detail: err.message, visionUrl: VISION_URL });
  }
}
router.post('/detect-grass', proxyVision);
router.post('/detect', proxyVision);
router.get('/health', async (_req, res) => {
  try { const upstream = await fetch(`${VISION_URL.replace(/\/$/, '')}/health`); const json = await upstream.json().catch(() => ({})); res.status(upstream.status).json({ ok: upstream.ok, vision: json }); }
  catch (err) { res.status(503).json({ ok: false, error: 'Vision service unavailable', detail: err.message, visionUrl: VISION_URL }); }
});
module.exports = router;
