// public/js/map/toolbar-groups.js
// Manages expand/collapse state of grouped tool panels in the map toolbar.
// Uses MutationObserver to auto-open groups when their buttons become relevant,
// and auto-close them when all buttons inside are hidden.
// Loaded after app.js — all IDs are already in the DOM.

(function () {
  function isButtonVisible(btn) {
    if (btn.hidden) return false;
    const s = getComputedStyle(btn);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function syncToolGroups() {
    document.querySelectorAll('.tool-group').forEach(function (group) {
      const body = group.querySelector('.tool-group-body');
      const toggle = group.querySelector('.tool-group-toggle');
      if (!body || !toggle) return;

      const hasVisible = Array.from(body.querySelectorAll('.btn')).some(isButtonVisible);

      toggle.style.display = hasVisible ? '' : 'none';

      if (hasVisible) {
        group.classList.add('is-open');
      } else {
        group.classList.remove('is-open');
        delete group.dataset.userClosed;
      }
    });
  }

  // Allow manual toggle of group open/closed state
  document.addEventListener('click', function (e) {
    const toggle = e.target.closest('.tool-group-toggle');
    if (!toggle) return;
    const group = toggle.closest('.tool-group');
    if (!group) return;
    const isOpen = group.classList.toggle('is-open');
    group.dataset.userClosed = isOpen ? '' : '1';
  }, { passive: true });

  // Watch for JS-driven visibility changes on toolbar buttons
  function attachObserver() {
    const panel = document.getElementById('mapToolsPanel');
    if (!panel) return;
    const observer = new MutationObserver(function () {
      requestAnimationFrame(syncToolGroups);
    });
    observer.observe(panel, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
      subtree: true,
    });
    syncToolGroups();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObserver);
  } else {
    attachObserver();
  }
})();
