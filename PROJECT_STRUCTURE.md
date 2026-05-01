# TurfLynk / MowNWA — Project Structure

## Current Layout (after Phase 1 modular refactor)

```
public/
  index.html              — Single-page app HTML; controls script load order
  app.js                  — Main frontend controller (~2400 lines); everything not yet split
  styles.css              — All CSS; not split in Phase 1

  js/
    config.js             — [Phase 1] Shared read-only constants (SERVICE_CATALOG, pricing fields, etc.)
    state.js              — [Phase 1] Shared mutable app state object + QUOTE_STEP_ORDER
    utils/
      dom.js              — [Phase 1] DOM helpers: byId, $$, money, escapeHtml, showResult, showToast, card
    auth/
      admin-visibility.js — [Phase 1] Admin/role visibility: isAdmin, showAdminControls, applyRoleVisibility
    lasso-yard.js         — Lasso draw/edit tool (Leaflet-based); do not touch
    ai-detect-grass.js    — AI grass-detection helper; do not touch

  data/
    local-content.js      — City/area/service SEO content (NWA-focused)

server/
  index.js                — Express server; all API routes, auth, DB queries
  db.cjs                  — PostgreSQL pool (pg)

data/
  settings.json           — Regions + services (JSON fallback when DB unavailable)
  leads.json              — Public lead submissions (no auth required to write)
```

## Script Load Order (index.html)

1. Leaflet, leaflet-draw, proj4, turf (CDN)
2. `/js/config.js` — constants first; no dependencies
3. `/js/state.js` — depends on nothing
4. `/js/utils/dom.js` — depends on nothing (browser globals only)
5. `/js/auth/admin-visibility.js` — depends on state, $$, byId; calls loadAdminLeads/loadAdmin from app.js (safe: only called after all scripts load)
6. `/data/local-content.js` — SEO content
7. `/app.js` — main controller; uses all of the above
8. `/js/ai-detect-grass.js`
9. `/js/lasso-yard.js`

## What Phase 1 Modularized

| Symbol | Moved to |
|--------|----------|
| `byId`, `$$` | `js/utils/dom.js` |
| `money`, `escapeHtml`, `showResult`, `showToast`, `showSuccess/Error/Warning/Info`, `card` | `js/utils/dom.js` |
| `QUOTE_DRAFT_KEY`, `EPSG*`, `PARCEL_FIT_OPTIONS`, `DEFAULT_MAP_*`, `MOWABLE_ESTIMATE_FIELDS`, `SERVICE_CATALOG`, `EXTRA_SERVICE_OPTIONS`, `SERVICE_AREA_OPTIONS`, `AVAILABLE_DAY_OPTIONS`, `AI_PHOTO_PLACEHOLDER`, `INCLUDED/EXCLUDED_MOW_TASKS` | `js/config.js` |
| `state`, `QUOTE_STEP_ORDER` | `js/state.js` |
| `isAdmin`, `showAdminControls`, `hideAdminControls`, `applyRoleVisibility` | `js/auth/admin-visibility.js` |

## What Stayed in app.js

- Leaflet map initialization and all map interaction code
- Parcel lookup (geocoding, ESRI/ArcGIS queries)
- Lasso draw/edit coordination (`currentDrawnMowAreaSqFt`, `stopToolModes`, etc.)
- Turf geometry / intersection calculations
- Estimate calculation (`calcEstimate`, `buildQuotePayload`)
- Stripe / checkout flow (if present)
- Auth modal flow (`showAuthTab`, `showGateTab`, login/register forms, `setAuthToken`)
- Admin data loading (`loadAdmin`, `loadAdminLeads`)
- All form submission handlers (job, provider, lead, live-bid forms)
- View routing (`showView`, `showQuoteFlowStep`)
- All DOMContentLoaded initialization

## What Should Wait for Phase 2

- Split map initialization into `js/map/init.js`
- Split parcel lookup into `js/map/parcel.js`
- Split lasso/draw logic into `js/map/lasso.js`
- Split estimate calculation into `js/quote/estimate.js`
- Split auth flow into `js/auth/modal.js`
- Split admin data loading into `js/admin/data.js`
- Split form handlers into individual modules
- Consider a lightweight event bus to reduce coupling between modules
- CSS splitting (admin.css, map.css, quote.css) — only if required

## Where Key Code Lives

| Feature | File | Notes |
|---------|------|-------|
| Map / parcel draw | `public/app.js` | Leaflet, lasso coordination |
| Lasso tool | `public/js/lasso-yard.js` | Do not touch |
| Admin visibility | `public/js/auth/admin-visibility.js` | isAdmin, applyRoleVisibility |
| Quote math | `public/app.js` | calcEstimate, buildQuotePayload |
| Checkout | `public/app.js` | Stripe redirect if present |
| Config constants | `public/js/config.js` | SERVICE_CATALOG, etc. |
| App state | `public/js/state.js` | state object |
| DOM helpers | `public/js/utils/dom.js` | byId, $$, money, toasts |
| API routes | `server/index.js` | All Express routes |
| DB pool | `server/db.cjs` | PostgreSQL |

## How to Test

```bash
# Syntax check
node --check public/app.js
node --check public/js/config.js
node --check public/js/state.js
node --check public/js/utils/dom.js
node --check public/js/auth/admin-visibility.js

# E2E smoke tests
npm run test:e2e

# Server health
curl http://localhost:3000/health
curl http://localhost:3000/api/config

# Manual checks
# 1. Homepage loads, map appears
# 2. Address lookup returns parcel
# 3. Lasso draw tool works
# 4. Estimate calculates from drawn area (not whole lot)
# 5. Public visitor: admin panels hidden
# 6. Admin login: panels appear, leads load
# 7. POST /api/jobs without auth → 401
# 8. POST /api/leads without auth → accepted (public lead route)
```
