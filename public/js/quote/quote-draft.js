// Quote draft persistence helpers (sessionStorage).
// Extracted from app.js — Phase 13e modular refactor. Loads before app.js.
//
// Pre-load globals required (satisfied by earlier script tags):
//   byId              → public/js/utils/dom.js
//   QUOTE_DRAFT_KEY   → public/js/config.js
//   formToObject      → public/js/quote/quote-flow.js

function saveQuoteDraft() {
  const form = byId('quoteForm');
  if (!form) return;
  try { localStorage.removeItem(QUOTE_DRAFT_KEY); } catch {}
  sessionStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(formToObject(form)));
}

function loadQuoteDraft() {
  try {
    localStorage.removeItem(QUOTE_DRAFT_KEY);
    return JSON.parse(sessionStorage.getItem(QUOTE_DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearQuoteDraft() {
  try { localStorage.removeItem(QUOTE_DRAFT_KEY); } catch {}
  try { sessionStorage.removeItem(QUOTE_DRAFT_KEY); } catch {}
}
