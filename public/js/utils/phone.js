'use strict';

var US_PHONE_MAX_DIGITS = 10;

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function usPhoneDigits(value) {
  return phoneDigits(value).slice(0, US_PHONE_MAX_DIGITS);
}

function formatUsPhoneNumber(value) {
  const digits = usPhoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function usPhoneCursorPosition(value, digitCount) {
  if (!digitCount) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (/\d/.test(value[i])) seen += 1;
    if (seen >= digitCount) return i + 1;
  }
  return value.length;
}

function normalizeUsPhoneInput(input) {
  if (!input) return '';
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
  const digitsBeforeCursor = usPhoneDigits(input.value.slice(0, start)).length;
  const formatted = formatUsPhoneNumber(input.value);
  if (input.value !== formatted) {
    input.value = formatted;
    const nextCursor = usPhoneCursorPosition(formatted, digitsBeforeCursor);
    try {
      input.setSelectionRange(nextCursor, nextCursor);
    } catch {
      // Some browser/input combinations do not allow cursor updates.
    }
  }
  return formatted;
}

function isUsPhoneInput(input) {
  if (!input || input.tagName !== 'INPUT') return false;
  const type = String(input.getAttribute('type') || input.type || '').toLowerCase();
  if (type === 'hidden') return false;
  const autocomplete = String(input.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
  const name = String(input.getAttribute('name') || '').toLowerCase();
  const id = String(input.getAttribute('id') || '').toLowerCase();
  return type === 'tel' || autocomplete.includes('tel') || name.includes('phone') || id.includes('phone');
}

function configureUsPhoneInput(input) {
  input.setAttribute('type', 'tel');
  input.setAttribute('inputmode', 'tel');
  input.setAttribute('autocomplete', 'tel');
}

var usPhoneBoundInputs = window.__usPhoneBoundInputs || new WeakSet();
window.__usPhoneBoundInputs = usPhoneBoundInputs;

function bindUsPhoneInput(input) {
  if (!isUsPhoneInput(input)) return;
  configureUsPhoneInput(input);
  if (usPhoneBoundInputs.has(input)) return;
  usPhoneBoundInputs.add(input);
  input.addEventListener('input', () => normalizeUsPhoneInput(input));
  input.addEventListener('change', () => normalizeUsPhoneInput(input));
  input.addEventListener('blur', () => normalizeUsPhoneInput(input));
  input.addEventListener('focus', () => normalizeUsPhoneInput(input));
  normalizeUsPhoneInput(input);
}

function applyUsPhoneFormatting(root = document) {
  const inputs = [];
  if (isUsPhoneInput(root)) inputs.push(root);
  if (root?.querySelectorAll) inputs.push(...root.querySelectorAll('input'));
  inputs.forEach(bindUsPhoneInput);
}

function initUsPhoneFormatting() {
  applyUsPhoneFormatting(document);
  if (window.__usPhoneFormattingInitialized) return;
  window.__usPhoneFormattingInitialized = true;
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node?.nodeType === Node.ELEMENT_NODE) applyUsPhoneFormatting(node);
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUsPhoneFormatting, { once: true });
} else {
  initUsPhoneFormatting();
}

window.phoneDigits = phoneDigits;
window.usPhoneDigits = usPhoneDigits;
window.formatUsPhoneNumber = formatUsPhoneNumber;
window.normalizeUsPhoneInput = normalizeUsPhoneInput;
window.applyUsPhoneFormatting = applyUsPhoneFormatting;
