# TurfLynk HTML Partials Architecture

## Overview

This project uses server-side HTML composition via `composeHtml()` in `server/index.js`.

`public/index.html` is a ~165-line shell. All `<!-- PARTIAL:name -->` markers are replaced
with the corresponding file from `public/partials/` before the page is sent to the client.

All partials are injected **before** scripts execute to preserve DOM availability at load time.

---

## Critical Rule

**DO NOT use async loading (fetch, AJAX, client-side includes).**

All DOM must exist synchronously at page load. JavaScript modules in `public/js/` query the DOM
immediately on script evaluation — elements must already exist or queries silently return null,
breaking UI.

---

## Partial Load Order

Partials are injected in the order they appear in `index.html` (top → bottom):

| # | Marker | File | Location in shell |
|---|--------|------|-------------------|
| 1 | `toastLayer` | inline in shell | Top of `<body>` |
| 2 | `PARTIAL:mobile-topbar` | mobile-topbar.html | Top of `<body>`, before app-shell |
| 3 | `PARTIAL:drawer` | drawer.html | After mobile-topbar |
| 4 | `PARTIAL:auth-bar` | auth-bar.html | After drawer |
| 5 | `PARTIAL:auth` | auth.html | After auth-bar |
| 6 | `PARTIAL:sidebar` | sidebar.html | Inside `.app-shell` |
| 7 | `PARTIAL:main-topbar` | main-topbar.html | Inside `.main-shell` |
| 8 | `PARTIAL:account-panel` | account-panel.html | Inside `.main-shell` |
| 9 | `PARTIAL:dashboard-hero` | dashboard-hero.html | Inside dashboard view section |
| 10 | `PARTIAL:quote-panel` | quote-panel.html | Inside `.main-shell` |
| 11 | `PARTIAL:jobs-view` | jobs-view.html | Inside `.main-shell` |
| 12 | `PARTIAL:providers-view` | providers-view.html | Inside `.main-shell` |
| 13 | `PARTIAL:admin-view` | admin-view.html | Inside `.main-shell` |
| 14 | `PARTIAL:footer` | footer.html | Inside `.main-shell` (after admin-view) |
| 15 | `PARTIAL:mobile-nav` | mobile-nav.html | After `.app-shell`, before scripts |
| — | scripts | inline in shell | Bottom of `<body>` |

---

## Partial Descriptions

- **mobile-topbar.html** — Mobile header: view title, auth state label, drawer button
- **drawer.html** — App drawer slide-out + overlay; contains role-conditional nav sections (customer / provider / admin)
- **auth-bar.html** — Compact auth status bar (desktop/tablet)
- **auth.html** — Auth modal (login/register forms) + auth panel overlay
- **sidebar.html** — Desktop left-hand navigation
- **main-topbar.html** — Desktop top header bar
- **account-panel.html** — Logged-in user dashboard: profile, quotes, preferences
- **dashboard-hero.html** — Landing page hero content (above the fold)
- **quote-panel.html** — Full quote flow: address lookup, map draw, AI detection, estimate, checkout (**HIGHLY COUPLED**)
- **jobs-view.html** — Customer jobs/quote history panel
- **providers-view.html** — Provider dashboard: jobs, profile, service areas, settings
- **admin-view.html** — Admin panel: leads, pricing, controls
- **footer.html** — Page footer
- **mobile-nav.html** — Bottom navigation bar (mobile)

---

## High-Risk Sections

Do NOT modify without thorough testing:

| Partial | Risk | Reason |
|---------|------|---------|
| `quote-panel.html` | **CRITICAL** | MapLibre map init, draw tools, AI detect, multi-step state machine, checkout — all tightly coupled to DOM IDs |
| `auth.html` | High | Form bindings and session state wired at script load |
| `drawer.html` | High | Event listeners attached at load time via `data-` attributes |
| `sidebar.html` | High | View routing bindings depend on `data-view` attributes |
| `account-panel.html` | Medium | Account state rendered against specific IDs |

---

## Safe Sections

Content-only; changing text/layout here is low risk:

- `footer.html`
- `dashboard-hero.html`
- `main-topbar.html` (cosmetic changes only)
- `mobile-topbar.html` (cosmetic changes only)

---

## Critical DOM Anchors

These IDs are queried by JavaScript and must not be renamed or removed:

```
quoteForm           quote-panel.html   — main quote form element
quoteMap            quote-panel.html   — MapLibre map container
authPanel           auth.html          — auth overlay panel
accountPanel        account-panel.html — account dashboard panel
providerForm        providers-view.html
regionEditorForm    providers-view.html
toastLayer          index.html (inline) — toast notification container
```

As of Phase 14 audit: **228 unique IDs** present in rendered output. No duplicates.

---

## Script Load Order

Scripts load after all partials. Order is significant — do not reorder:

```
maplibre-gl.js      (CDN) — map engine
proj4.js            (CDN) — coordinate projection
turf.min.js         (CDN) — geospatial helpers

/js/config.js       — app constants
/js/state.js        — global state object
/js/utils/dom.js    — DOM utilities
/js/auth/admin-visibility.js
/js/core/dom.js     — service/config label helpers
/js/core/api.js     — API helper
/js/quote/estimate.js
/js/auth/auth-ui.js
/js/quote/quote-flow.js
/js/quote/quote-draft.js
/js/quote/property-lookup.js
/js/map/map-core.js
/js/map/mow-editor.js
/js/ai/ai-detect.js
/data/local-content.js
/js/jobs/jobs-ui.js
/js/provider/provider-ui.js
/js/admin/admin-ui.js
/js/quote/checkout-request.js
/js/quote/parcel-utils.js
/js/core/content.js
/js/quote/mowable-estimate.js
/js/auth/account-panel.js
/app.js             — main orchestrator
/js/ai-detect-grass.js   — grass AI, loads after app.js
/js/lasso-yard.js        — lasso/draw tool, loads after app.js
```

`ai-detect-grass.js` and `lasso-yard.js` load after `app.js` intentionally — they extend
app globals initialized by app.js.

---

## Adding New UI

1. Add a new partial file: `public/partials/my-feature.html`
2. Add a `<!-- PARTIAL:my-feature -->` marker in `index.html` at the correct DOM position
3. Register the partial in `composeHtml()` in `server/index.js`
4. Keep all IDs unique (verify: `curl -s http://localhost:3000/ | grep -c 'id="'`)
5. Ensure the element exists before any script queries it (scripts run after all partials)
6. **Never** add client-side fetching to inject HTML after page load

---

## Verification Commands

```bash
# ID count (should be 228 after Phase 14; increment as new IDs are added)
curl -s http://localhost:3000/ | grep -c 'id="'

# No PARTIAL markers should leak into rendered output
curl -s http://localhost:3000/ | grep 'PARTIAL:'

# Check for duplicate IDs
curl -s http://localhost:3000/ | grep -oP 'id="[^"]+"' | sort | uniq -d

# Verify script load order
curl -s http://localhost:3000/ | grep '<script'
```
