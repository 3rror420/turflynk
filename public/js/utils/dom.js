// Shared DOM utility helpers — extracted from app.js (Phase 1 modular refactor)
// Must load before app.js. All helpers are plain globals, no module system used.

const byId = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showResult(id, html) {
  const el = byId(id);
  if (!el) return;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function showToast(message, type = 'info', options = {}) {
  const layer = byId('toastLayer');
  if (!layer) return;
  const text = String(message || '').trim();
  if (!text) return;
  const maxVisible = Math.max(1, Number(options.maxVisible || 2));
  const duration = Math.max(1400, Number(options.duration || (type === 'error' ? 5200 : 2800)));
  const duplicate = Array.from(layer.children).find((item) => item.dataset.message === text && item.dataset.type === type);
  if (duplicate) duplicate.remove();
  while (layer.children.length >= maxVisible) {
    layer.firstElementChild?.remove();
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.dataset.message = text;
  toast.dataset.type = type;
  toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
  toast.textContent = text;
  layer.append(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 180);
  }, duration);
}

const showSuccess = (message) => showToast(message, 'success');
const showError = (message) => showToast(message, 'error');
const showWarning = (message) => showToast(message, 'warning');
const showInfo = (message) => showToast(message, 'info');

function card(html) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = html;
  return wrap;
}
