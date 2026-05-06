// Quote draft persistence helpers (localStorage).
// Extracted from app.js — Phase 13e modular refactor. Loads before app.js.
//
// Pre-load globals required (satisfied by earlier script tags):
//   byId              → public/js/utils/dom.js
//   QUOTE_DRAFT_KEY   → public/js/config.js
//   formToObject      → public/js/quote/quote-flow.js

function saveQuoteDraft() {
  const form = byId('quoteForm');
  if (!form) return;
  localStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(formToObject(form)));
}

function loadQuoteDraft() {
  try {
    return JSON.parse(localStorage.getItem(QUOTE_DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearQuoteDraft() {
  localStorage.removeItem(QUOTE_DRAFT_KEY);
}
