import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import { nanoid } from "nanoid";
import fetch from "node-fetch";
import uploadRoutes from "../routes/upload.js";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const aiDetectGrassRouter = require('./routes/aiDetectGrass.cjs');

const pgdb = require("./db.cjs");

// FIX __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || "TurfLynk";
const DEFAULT_STATE = process.env.DEFAULT_STATE || "AR";
const AR_GIS_FEATURE_LAYER =
  process.env.ARK_GIS_FEATURE_LAYER ||
  "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer";
const ENABLE_LIVE_PARCEL_LOOKUP =
  String(process.env.ENABLE_LIVE_PARCEL_LOOKUP || "true").toLowerCase() === "true";

// Middleware MUST come before API routes
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use('/api/ai', aiDetectGrassRouter);

app.post('/api/ai/refine-mowable', async (req, res) => {
  try {
    const body = req.body || {};
    const mowableFeatures = Array.isArray(body.mowableFeatures)
      ? body.mowableFeatures
      : [];

    const first = mowableFeatures[0];
    const coords = first?.geometry?.coordinates?.[0];

    if (!coords || !coords.length) {
      return res.json({ ok: true, cutouts: [] });
    }

    const xs = coords.map((p) => Number(p[0])).filter(Number.isFinite);
    const ys = coords.map((p) => Number(p[1])).filter(Number.isFinite);

    if (!xs.length || !ys.length) {
      return res.json({ ok: true, cutouts: [] });
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // shift toward house area (top of parcel)
const cx = (minX + maxX) / 2;
const cy = minY + (maxY - minY) * 0.65;

// more realistic house footprint
const w = (maxX - minX) * 0.4;
const h = (maxY - minY) * 0.2;
    const fakeCutout = {
      type: "Feature",
      properties: { kind: "fake_ai_test_cutout" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [cx - w, cy - h],
          [cx + w, cy - h],
          [cx + w, cy + h],
          [cx - w, cy + h],
          [cx - w, cy - h]
        ]]
      }
    };

    res.json({
      ok: true,
      cutouts: [fakeCutout]
    });

  } catch (err) {
    console.error("AI refine test route failed", err);
    res.status(500).json({ ok: false, error: err.message, cutouts: [] });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/upload", uploadRoutes);
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
const defaultSettings = {
  appName: APP_NAME,
  defaultState: DEFAULT_STATE,
  parcelMode: "arkansas-live-plus-manual-fallback",
  mapsMode: "google-address + arkansas-gis-parcel + manual-adjust",
  minimumCutPrice: 38,
  complexityRules: {
    cornerLotUpcharge: 10,
    doubleCornerUpcharge: 18,
    fencedUpcharge: 12,
    obstaclesUpcharge: 10,
    rushJobUpcharge: 15,
    overgrownMultiplier: 1.35,
    slopedTerrainMultiplier: 1.2,
    denseVegetationMultiplier: 1.15,
    limitedAccessUpcharge: 12,
    gateHandlingUpcharge: 6
  },
  services: [],
  regions: []
};

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name || user.fullName || "",
    role: user.role,
    createdAt: user.created_at || user.createdAt || null
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : "";

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    const result = await pgdb.query(
      `
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = $1
      LIMIT 1
      `,
      [token]
    );

    if (!result.rows.length) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    req.user = result.rows[0];
    req.authToken = token;
    next();
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    next();
  };
}

function findRegion(settings, regionId) {
  return (settings.regions || []).find((region) => region.id === regionId) || null;
}

function findService(settings, serviceId) {
  return (settings.services || []).find((service) => service.id === serviceId) || null;
}

async function loadSettingsFromDb() {
  const settingsResult = await pgdb.query(
    "SELECT * FROM app_settings WHERE id = 1 LIMIT 1"
  );
  const servicesResult = await pgdb.query(
    "SELECT * FROM services WHERE active = true ORDER BY sort_order ASC, name ASC"
  );
  const regionsResult = await pgdb.query(
    "SELECT * FROM regions WHERE active = true ORDER BY sort_order ASC, name ASC"
  );

  const row = settingsResult.rows[0] || {};

  return {
    appName: row.app_name || APP_NAME,
    defaultState: row.default_state || DEFAULT_STATE,
    parcelMode: row.parcel_mode || "arkansas-live-plus-manual-fallback",
    mapsMode: row.maps_mode || "google-address + arkansas-gis-parcel + manual-adjust",
    minimumCutPrice: Number(row.minimum_cut_price || 38),
    complexityRules: row.complexity_rules || defaultSettings.complexityRules,
    services: servicesResult.rows.map((s) => ({
      id: s.id,
      name: s.name || "",
      baseFee: Number(s.base_fee || 0),
      ratePer1000Sqft: Number(s.rate_per_1000_sqft || 0),
      minimumPrice: Number(s.minimum_price || 0),
      active: Boolean(s.active),
      sortOrder: Number(s.sort_order || 0)
    })),
    regions: regionsResult.rows.map((r) => ({
      id: r.id,
      name: r.name || "",
      state: r.state || DEFAULT_STATE,
      marketMultiplier: Number(r.market_multiplier || 1),
      travelFee: Number(r.travel_fee || 0),
      minimumJob: Number(r.minimum_job || 0),
      active: Boolean(r.active),
      sortOrder: Number(r.sort_order || 0)
    }))
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function estimateQuote(payload, settings) {
  const service = findService(settings, payload.serviceType) || settings.services[0];
  const region = findRegion(settings, payload.regionId);
  const rules = settings.complexityRules || {};
  const mowAreaSqft = Number(payload.mowAreaSqft || payload.lotAreaSqft || 0);
  const areaUnits = mowAreaSqft > 0 ? mowAreaSqft / 1000 : 0;

  let estimate = Math.max(
    Number(service?.minimumPrice || settings.minimumCutPrice || 0),
    areaUnits * Number(service?.ratePer1000Sqft || 0) + Number(service?.baseFee || 0)
  );

  const regionMinimum = Number(region?.minimumJob || 0);
  if (regionMinimum > 0) estimate = Math.max(estimate, regionMinimum);

  estimate *= Number(region?.marketMultiplier || 1);
  estimate += Number(region?.travelFee || 0);

  const yardType = String(payload.yardType || "standard");

  if (yardType === "open_flat") estimate *= 0.85;
  if (yardType === "tight_cutup") estimate *= 1.25;
  if (yardType === "heavy_trimming") estimate *= 1.35;

  if (payload.propertyType === "corner") estimate += Number(rules.cornerLotUpcharge || 0);
  if (payload.propertyType === "double_corner") estimate += Number(rules.doubleCornerUpcharge || 0);
  if (payload.fenced) estimate += Number(rules.fencedUpcharge || 0);
  if (payload.obstacles) estimate += Number(rules.obstaclesUpcharge || 0);
  if (payload.rushJob) estimate += Number(rules.rushJobUpcharge || 0);
  if (payload.limitedAccess) estimate += Number(rules.limitedAccessUpcharge || 0);
  if (payload.gates) estimate += Number(rules.gateHandlingUpcharge || 0);
  if (payload.overgrown) estimate *= Number(rules.overgrownMultiplier || 1);
  if (payload.slopedTerrain) estimate *= Number(rules.slopedTerrainMultiplier || 1);
  if (payload.denseVegetation) estimate *= Number(rules.denseVegetationMultiplier || 1);

  return Math.round(estimate * 100) / 100;
}

async function fetchLayerQuery(layerId, params) {
  const url = `${AR_GIS_FEATURE_LAYER}/${layerId}/query?${new URLSearchParams({
    ...params,
    f: "json"
  }).toString()}`;

  let response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: { "User-Agent": "TurfLynk/1.3" }
      },
      5000
    );
  } catch (error) {
    return {
      ok: false,
      reason: error.name === "AbortError" ? "remote_timeout" : "remote_fetch_failed",
      error: error.message,
      url
    };
  }

  if (!response.ok) {
    return { ok: false, reason: `remote_http_${response.status}`, url };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, reason: "invalid_remote_json", error: error.message, url };
  }

  if (data?.error) {
    return {
      ok: false,
      reason: `arcgis_${data.error.code || "error"}`,
      error: data.error.message || "ArcGIS query failed",
      details: data.error.details || [],
      url,
      data
    };
  }

  return { ok: true, data, url };
}
function escapeSqlLike(value) {
  return String(value || "").replace(/'/g, "''");
}

function normalizeAddressForQuery(address) {
  return String(address || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bARKANSAS\b/gi, "")
    .replace(/\bAR\b/gi, "")
    .trim();
}

async function lookupParcel(lat, lng, address = "", city = "", zip = "") {
  if (!ENABLE_LIVE_PARCEL_LOOKUP) return { ok: false, reason: "disabled" };

  const attempts = [];
  const outFields = 'parcelid,countyid,countyfips,ownername,adrlabel,adrcity,adrzip5';

  if (lat && lng) {
    const polygonHit = await fetchLayerQuery(6, {
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields,
      returnGeometry: "true"
    });
    attempts.push({ method: "polygon_intersects", ...polygonHit });

    if (polygonHit.ok && Array.isArray(polygonHit.data.features) && polygonHit.data.features.length) {
      return {
        ok: true,
        feature: polygonHit.data.features[0],
        raw: polygonHit.data,
        method: "polygon_intersects"
      };
    }

    const centroidNear = await fetchLayerQuery(0, {
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: "120",
      units: "esriSRUnit_Meter",
      outFields,
      returnGeometry: "true",
      orderByFields: "objectid ASC",
      resultRecordCount: "1"
    });
    attempts.push({ method: "centroid_nearby", ...centroidNear });

    const centroidFeature =
      centroidNear.ok &&
      Array.isArray(centroidNear.data.features) &&
      centroidNear.data.features.length
        ? centroidNear.data.features[0]
        : null;

    const centroidParcelId = centroidFeature?.attributes?.parcelid;

    if (centroidParcelId) {
      const polygonById = await fetchLayerQuery(6, {
        where: `parcelid='${escapeSqlLike(centroidParcelId)}'`,
        outFields,
        returnGeometry: "true",
        resultRecordCount: "1"
      });
      attempts.push({ method: "polygon_by_centroid_parcelid", ...polygonById });

      if (polygonById.ok && Array.isArray(polygonById.data.features) && polygonById.data.features.length) {
        return {
          ok: true,
          feature: polygonById.data.features[0],
          raw: polygonById.data,
          method: "polygon_by_centroid_parcelid"
        };
      }

      return {
        ok: true,
        feature: centroidFeature,
        raw: centroidNear.data,
        method: "centroid_nearby_only"
      };
    }
  }

  const cleanAddress = normalizeAddressForQuery(address);
  if (cleanAddress) {
    const clauses = [`UPPER(adrlabel) LIKE UPPER('%${escapeSqlLike(cleanAddress)}%')`];
    if (city) clauses.push(`UPPER(adrcity) = UPPER('${escapeSqlLike(city)}')`);
    if (zip) clauses.push(`adrzip5 = ${Number(zip) || 0}`);

    const textHit = await fetchLayerQuery(6, {
      where: clauses.join(" AND "),
      outFields,
      returnGeometry: "true",
      orderByFields: "objectid ASC",
      resultRecordCount: "1"
    });
    attempts.push({ method: "address_text_polygon", ...textHit });

    if (textHit.ok && Array.isArray(textHit.data.features) && textHit.data.features.length) {
      return {
        ok: true,
        feature: textHit.data.features[0],
        raw: textHit.data,
        method: "address_text_polygon"
      };
    }
  }

  return { ok: false, reason: "not_found", attempts };
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function normalizeParcelFeature(feature) {
  if (!feature) return null;
  const attrs = feature.attributes || {};
  const acres = firstNumber(
    attrs.CALC_ACRES,
    attrs.calc_acres,
    attrs.ACRE_AREA,
    attrs.acre_area,
    attrs.ACRES,
    attrs.acres,
    attrs.shape_area ? Number(attrs.shape_area) / 4046.8564224 : 0,
    attrs.SHAPE_Area ? Number(attrs.SHAPE_Area) / 4046.8564224 : 0
  );

  const areaSqft = acres > 0 ? Math.round(acres * 43560) : 0;
  const parcelId =
    attrs.parcelid ||
    attrs.parcel_id ||
    attrs.PARCEL_ID ||
    attrs.PIN ||
    attrs.pin ||
    attrs.PARCELID ||
    attrs.OBJECTID ||
    "";

  const county =
    attrs.countyid ||
    attrs.COUNTY ||
    attrs.county ||
    attrs.COUNTY_NAME ||
    attrs.county_name ||
    attrs.adrcity ||
    "";

  return {
    parcelId: String(parcelId || ""),
    county: String(county || ""),
    acres,
    areaSqft,
    attributes: attrs,
    geometry: feature.geometry || null
  };
}

/* -------------------- HEALTH + CONFIG -------------------- */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    port: PORT,
    mode: "arkansas-quote-ready",
    parcelLookup: ENABLE_LIVE_PARCEL_LOOKUP,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/config", async (_req, res) => {
  try {
    const settings = await loadSettingsFromDb();
    res.json({
      ok: true,
      appName: settings.appName,
      settings,
        maps: {
          googleApiKey: process.env.GOOGLE_MAPS_API_KEY || ""
        },
      mapsEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      parcelProvider: ENABLE_LIVE_PARCEL_LOOKUP ? "arkansas-gis-live" : "manual",
      regionCount: (settings.regions || []).length,
      serviceCount: (settings.services || []).length
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/regions", async (_req, res) => {
  try {
    const settings = await loadSettingsFromDb();
    res.json({ ok: true, regions: settings.regions || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/services", async (_req, res) => {
  try {
    const settings = await loadSettingsFromDb();
    res.json({ ok: true, services: settings.services || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/settings", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const settings = await loadSettingsFromDb();
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/settings", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const current = await loadSettingsFromDb();
    const next = { ...current, ...(req.body || {}) };

    await pgdb.query(
      `
      INSERT INTO app_settings (
        id, app_name, default_state, parcel_mode, maps_mode, minimum_cut_price, complexity_rules, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (id) DO UPDATE SET
        app_name = EXCLUDED.app_name,
        default_state = EXCLUDED.default_state,
        parcel_mode = EXCLUDED.parcel_mode,
        maps_mode = EXCLUDED.maps_mode,
        minimum_cut_price = EXCLUDED.minimum_cut_price,
        complexity_rules = EXCLUDED.complexity_rules,
        updated_at = NOW()
      `,
      [
        1,
        next.appName || APP_NAME,
        next.defaultState || DEFAULT_STATE,
        next.parcelMode || "arkansas-live-plus-manual-fallback",
        next.mapsMode || "google-address + arkansas-gis-parcel + manual-adjust",
        Number(next.minimumCutPrice || 38),
        next.complexityRules || defaultSettings.complexityRules
      ]
    );

    res.json({ ok: true, settings: await loadSettingsFromDb() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/services/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await pgdb.query(
      `
      UPDATE services
      SET
        name = COALESCE($2, name),
        base_fee = COALESCE($3, base_fee),
        rate_per_1000_sqft = COALESCE($4, rate_per_1000_sqft),
        minimum_price = COALESCE($5, minimum_price),
        active = COALESCE($6, active),
        sort_order = COALESCE($7, sort_order),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        req.params.id,
        body.name ?? null,
        body.baseFee != null ? Number(body.baseFee) : null,
        body.ratePer1000Sqft != null ? Number(body.ratePer1000Sqft) : null,
        body.minimumPrice != null ? Number(body.minimumPrice) : null,
        body.active != null ? Boolean(body.active) : null,
        body.sortOrder != null ? Number(body.sortOrder) : null
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Service not found" });
    }

    const row = result.rows[0];
    res.json({
      ok: true,
      service: {
        id: row.id,
        name: row.name || "",
        baseFee: Number(row.base_fee || 0),
        ratePer1000Sqft: Number(row.rate_per_1000_sqft || 0),
        minimumPrice: Number(row.minimum_price || 0),
        active: Boolean(row.active),
        sortOrder: Number(row.sort_order || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/regions/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await pgdb.query(
      `
      UPDATE regions
      SET
        name = COALESCE($2, name),
        state = COALESCE($3, state),
        market_multiplier = COALESCE($4, market_multiplier),
        travel_fee = COALESCE($5, travel_fee),
        minimum_job = COALESCE($6, minimum_job),
        active = COALESCE($7, active),
        sort_order = COALESCE($8, sort_order),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        req.params.id,
        body.name ?? null,
        body.state ?? null,
        body.marketMultiplier != null ? Number(body.marketMultiplier) : null,
        body.travelFee != null ? Number(body.travelFee) : null,
        body.minimumJob != null ? Number(body.minimumJob) : null,
        body.active != null ? Boolean(body.active) : null,
        body.sortOrder != null ? Number(body.sortOrder) : null
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Region not found" });
    }

    const row = result.rows[0];
    res.json({
      ok: true,
      region: {
        id: row.id,
        name: row.name || "",
        state: row.state || DEFAULT_STATE,
        marketMultiplier: Number(row.market_multiplier || 1),
        travelFee: Number(row.travel_fee || 0),
        minimumJob: Number(row.minimum_job || 0),
        active: Boolean(row.active),
        sortOrder: Number(row.sort_order || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/estimate", async (req, res) => {
  try {
    const settings = await loadSettingsFromDb();
    const estimate = estimateQuote(req.body || {}, settings);
    res.json({ ok: true, estimate });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/parcel/lookup", async (req, res) => {
  try {
    const lat = Number(req.query.lat || 0);
    const lng = Number(req.query.lng || 0);
    const result = await lookupParcel(
      lat,
      lng,
      String(req.query.address || ""),
      String(req.query.city || ""),
      String(req.query.zip || "")
    );

    if (result.ok && result.feature) {
      result.normalized = normalizeParcelFeature(result.feature);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- AUTH -------------------- */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }

    const allowedRoles = new Set(["customer", "provider"]);
    const safeRole = allowedRoles.has(role) ? role : "customer";

    const result = await pgdb.query(
      `
      INSERT INTO users (id, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, full_name, role, created_at
      `,
      [nanoid(10), String(email).toLowerCase().trim(), hashPassword(password), fullName || "", safeRole]
    );

    res.status(201).json({
      ok: true,
      user: sanitizeUser(result.rows[0])
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ ok: false, error: "User already exists" });
    }
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    const result = await pgdb.query(
      "SELECT * FROM users WHERE email = $1 LIMIT 1",
      [String(email || "").toLowerCase().trim()]
    );

    const user = result.rows[0];

    if (!user || user.password_hash !== hashPassword(password || "")) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    const token = nanoid(32);

    await pgdb.query(
      "INSERT INTO sessions (token, user_id) VALUES ($1, $2)",
      [token, user.id]
    );

    res.json({
      ok: true,
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: sanitizeUser(req.user)
  });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    await pgdb.query("DELETE FROM sessions WHERE token = $1", [req.authToken]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- PROVIDERS (still JSON-backed for now) -------------------- */

app.get("/api/providers", async (_req, res) => {
  try {
    const result = await pgdb.query(`
      SELECT
        pp.id,
        pp.user_id,
        u.full_name,
        u.email,
        pp.business_name,
        pp.bio,
        pp.equipment,
        pp.phone,
        pp.rating_avg,
        pp.rating_count,
        pp.created_at,
        pr.base_fee,
        pr.rate_per_1000_sqft,
        pr.minimum_price
      FROM provider_profiles pp
      JOIN users u ON u.id = pp.user_id
      LEFT JOIN provider_pricing pr ON pr.provider_id = pp.id
      ORDER BY pp.created_at DESC
    `);

    const providers = result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      ownerName: row.full_name || "",
      email: row.email,
      businessName: row.business_name || "",
      bio: row.bio || "",
      equipment: row.equipment || "",
      phone: row.phone || "",
      rating: Number(row.rating_avg || 5),
      ratingCount: Number(row.rating_count || 0),
      pricing: {
        baseFee: Number(row.base_fee || 0),
        ratePer1000Sqft: Number(row.rate_per_1000_sqft || 0),
        minimumPrice: Number(row.minimum_price || 0)
      },
      createdAt: row.created_at
    }));

    res.json({ ok: true, providers });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/providers", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const body = req.body || {};

    const existing = await pgdb.query(
      "SELECT id FROM provider_profiles WHERE user_id = $1 LIMIT 1",
      [req.user.id]
    );

    if (existing.rows.length) {
      return res.status(400).json({ ok: false, error: "Provider profile already exists for this user" });
    }

    const providerId = nanoid(10);

    const providerResult = await pgdb.query(
      `
      INSERT INTO provider_profiles (
        id,
        user_id,
        business_name,
        bio,
        equipment,
        phone
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        providerId,
        req.user.id,
        body.businessName || "",
        body.bio || "",
        body.equipment || "",
        body.phone || ""
      ]
    );

    const pricingId = nanoid(10);

    await pgdb.query(
      `
      INSERT INTO provider_pricing (
        id,
        provider_id,
        base_fee,
        rate_per_1000_sqft,
        minimum_price
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        pricingId,
        providerId,
        Number(body.pricing?.baseFee || 0),
        Number(body.pricing?.ratePer1000Sqft || 0),
        Number(body.pricing?.minimumPrice || 0)
      ]
    );

    res.status(201).json({
      ok: true,
      provider: {
        id: providerResult.rows[0].id,
        userId: providerResult.rows[0].user_id,
        businessName: providerResult.rows[0].business_name,
        bio: providerResult.rows[0].bio,
        equipment: providerResult.rows[0].equipment,
        phone: providerResult.rows[0].phone,
        pricing: {
          baseFee: Number(body.pricing?.baseFee || 0),
          ratePer1000Sqft: Number(body.pricing?.ratePer1000Sqft || 0),
          minimumPrice: Number(body.pricing?.minimumPrice || 0)
        },
        createdAt: providerResult.rows[0].created_at
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- JOBS (PostgreSQL-backed) -------------------- */

function mapJobRow(row) {
  return {
    id: row.id,
    customerUserId: row.customer_user_id,
    providerUserId: row.provider_user_id,
    title: row.title || "",
    address: row.address || "",
    city: row.city || "",
    state: row.state || "",
    zip: row.zip || "",
    regionId: row.region_id || "",
    budget: Number(row.budget || 0),
    serviceType: row.service_type || "mowing",
    preferredDate: row.preferred_date || null,
    details: row.details || "",
    photos: parseJsonArray(row.photos),
    status: row.status || "open",
    postedAt: row.created_at
  };
}

app.get("/api/jobs", requireAuth, async (req, res) => {
  try {
    let result;

    if (req.user.role === "admin") {
      result = await pgdb.query(
        `
        SELECT *
        FROM jobs
        ORDER BY created_at DESC
        `
      );
    } else if (req.user.role === "provider") {
      result = await pgdb.query(
        `
        SELECT *
        FROM jobs
        WHERE provider_user_id IS NULL OR provider_user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );
    } else {
      result = await pgdb.query(
        `
        SELECT *
        FROM jobs
        WHERE customer_user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );
    }

    const jobs = result.rows.map((row) => ({
      id: row.id,
      customerUserId: row.customer_user_id,
      providerUserId: row.provider_user_id,
      title: row.title || "",
      address: row.address || "",
      city: row.city || "",
      state: row.state || "",
      zip: row.zip || "",
      regionId: row.region_id || "",
      budget: Number(row.budget || 0),
      serviceType: row.service_type || "mowing",
      preferredDate: row.preferred_date || null,
      details: row.details || "",
      photos: parseJsonArray(row.photos),
      status: row.status || "open",
      postedAt: row.created_at
    }));

    res.json({ ok: true, jobs });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};

    const result = await pgdb.query(
      `
      INSERT INTO jobs (
        id,
        customer_user_id,
        provider_user_id,
        title,
        address,
        city,
        state,
        zip,
        region_id,
        budget,
        service_type,
        preferred_date,
        details,
        photos,
        status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      RETURNING *
      `,
      [
        nanoid(10),
        req.user.id,
        body.providerUserId || null,
        body.title || "",
        body.address || "",
        body.city || "",
        body.state || DEFAULT_STATE,
        body.zip || "",
        body.regionId || "",
        Number(body.budget || 0),
        body.serviceType || "mowing",
        body.preferredDate || null,
        body.details || "",
        JSON.stringify(Array.isArray(body.photos) ? body.photos : []),
        "open"
      ]
    );

    const row = result.rows[0];

    res.status(201).json({
      ok: true,
      job: {
        id: row.id,
        customerUserId: row.customer_user_id,
        providerUserId: row.provider_user_id,
        title: row.title || "",
        address: row.address || "",
        city: row.city || "",
        state: row.state || "",
        zip: row.zip || "",
        regionId: row.region_id || "",
        budget: Number(row.budget || 0),
        serviceType: row.service_type || "mowing",
        preferredDate: row.preferred_date || null,
        details: row.details || "",
        photos: parseJsonArray(row.photos),
        status: row.status || "open",
        postedAt: row.created_at
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/jobs/:id/claim", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const result = await pgdb.query(
      `
      UPDATE jobs
      SET provider_user_id = $1, status = 'claimed'
      WHERE id = $2
        AND (provider_user_id IS NULL)
      RETURNING *
      `,
      [req.user.id, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(400).json({ ok: false, error: "Job already claimed or not found" });
    }

    res.json({ ok: true, job: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/jobs/:id/status", requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowedStatuses = new Set(["open", "claimed", "in_progress", "completed", "cancelled"]);

    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    let result;

    if (req.user.role === "admin") {
      result = await pgdb.query(
        `
        UPDATE jobs
        SET status = $1
        WHERE id = $2
        RETURNING *
        `,
        [status, req.params.id]
      );
    } else if (req.user.role === "provider") {
      result = await pgdb.query(
        `
        UPDATE jobs
        SET status = $1
        WHERE id = $2
          AND provider_user_id = $3
        RETURNING *
        `,
        [status, req.params.id, req.user.id]
      );
    } else {
      result = await pgdb.query(
        `
        UPDATE jobs
        SET status = $1
        WHERE id = $2
          AND customer_user_id = $3
        RETURNING *
        `,
        [status, req.params.id, req.user.id]
      );
    }

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found or not allowed" });
    }

    res.json({ ok: true, job: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- QUOTES (PostgreSQL-backed) -------------------- */

app.get("/api/quotes", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const result = await pgdb.query(
      "SELECT * FROM quotes ORDER BY created_at DESC"
    );
    res.json({ ok: true, quotes: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/quotes", async (req, res) => {
  try {
    const body = req.body || {};
    const settings = await loadSettingsFromDb();
    const estimate = estimateQuote(body, settings);

    const quote = {
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      name: body.name || "",
      phone: body.phone || "",
      email: body.email || "",
      serviceType: body.serviceType || "mowing",
      regionId: body.regionId || "",
      address: body.address || "",
      city: body.city || "",
      state: body.state || DEFAULT_STATE,
      zip: body.zip || "",
      lotSource: body.lotSource || "manual",
      lotAreaSqft: Number(body.lotAreaSqft || 0),
      mowAreaSqft: Number(body.mowAreaSqft || 0),
      propertyType: body.propertyType || "standard",
      fenced: Boolean(body.fenced),
      overgrown: Boolean(body.overgrown),
      obstacles: Boolean(body.obstacles),
      rushJob: Boolean(body.rushJob),
      limitedAccess: Boolean(body.limitedAccess),
      slopedTerrain: Boolean(body.slopedTerrain),
      denseVegetation: Boolean(body.denseVegetation),
      gates: Boolean(body.gates),
      parcelId: body.parcelId || "",
      notes: body.notes || "",
      estimate,
      status: "new"
    };

    await pgdb.query(
      `
      INSERT INTO quotes (
        id,
        created_at,
        name,
        phone,
        email,
        service_type,
        region_id,
        address,
        city,
        state,
        zip,
        lot_source,
        lot_area_sqft,
        mow_area_sqft,
        property_type,
        fenced,
        overgrown,
        obstacles,
        rush_job,
        limited_access,
        sloped_terrain,
        dense_vegetation,
        gates,
        parcel_id,
        notes,
        estimate,
        status,
        customer_user_id
       )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
      )
      `,
      [
        quote.id,
        quote.createdAt,
        quote.name,
        quote.phone,
        quote.email,
        quote.serviceType,
        quote.regionId,
        quote.address,
        quote.city,
        quote.state,
        quote.zip,
        quote.lotSource,
        quote.lotAreaSqft,
        quote.mowAreaSqft,
        quote.propertyType,
        quote.fenced,
        quote.overgrown,
        quote.obstacles,
        quote.rushJob,
        quote.limitedAccess,
        quote.slopedTerrain,
        quote.denseVegetation,
        quote.gates,
        quote.parcelId,
        quote.notes,
        quote.estimate,
        quote.status,
        null
      ]
    );

    res.status(201).json({ ok: true, quote });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/quotes/:id/convert-to-job", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const quoteId = req.params.id;
    const body = req.body || {};

    const quoteResult = await pgdb.query(
      "SELECT * FROM quotes WHERE id = $1 LIMIT 1",
      [quoteId]
    );

    if (!quoteResult.rows.length) {
      return res.status(404).json({ ok: false, error: "Quote not found" });
    }

    const quote = quoteResult.rows[0];

    if (quote.converted_to_job_id) {
      const existingJob = await pgdb.query(
        "SELECT * FROM jobs WHERE id = $1 LIMIT 1",
        [quote.converted_to_job_id]
      );

      return res.json({
        ok: true,
        alreadyConverted: true,
        quote,
        job: existingJob.rows[0] ? mapJobRow(existingJob.rows[0]) : null
      });
    }

    let customerUserId = quote.customer_user_id || null;

    if (!customerUserId && quote.email) {
      const existingUser = await pgdb.query(
        "SELECT id FROM users WHERE email = $1 LIMIT 1",
        [String(quote.email).toLowerCase().trim()]
      );
      if (existingUser.rows.length) {
        customerUserId = existingUser.rows[0].id;
      }
    }

    if (!customerUserId && quote.email) {
      const newUserId = nanoid(10);
      const tempPassword = body.tempPassword || nanoid(12);

      const insertedUser = await pgdb.query(
        `
        INSERT INTO users (id, email, password_hash, full_name, role)
        VALUES ($1, $2, $3, $4, 'customer')
        RETURNING id
        `,
        [
          newUserId,
          String(quote.email).toLowerCase().trim(),
          hashPassword(tempPassword),
          quote.name || ""
        ]
      );

      customerUserId = insertedUser.rows[0].id;
    }

    const serviceLabel = String(quote.service_type || "mowing")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());

    const jobId = nanoid(10);

    const detailsParts = [
      quote.notes ? `Quote notes: ${quote.notes}` : "",
      quote.parcel_id ? `Parcel ID: ${quote.parcel_id}` : "",
      quote.lot_source ? `Lot source: ${quote.lot_source}` : "",
      Number(quote.lot_area_sqft || 0) > 0 ? `Lot area sqft: ${Number(quote.lot_area_sqft)}` : "",
      Number(quote.mow_area_sqft || 0) > 0 ? `Mow area sqft: ${Number(quote.mow_area_sqft)}` : "",
      quote.property_type ? `Property type: ${quote.property_type}` : "",
      quote.fenced ? "Fenced: yes" : "",
      quote.overgrown ? "Overgrown: yes" : "",
      quote.obstacles ? "Obstacles: yes" : "",
      quote.rush_job ? "Rush job: yes" : "",
      quote.limited_access ? "Limited access: yes" : "",
      quote.sloped_terrain ? "Sloped terrain: yes" : "",
      quote.dense_vegetation ? "Dense vegetation: yes" : "",
      quote.gates ? "Gates: yes" : ""
    ].filter(Boolean);

    const jobResult = await pgdb.query(
      `
      INSERT INTO jobs (
        id,
        customer_user_id,
        provider_user_id,
        title,
        address,
        city,
        state,
        zip,
        region_id,
        budget,
        service_type,
        preferred_date,
        details,
        photos,
        status
      )
      VALUES (
        $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, 'open'
      )
      RETURNING *
      `,
      [
        jobId,
        customerUserId,
        body.title || `${serviceLabel} service`,
        quote.address || "",
        quote.city || "",
        quote.state || DEFAULT_STATE,
        quote.zip || "",
        quote.region_id || "",
        Number(quote.estimate || 0),
        quote.service_type || "mowing",
        detailsParts.join("\n"),
        JSON.stringify([])
      ]
    );

    await pgdb.query(
      `
      UPDATE quotes
      SET
        customer_user_id = COALESCE($2, customer_user_id),
        converted_to_job_id = $3,
        converted_at = NOW(),
        status = 'converted'
      WHERE id = $1
      `,
      [quote.id, customerUserId, jobId]
    );

    const updatedQuote = await pgdb.query(
      "SELECT * FROM quotes WHERE id = $1 LIMIT 1",
      [quote.id]
    );

    res.status(201).json({
      ok: true,
      quote: updatedQuote.rows[0],
      job: mapJobRow(jobResult.rows[0])
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ ok: false, error: "Customer account already exists" });
    }
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- JOB CUSTOMER/PROVIDER HELPERS -------------------- */

// Customer: their own bookings (no role restriction — any logged-in user sees their jobs)
app.get("/api/jobs/my", requireAuth, async (req, res) => {
  try {
    const result = await pgdb.query(
      "SELECT * FROM jobs WHERE customer_user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json({ ok: true, jobs: result.rows.map(mapJobRow) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Open jobs: no auth required so providers can browse without an account
app.get("/api/jobs/open", async (_req, res) => {
  try {
    const result = await pgdb.query(
      "SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT 50"
    );
    res.json({ ok: true, jobs: result.rows.map(mapJobRow) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Provider accepts an open job → status becomes "assigned"
app.post("/api/jobs/:id/accept", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const result = await pgdb.query(
      `UPDATE jobs
       SET provider_user_id = $1, status = 'assigned'
       WHERE id = $2 AND status = 'open' AND provider_user_id IS NULL
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ ok: false, error: "Job not available or already accepted" });
    }
    res.json({ ok: true, job: mapJobRow(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- ADMIN -------------------- */

app.get("/api/admin/overview", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const providerCount = await pgdb.query(
      "SELECT COUNT(*) FROM provider_profiles"
    );

    const quoteCount = await pgdb.query(
      "SELECT COUNT(*) FROM quotes"
    );

    const revenueResult = await pgdb.query(
      "SELECT COALESCE(SUM(estimate), 0) AS total FROM quotes"
    );

    const latestQuotes = await pgdb.query(
      "SELECT * FROM quotes ORDER BY created_at DESC LIMIT 6"
    );

    const quotesByRegion = await pgdb.query(
      `
      SELECT region_id, COUNT(*) as count
      FROM quotes
      GROUP BY region_id
      `
    );

    const openJobs = await pgdb.query(
      "SELECT COUNT(*) FROM jobs WHERE status = 'open'"
    );

    const latestJobs = await pgdb.query(
      "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 6"
    );

    const byRegion = {};
    for (const row of quotesByRegion.rows) {
      byRegion[row.region_id || "unassigned"] = Number(row.count);
    }

    res.json({
      ok: true,
      metrics: {
        totalQuotes: Number(quoteCount.rows[0].count),
        openJobs: Number(openJobs.rows[0].count),
        providers: Number(providerCount.rows[0].count),
        revenuePipeline: Number(revenueResult.rows[0].total)
      },
      quoteVolumeByRegion: byRegion,
      latestQuotes: latestQuotes.rows,
      latestJobs: latestJobs.rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- SPA FALLBACK -------------------- */

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on http://0.0.0.0:${PORT}`);
});
