// public/js/map/toolbar-groups.js
// Manages expand/collapse state of grouped tool panels in the map toolbar.
// Rules:
//  - Only one group may be open at a time (exclusive).
//  - Clicking a toggle opens that group and closes all others.
//  - Clicking outside any open group closes all groups.
//  - syncToolGroups only manages toggle *visibility* — it never auto-opens groups.
// Loaded after app.js — all IDs are already in the DOM.

(function () {
  function isButtonVisible(btn) {
    if (btn.hidden) return false;
    const s = getComputedStyle(btn);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function closeAllGroups() {
    document.querySelectorAll('.tool-group.is-open').forEach(function (g) {
      g.classList.remove('is-open');
    });
  }

  // Only manages toggle visibility; never auto-opens groups.
  function syncToolGroups() {
    document.querySelectorAll('.tool-group').forEach(function (group) {
      const body = group.querySelector('.tool-group-body');
      const toggle = group.querySelector('.tool-group-toggle');
      if (!body || !toggle) return;

      const hasVisible = Array.from(body.querySelectorAll('.btn')).some(isButtonVisible);

      toggle.style.display = hasVisible ? '' : 'none';

      // Auto-close groups whose buttons are all hidden.
      if (!hasVisible) {
        group.classList.remove('is-open');
      }
    });
  }

  // Exclusive toggle: open clicked group, close all others.
  document.addEventListener('click', function (e) {
    const toggle = e.target.closest('.tool-group-toggle');
    if (toggle) {
      const group = toggle.closest('.tool-group');
      if (!group) return;
      const willOpen = !group.classList.contains('is-open');
      closeAllGroups();
      if (willOpen) group.classList.add('is-open');
      e.stopPropagation();
      return;
    }

    // Click outside any open group → close all.
    if (!e.target.closest('.tool-group')) {
      closeAllGroups();
    }
  });

  // Watch for JS-driven visibility changes on toolbar buttons.
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
