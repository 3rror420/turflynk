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

function showToast(message, type = 'info') {
  const layer = byId('toastLayer');
  if (!layer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = String(message || '');
  layer.append(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 180);
  }, 3200);
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
