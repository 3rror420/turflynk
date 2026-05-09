import dotenv from "dotenv";
import express from "express";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import { nanoid } from "nanoid";
import fetch from "node-fetch";
import uploadRoutes from "../routes/upload.js";
import { sendSms, isE164Phone, maskPhone, getSmsProvider, validateSmsConfig } from "../services/sms.js";
import {
  startPhoneVerification,
  checkPhoneVerification,
  getPhoneVerifyProvider,
  getPhoneVerificationHealth,
  logPhoneVerificationEvent,
  normalizePhoneForVerification
} from "./services/phoneVerifyProvider.js";
import { calculateTerrain } from "./services/terrain/terrainCalculator.js";
import { cacheSize as terrainCacheSize, cacheClear as terrainCacheClear } from "./services/terrain/terrainCache.js";
import { listProviders as listTerrainProviders } from "./services/terrain/terrainProviders/index.js";
import { computeTerrainGuardrail, DEFAULT_TERRAIN_MANUAL_REVIEW_MESSAGE } from "./services/terrain/terrainGuardrail.js";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "fs";

// Load deployment config from the project root even when PM2 starts from another cwd.

function normalizeParcelAreaSqft(attrs = {}) {
  const raw =
    Number(attrs.Shape__Area) ||
    Number(attrs.shape__area) ||
    Number(attrs.SHAPE__AREA) ||
    Number(attrs.area) ||
    0;

  // Arkansas parcel service returns EPSG:26915 meters² here.
  return raw > 0 ? Math.round(raw * 10.7639) : 0;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });
validateSmsConfig();

const require = createRequire(import.meta.url);
const session = require("express-session");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;

let aiDetectGrassRouter = null;
try {
  aiDetectGrassRouter = require('./routes/aiDetectGrass.cjs');
} catch (err) {
  console.warn('AI grass detection route not loaded:', err.message);
}

const pgdb = require("./db.cjs");

const app = express();
import weatherRoutes from "./routes/weather.js";
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || "TurfLynk";
const DEFAULT_STATE = process.env.DEFAULT_STATE || "AR";
const AR_GIS_FEATURE_LAYER =
  process.env.ARK_GIS_FEATURE_LAYER ||
  "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer";
const ENABLE_LIVE_PARCEL_LOOKUP =
  String(process.env.ENABLE_LIVE_PARCEL_LOOKUP || "true").toLowerCase() === "true";
const SITE_MODE = process.env.SITE_MODE || "company";
const SITE_BRAND = process.env.SITE_BRAND || "MowNWA";
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || "mownwa.com";
const PRIMARY_REGION = process.env.PRIMARY_REGION || "nwa";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
const APP_BASE_URL = (process.env.APP_BASE_URL || publicAppOrigin()).replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";
const FACEBOOK_CALLBACK_URL =
  process.env.FACEBOOK_CALLBACK_URL ||
  `${APP_BASE_URL}/api/auth/facebook/callback`;
const FACEBOOK_REQUIRED_CALLBACK_URLS = [
  "https://nwamow.com/api/auth/facebook/callback",
  "https://mownwa.com/api/auth/facebook/callback",
  "https://turflynk.com/api/auth/facebook/callback"
];
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://mownwa.com").replace(/\/+$/, "");
const FACEBOOK_DATA_DELETION_BASE_URL = "https://mownwa.com";
const SESSION_COOKIE_NAME = "turflynk_session";
const OAUTH_STATE_COOKIE_NAME = "turflynk_oauth_state";
const DEFAULT_ALLOWED_APP_HOSTS = [
  "nwamow.com",
  "www.nwamow.com",
  "mownwa.com",
  "www.mownwa.com",
  "turflynk.com",
  "www.turflynk.com"
];

console.info("[Env] FACEBOOK_APP_ID loaded:", Boolean(FACEBOOK_APP_ID));
console.info("[Env] FACEBOOK_APP_SECRET loaded:", Boolean(FACEBOOK_APP_SECRET));
console.info("[Env] APP_BASE_URL:", APP_BASE_URL);

// Load JSON settings as fallback when DB is unavailable
const DATA_DIR = path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const BID_REQUESTS_FILE = path.join(DATA_DIR, "bid_requests.json");
const JOB_PHOTOS_FILE = path.join(DATA_DIR, "job_photos.json");
const PROVIDER_SERVICE_AREAS_FILE = path.join(DATA_DIR, "provider_service_areas.json");
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");
const ACCOUNT_SETUP_TOKENS_FILE = path.join(DATA_DIR, "account_setup_tokens.json");
const FACEBOOK_DATA_DELETION_FILE = path.join(DATA_DIR, "facebook_data_deletion_requests.json");
const TERRAIN_MANUAL_REVIEWS_FILE = path.join(DATA_DIR, "terrain_manual_reviews.json");

function readSettingsFile() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    console.warn("Could not load data/settings.json — using empty defaults");
    return { services: [], regions: [] };
  }
}

let localSettings = readSettingsFile();

function writeSettingsFile(settings) {
  const tmp = SETTINGS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, SETTINGS_FILE);
  localSettings = settings;
}

function readLeads() {
  try {
    return JSON.parse(readFileSync(LEADS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  const tmp = LEADS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(leads, null, 2));
  renameSync(tmp, LEADS_FILE);
}

function readJsonArray(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeJsonArray(file, rows) {
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(rows, null, 2));
  renameSync(tmp, file);
}

function publicAppOrigin() {
  if (process.env.PUBLIC_APP_URL) {
    return String(process.env.PUBLIC_APP_URL).replace(/\/+$/, "");
  }
  if (PUBLIC_DOMAIN) {
    const domain = String(PUBLIC_DOMAIN).replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${domain}`;
  }
  return `http://localhost:${PORT}`;
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function configuredAllowedAppHosts() {
  const envHosts = String(process.env.ALLOWED_APP_HOSTS || process.env.APP_DOMAINS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const configuredHosts = [
    PUBLIC_DOMAIN,
    hostnameFromUrl(APP_BASE_URL),
    hostnameFromUrl(PUBLIC_BASE_URL),
    hostnameFromUrl(FACEBOOK_CALLBACK_URL),
    ...FACEBOOK_REQUIRED_CALLBACK_URLS.map(hostnameFromUrl)
  ]
    .map((host) => String(host || "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0].toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APP_HOSTS, ...configuredHosts, ...envHosts]);
}

function firstForwardedValue(value = "") {
  return String(value || "").split(",")[0].trim();
}

function requestHost(req) {
  return firstForwardedValue(req.headers["x-forwarded-host"] || req.headers.host || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function isLocalAppHost(host = "") {
  const hostname = String(host).split(":")[0].toLowerCase();
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function isAllowedAppHost(host = "") {
  const hostname = String(host).split(":")[0].toLowerCase();
  return isLocalAppHost(hostname) || configuredAllowedAppHosts().has(hostname);
}

function appOriginForRequest(req) {
  const host = requestHost(req);
  if (!host || !isAllowedAppHost(host)) return APP_BASE_URL;
  const protoHeader = firstForwardedValue(req.headers["x-forwarded-proto"]);
  const hostname = host.split(":")[0].toLowerCase();
  const protocol = isLocalAppHost(hostname)
    ? (protoHeader || req.protocol || "http")
    : "https";
  return `${protocol}://${host}`;
}

function facebookCallbackUrlForRequest(req) {
  return `${appOriginForRequest(req)}/api/auth/facebook/callback`;
}

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY || "";
}

function assertStripeTestMode(secretKey) {
  const liveAllowed = String(process.env.STRIPE_ALLOW_LIVE || "false").toLowerCase() === "true";
  if (secretKey && !secretKey.startsWith("sk_test_") && !liveAllowed) {
    throw new Error("Stripe checkout is configured for test mode only. Use an sk_test_ key or set STRIPE_ALLOW_LIVE=true.");
  }
}

function checkoutReturnUrl(status, extraParams = {}) {
  const url = new URL(publicAppOrigin());
  url.searchParams.set("checkout", status);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function accountSetupReturnUrl(token) {
  const url = new URL(publicAppOrigin());
  url.searchParams.set("account_setup", token);
  return url.toString();
}

function verifyStripeWebhookSignature(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) return true;

  const signature = req.headers["stripe-signature"] || "";
  const parts = Object.fromEntries(
    String(signature)
      .split(",")
      .map((part) => part.split("="))
      .filter(([key, value]) => key && value)
  );

  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected || !req.rawBody) return false;

  const payload = `${timestamp}.${req.rawBody.toString("utf8")}`;
  const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const digestBuffer = Buffer.from(digest, "hex");
  return expectedBuffer.length === digestBuffer.length && crypto.timingSafeEqual(expectedBuffer, digestBuffer);
}

function base64UrlDecode(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function parseFacebookSignedRequest(signedRequest) {
  if (!FACEBOOK_APP_SECRET) return null;
  const [encodedSignature, encodedPayload] = String(signedRequest || "").split(".");
  if (!encodedSignature || !encodedPayload) return null;

  const signature = base64UrlDecode(encodedSignature);
  const expectedSignature = crypto
    .createHmac("sha256", FACEBOOK_APP_SECRET)
    .update(encodedPayload)
    .digest();

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(signature, expectedSignature)
  ) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }
}

function safeFacebookDeletionPayload(payload = {}) {
  return {
    user_id: payload.user_id || "",
    algorithm: payload.algorithm || "",
    issued_at: payload.issued_at || null
  };
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateFacebookDeletionConfirmationCode() {
  return crypto.randomBytes(12).toString("hex");
}

async function hasStoredFacebookUserData(facebookUserId) {
  try {
    const tableResult = await pgdb.query("SELECT to_regclass('public.user_auth_providers') AS table_name");
    if (!tableResult.rows[0]?.table_name) return false;
    const result = await pgdb.query(
      `
      SELECT 1
      FROM user_auth_providers
      WHERE provider = 'facebook'
        AND provider_user_id = $1
      LIMIT 1
      `,
      [String(facebookUserId || "")]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.warn("Facebook deletion lookup skipped:", error.message);
    return false;
  }
}

function saveFacebookDataDeletionRequest(payload = {}, hasMatchingUser = false) {
  const confirmationCode = generateFacebookDeletionConfirmationCode();
  const statusUrl = `${FACEBOOK_DATA_DELETION_BASE_URL}/api/facebook/data-deletion/status/${encodeURIComponent(confirmationCode)}`;
  const status = hasMatchingUser ? "pending" : "not_found";
  const record = {
    confirmationCode,
    facebookUserId: String(payload.user_id || ""),
    appScopedUserId: String(payload.user_id || ""),
    status,
    requestedAt: new Date().toISOString(),
    completedAt: status === "not_found" ? new Date().toISOString() : null,
    statusUrl,
    rawPayload: safeFacebookDeletionPayload(payload)
  };

  mkdirSync(DATA_DIR, { recursive: true });
  const records = readJsonArray(FACEBOOK_DATA_DELETION_FILE);
  records.push(record);
  writeJsonArray(FACEBOOK_DATA_DELETION_FILE, records);
  return record;
}

function findFacebookDataDeletionRequest(confirmationCode) {
  const records = readJsonArray(FACEBOOK_DATA_DELETION_FILE);
  return records.find((record) => record.confirmationCode === confirmationCode) || null;
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

if (FACEBOOK_APP_ID && FACEBOOK_APP_SECRET) {
  passport.use(new FacebookStrategy(
    {
      clientID: FACEBOOK_APP_ID,
      clientSecret: FACEBOOK_APP_SECRET,
      callbackURL: FACEBOOK_CALLBACK_URL,
      profileFields: ["id", "displayName", "emails", "photos"],
      passReqToCallback: true
    },
    (req, _accessToken, _refreshToken, profile, done) => {
      req.facebookVerifyCallbackRan = true;
      req.facebookProfilePresent = Boolean(profile?.id);

      const email = profile.emails?.[0]?.value || "";
      const fullName = profile.displayName
        || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(" ")
        || "";
      const avatarUrl = profile.photos?.[0]?.value || profile._json?.picture?.data?.url || "";

      console.info("[Facebook OAuth][Passport] verify callback ran", {
        callbackURL: req.session?.facebookCallbackURL || FACEBOOK_CALLBACK_URL,
        profilePresent: Boolean(profile),
        profileIdPresent: Boolean(profile?.id),
        emailPresent: Boolean(email),
        fullNamePresent: Boolean(fullName),
        avatarUrlPresent: Boolean(avatarUrl)
      });

      if (!profile?.id) {
        return done(new Error("Facebook profile missing id"));
      }

      if (!email) {
        // No email — cannot create a DB record; fall back to raw session user
        console.warn("[Facebook OAuth][Passport] no email in profile; using raw session user");
        return done(null, {
          provider: "facebook",
          facebookId: profile.id,
          displayName: fullName,
          email: "",
          avatarUrl
        });
      }

      // Persist to DB so /api/auth/me can return a proper sanitized user with fullName + role
      findOrCreateUserForOAuth({
        provider: "facebook",
        providerUserId: profile.id,
        email,
        fullName,
        avatarUrl
      }).then((dbUser) => {
        done(null, dbUser);
      }).catch((err) => {
        console.warn("[Facebook OAuth][Passport] DB upsert failed; falling back to raw session user", err.message);
        done(null, { provider: "facebook", facebookId: profile.id, displayName: fullName, email, avatarUrl });
      });
    }
  ));
} else {
  console.warn("Facebook Login is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to enable it.");
}

// Middleware MUST come before API routes
app.use(cors());
app.use(express.json({
  limit: "25mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use("/api/weather", weatherRoutes);
app.use(express.urlencoded({ extended: false, limit: "25mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "mownwa-development-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));
app.use(passport.initialize());
app.use(passport.session());

if (aiDetectGrassRouter) {
  app.use('/api/ai/detect-grass', aiDetectGrassRouter);
}

function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

const SQFT_PER_SQM = 10.76391041671;
const EARTH_RADIUS_M = 6378137;
const AI_MOWABLE_FALLBACK_MESSAGE = "AI detection is not confident enough yet. Use Lasso Yard to quickly outline the mowable grass area.";
const DEFAULT_SATELLITE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function toRadians(degrees) {
  return Number(degrees) * Math.PI / 180;
}

function isFiniteLngLatPair(pair) {
  return (
    Array.isArray(pair) &&
    pair.length >= 2 &&
    Number.isFinite(Number(pair[0])) &&
    Number.isFinite(Number(pair[1]))
  );
}

function closeRingIfNeeded(ring) {
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every(isFiniteLngLatPair)) return null;
  const normalized = ring.map((pair) => [Number(pair[0]), Number(pair[1])]);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    normalized.push([first[0], first[1]]);
  }
  return normalized.length >= 4 ? normalized : null;
}

function normalizePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return null;
  const rings = coordinates.map(closeRingIfNeeded).filter(Boolean);
  return rings.length ? rings : null;
}

function normalizeMowableGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;

  if (geometry.type === "Polygon") {
    const coordinates = normalizePolygonCoordinates(geometry.coordinates);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }

  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const coordinates = geometry.coordinates
      .map(normalizePolygonCoordinates)
      .filter(Boolean);
    return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
  }

  return null;
}

function normalizeMowableFeature(value, properties = {}) {
  if (!value || typeof value !== "object") return null;
  const feature = value.type === "Feature"
    ? value
    : { type: "Feature", properties: {}, geometry: value };
  const geometry = normalizeMowableGeometry(feature.geometry);
  if (!geometry) return null;
  return {
    type: "Feature",
    properties: {
      ...(feature.properties || {}),
      ...properties
    },
    geometry
  };
}

function featuresFromGeoJson(value, properties = {}) {
  if (!value || typeof value !== "object") return [];
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    return value.features
      .map((feature) => normalizeMowableFeature(feature, properties))
      .filter(Boolean);
  }
  const feature = normalizeMowableFeature(value, properties);
  return feature ? [feature] : [];
}

function ringAreaSqm(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area += (toRadians(lng2) - toRadians(lng1)) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return (area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

function polygonAreaSqm(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return 0;
  const outer = Math.abs(ringAreaSqm(coordinates[0]));
  const holes = coordinates.slice(1).reduce((sum, ring) => sum + Math.abs(ringAreaSqm(ring)), 0);
  return Math.max(0, outer - holes);
}

function geometryAreaSqft(geometry) {
  if (!geometry) return 0;
  if (geometry.type === "Polygon") return polygonAreaSqm(geometry.coordinates) * SQFT_PER_SQM;
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaSqm(polygon), 0) * SQFT_PER_SQM;
  }
  return 0;
}

function featureCollectionAreaSqft(collection) {
  return Math.round((collection?.features || []).reduce((sum, feature) => {
    return sum + geometryAreaSqft(feature.geometry);
  }, 0));
}

function coordinatePairsFromGeometry(geometry) {
  const pairs = [];
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (isFiniteLngLatPair(value)) {
      pairs.push([Number(value[0]), Number(value[1])]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return pairs;
}

function geometryBbox(geometry) {
  const pairs = coordinatePairsFromGeometry(geometry);
  if (!pairs.length) return null;
  return pairs.reduce((bbox, [lng, lat]) => {
    bbox[0] = Math.min(bbox[0], lng);
    bbox[1] = Math.min(bbox[1], lat);
    bbox[2] = Math.max(bbox[2], lng);
    bbox[3] = Math.max(bbox[3], lat);
    return bbox;
  }, [Infinity, Infinity, -Infinity, -Infinity]);
}

function featureCollectionBbox(collection) {
  const boxes = (collection?.features || [])
    .map((feature) => geometryBbox(feature.geometry))
    .filter(Boolean);
  if (!boxes.length) return null;
  return boxes.reduce((bbox, box) => {
    bbox[0] = Math.min(bbox[0], box[0]);
    bbox[1] = Math.min(bbox[1], box[1]);
    bbox[2] = Math.max(bbox[2], box[2]);
    bbox[3] = Math.max(bbox[3], box[3]);
    return bbox;
  }, [Infinity, Infinity, -Infinity, -Infinity]);
}

function bboxesApproximatelyEqual(a, b) {
  if (!a || !b) return false;
  const span = Math.max(Math.abs(a[2] - a[0]), Math.abs(a[3] - a[1]), Math.abs(b[2] - b[0]), Math.abs(b[3] - b[1]), 0.000001);
  const tolerance = Math.max(span * 0.02, 0.000001);
  return a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
}

function featureCollectionsApproximatelyEqual(a, b, aAreaSqft, bAreaSqft) {
  if (!aAreaSqft || !bAreaSqft) return false;
  const ratio = aAreaSqft / bAreaSqft;
  return ratio >= 0.95 && ratio <= 1.05 && bboxesApproximatelyEqual(featureCollectionBbox(a), featureCollectionBbox(b));
}

function bboxSimilarity(a, b) {
  if (!a || !b) return 0;
  const span = Math.max(Math.abs(b[2] - b[0]), Math.abs(b[3] - b[1]), 0.000001);
  const edgeError = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / (span * 4);
  return Math.max(0, Math.min(1, 1 - edgeError));
}

function parcelBoundarySimilarity(collection, parcelCollection, detectedAreaSqft, parcelAreaSqft) {
  if (!collection || !parcelCollection || !detectedAreaSqft || !parcelAreaSqft) return 0;
  const ratio = detectedAreaSqft / parcelAreaSqft;
  const areaSimilarity = Math.max(0, Math.min(1, 1 - Math.abs(1 - ratio)));
  const boxSimilarity = bboxSimilarity(featureCollectionBbox(collection), featureCollectionBbox(parcelCollection));
  return Math.max(0, Math.min(1, (areaSimilarity * 0.65) + (boxSimilarity * 0.35)));
}

function geometryHasInteriorRings(geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 1;
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).some((polygon) => Array.isArray(polygon) && polygon.length > 1);
  }
  return false;
}

function detectionExclusionEvidence(normalized, visionDiagnostics = {}, detectedRatio = 0, boundarySimilarity = 0) {
  const rejectedComponents = Array.isArray(visionDiagnostics.rejectedComponents) ? visionDiagnostics.rejectedComponents : [];
  const removedComponents = rejectedComponents.length > 0;
  const holes = (normalized?.features || []).some((feature) => geometryHasInteriorRings(feature.geometry));
  const reducedArea = detectedRatio > 0 && detectedRatio <= 0.92 && boundarySimilarity < 0.95;
  const hardscapeExcluded = Number(visionDiagnostics.hardscapePixels || 0) > 0
    || Number(visionDiagnostics.hardscapeExcludedAreaSqft || 0) > 0;
  const hardscapeExcludedAreaSqft = Number(visionDiagnostics.hardscapeExcludedAreaSqft || 0);
  const parcelAreaSqft = Number(visionDiagnostics.parcelAreaSqft || 0);
  const hardscapeExcludedRatio = parcelAreaSqft > 0 ? hardscapeExcludedAreaSqft / parcelAreaSqft : 0;
  const strong = Boolean(
    holes
    || hardscapeExcludedAreaSqft >= Math.max(250, parcelAreaSqft * 0.04)
    || hardscapeExcludedRatio >= 0.06
  );
  return {
    present: Boolean(removedComponents || holes || reducedArea || hardscapeExcluded),
    strong,
    holes,
    removedComponents,
    reducedArea,
    hardscapeExcluded,
    hardscapeExcludedAreaSqft: Number.isFinite(hardscapeExcludedAreaSqft) ? hardscapeExcludedAreaSqft : 0,
    hardscapeExcludedRatio: Number.isFinite(hardscapeExcludedRatio) ? Number(hardscapeExcludedRatio.toFixed(4)) : 0
  };
}

function aiDetectionPresetForParcel(parcelAreaSqft) {
  const area = Number(parcelAreaSqft || 0);
  if (area > 0 && area < 12000) return "small_residential";
  if (area > 0 && area < 43560) return "medium_residential";
  return "large_rural";
}

function normalizeAiDetectionPreset(value, parcelAreaSqft) {
  const preset = String(value || "").trim();
  if (["small_residential", "medium_residential", "large_rural"].includes(preset)) return preset;
  return aiDetectionPresetForParcel(parcelAreaSqft);
}

function aiPresetGuardrailThresholds(detectionPreset) {
  if (detectionPreset === "small_residential") {
    return { highRatioNeedsEvidence: 0.80, hardRatioLimit: 0.98, allowLowConfidenceCandidate: false, minimumConfidence: 0.35 };
  }
  if (detectionPreset === "medium_residential") {
    return { highRatioNeedsEvidence: 0.75, hardRatioLimit: 0.93, allowLowConfidenceCandidate: false, minimumConfidence: 0.35 };
  }
  return { highRatioNeedsEvidence: 0.92, hardRatioLimit: 0.97, allowLowConfidenceCandidate: true, minimumConfidence: 0.35 };
}

function fallbackishSource(value) {
  const source = String(value || "").toLowerCase();
  return ["fallback", "parcel", "copy", "placeholder", "draft"].some((token) => source.includes(token));
}

function detectionUsesFallbackSource(result) {
  if (!result) return false;
  if (fallbackishSource(result.source) || fallbackishSource(result.mode)) return true;
  return (result.features || []).some((feature) => {
    const props = feature.properties || {};
    return props.draft === true || fallbackishSource(props.source) || fallbackishSource(props.mode);
  });
}

function numericConfidence(payload = {}) {
  const value = Number(payload.confidenceScore ?? payload.score ?? payload.modelConfidence ?? payload.mowableConfidence ?? payload.diagnostics?.confidenceScore ?? payload.diagnostic?.confidenceScore ?? payload.confidence);
  return Number.isFinite(value) ? value : null;
}

function compactAiDetectDiagnostics(value = {}) {
  const detectedRatio = Number(value.detectedRatio);
  const parcelAreaSqft = Number(value.parcelAreaSqft);
  const detectedAreaSqft = Number(value.detectedAreaSqft);
  const confidence = Number(value.confidenceScore ?? value.confidence);
  const hardscapePixels = Number(value.hardscapePixels);
  const vegetationCandidatePixels = Number(value.vegetationCandidatePixels);
  const hardscapeExcludedAreaSqft = Number(value.hardscapeExcludedAreaSqft);
  const hardscapeExclusionRatio = Number(value.hardscapeExclusionRatio);
  const hardscapeExcludedRatio = Number(value.hardscapeExcludedRatio);
  const remainderAreaSqft = Number(value.remainderAreaSqft);
  const vegetationCandidateAreaSqft = Number(value.vegetationCandidateAreaSqft);
  const finalSelectedAreaSqft = Number(value.finalSelectedAreaSqft);
  const detectionPreset = value.detectionPreset || value.detection_preset || "";
  const vegetationPixels = Number(value.vegetationPixels);
  const polygonCount = Number(value.polygonCount);
  const ndviThreshold = Number(value.ndviThreshold);
  const visibleThreshold = Number(value.visibleThreshold);
  const excessGreenMin = Number(value.excessGreenMin);
  const saturationMin = Number(value.saturationMin);
  const brightnessMin = Number(value.brightnessMin);
  const dynamicBrightnessMin = Number(value.dynamicBrightnessMin);
  const textureScore = Number(value.textureScore);
  const textureThreshold = Number(value.textureThreshold);
  const canopyRejectedPixels = Number(value.canopyRejectedPixels);
  const keptComponentCount = Number(value.keptComponentCount);
  const rejectedSmallComponents = Number(value.rejectedSmallComponents);
  const rejectedWoodsLikeComponents = Number(value.rejectedWoodsLikeComponents);
  const parcelSimilarity = Number(value.parcelBoundarySimilarity ?? value.parcelSimilarity);
  const strictDetectedRatio = Number(value.strictDetectedRatio);
  const softDetectedRatio = Number(value.softDetectedRatio);
  return {
    reason: value.reason || "",
    guardrailReason: value.guardrailReason || value.reason || "",
    detectionPreset,
    thresholds: value.thresholds || value.thresholdsUsed || null,
    highRatioAllowed: value.highRatioAllowed === true,
    parcelBoundarySimilarity: Number.isFinite(parcelSimilarity) ? parcelSimilarity : null,
    exclusionEvidence: value.exclusionEvidence || null,
    parcelAreaSqft: Number.isFinite(parcelAreaSqft) ? parcelAreaSqft : null,
    detectedAreaSqft: Number.isFinite(detectedAreaSqft) ? detectedAreaSqft : null,
    detectedRatio: Number.isFinite(detectedRatio) ? detectedRatio : 0,
    confidence: Number.isFinite(confidence) ? confidence : null,
    confidenceLabel: typeof value.confidence === "string" ? value.confidence : (value.confidenceLabel || null),
    detectionMode: value.detectionMode || value.detection_mode || "",
    detection_mode: value.detection_mode || value.detectionMode || "",
    mode: value.mode || "",
    usedNir: value.usedNir,
    vegetationPixels: Number.isFinite(vegetationPixels) ? vegetationPixels : 0,
    polygonCount: Number.isFinite(polygonCount) ? polygonCount : 0,
    ndviThreshold: Number.isFinite(ndviThreshold) ? ndviThreshold : null,
    rgbFilterUsed: value.rgbFilterUsed,
    visibleThreshold: Number.isFinite(visibleThreshold) ? visibleThreshold : null,
    excessGreenMin: Number.isFinite(excessGreenMin) ? excessGreenMin : null,
    saturationMin: Number.isFinite(saturationMin) ? saturationMin : null,
    brightnessMin: Number.isFinite(brightnessMin) ? brightnessMin : null,
    dynamicBrightnessMin: Number.isFinite(dynamicBrightnessMin) ? dynamicBrightnessMin : null,
    brightnessRange: Array.isArray(value.brightnessRange) ? value.brightnessRange : null,
    textureScore: Number.isFinite(textureScore) ? textureScore : null,
    textureThreshold: Number.isFinite(textureThreshold) ? textureThreshold : null,
    canopyRejectedPixels: Number.isFinite(canopyRejectedPixels) ? canopyRejectedPixels : 0,
    hardscapePixels: Number.isFinite(hardscapePixels) ? hardscapePixels : 0,
    hardscapeSeedPixels: Number.isFinite(Number(value.hardscapeSeedPixels)) ? Number(value.hardscapeSeedPixels) : 0,
    waterOrPoolPixels: Number.isFinite(Number(value.waterOrPoolPixels)) ? Number(value.waterOrPoolPixels) : 0,
    vegetationCandidatePixels: Number.isFinite(vegetationCandidatePixels) ? vegetationCandidatePixels : 0,
    validPixels: Number.isFinite(Number(value.validPixels)) ? Number(value.validPixels) : 0,
    hardscapeExcludedAreaSqft: Number.isFinite(hardscapeExcludedAreaSqft) ? hardscapeExcludedAreaSqft : 0,
    hardscapeExclusionRatio: Number.isFinite(hardscapeExclusionRatio) ? hardscapeExclusionRatio : null,
    hardscapeExcludedRatio: Number.isFinite(hardscapeExcludedRatio)
      ? hardscapeExcludedRatio
      : (Number.isFinite(hardscapeExclusionRatio) ? hardscapeExclusionRatio : null),
    remainderAreaSqft: Number.isFinite(remainderAreaSqft) ? remainderAreaSqft : null,
    vegetationFilterApplied: value.vegetationFilterApplied === true ? true : value.vegetationFilterApplied === false ? false : null,
    retryReason: value.retryReason || "",
    vegetationCandidateAreaSqft: Number.isFinite(vegetationCandidateAreaSqft) ? vegetationCandidateAreaSqft : 0,
    finalSelectedAreaSqft: Number.isFinite(finalSelectedAreaSqft) ? finalSelectedAreaSqft : null,
    hardscapeRules: value.hardscapeRules || null,
    lowConfidenceCandidateReturned: value.lowConfidenceCandidateReturned === true,
    keptComponentCount: Number.isFinite(keptComponentCount) ? keptComponentCount : null,
    rejectedSmallComponents: Number.isFinite(rejectedSmallComponents) ? rejectedSmallComponents : 0,
    rejectedWoodsLikeComponents: Number.isFinite(rejectedWoodsLikeComponents) ? rejectedWoodsLikeComponents : 0,
    strictDetectedRatio: Number.isFinite(strictDetectedRatio) ? strictDetectedRatio : null,
    softDetectedRatio: Number.isFinite(softDetectedRatio) ? softDetectedRatio : null,
    fallbackSoftMaskUsed: value.fallbackSoftMaskUsed === true,
    componentAreas: Array.isArray(value.componentAreas) ? value.componentAreas : [],
    rejectedComponents: Array.isArray(value.rejectedComponents) ? value.rejectedComponents : [],
    candidateScores: Array.isArray(value.candidateScores) ? value.candidateScores : [],
    selectedCandidateScores: Array.isArray(value.selectedCandidateScores) ? value.selectedCandidateScores : [],
    debugRunDir: value.debugRunDir || null,
    debugArtifacts: value.debugArtifacts || null,
    rasterWidth: value.rasterWidth ?? null,
    rasterHeight: value.rasterHeight ?? null,
    rasterCrs: value.rasterCrs || null,
    rasterTransform: value.rasterTransform || null,
    rasterBandCount: value.rasterBandCount ?? value.rasterBands ?? null,
    bandStats: value.bandStats || [],
    bandOrderAssumption: value.bandOrderAssumption || null,
    ndviStats: value.ndviStats || null,
    maskPixelCountBeforeFiltering: value.maskPixelCountBeforeFiltering ?? null,
    maskPixelCountAfterFiltering: value.maskPixelCountAfterFiltering ?? null,
    polygonCountBeforeFiltering: value.polygonCountBeforeFiltering ?? null,
    polygonCountAfterFiltering: value.polygonCountAfterFiltering ?? null,
    naipNirWarning: value.naipNirWarning || "",
    gravelExcludedPixels: Number.isFinite(Number(value.gravelExcludedPixels)) ? Number(value.gravelExcludedPixels) : 0,
    gravelExcludedAreaSqft: Number.isFinite(Number(value.gravelExcludedAreaSqft)) ? Number(value.gravelExcludedAreaSqft) : 0,
    largeObjectExcludedPixels: Number.isFinite(Number(value.largeObjectExcludedPixels)) ? Number(value.largeObjectExcludedPixels) : 0,
    largeObjectExcludedAreaSqft: Number.isFinite(Number(value.largeObjectExcludedAreaSqft)) ? Number(value.largeObjectExcludedAreaSqft) : 0,
    frozenExclusionPixels: Number.isFinite(Number(value.frozenExclusionPixels)) ? Number(value.frozenExclusionPixels) : 0,
    morphologyBarrierPixels: Number.isFinite(Number(value.morphologyBarrierPixels)) ? Number(value.morphologyBarrierPixels) : 0,
    exclusionBarrierApplied: value.exclusionBarrierApplied === true,
    exclusionRules: value.exclusionRules || null,
    constrainedBoundaryMode: value.constrainedBoundaryMode === true,
    activeBoundarySqft: Number.isFinite(Number(value.activeBoundarySqft)) ? Number(value.activeBoundarySqft) : null,
    finalAcceptReason: value.finalAcceptReason || "",
  };
}

function diagnosticsFromVisionPayload(payload = {}) {
  return compactAiDetectDiagnostics(payload?.diagnostics || payload?.diagnostic || payload || {});
}

function shouldReturnAiDetectDiagnostics(req, body = {}, forceDiagnostics = false) {
  if (req.path === "/api/ai/detect-mowable" || req.originalUrl?.includes("/api/ai/detect-mowable")) return true;
  if (forceDiagnostics) return true;
  const debugFlag = String(body.debug ?? req.query?.debug ?? process.env.AI_DETECT_DEBUG ?? "").toLowerCase();
  return process.env.NODE_ENV !== "production" || ["1", "true", "yes", "on"].includes(debugFlag);
}

function logVisionDiagnostics(diagnostics = {}) {
  console.log(`[AI Detect] vision diagnostics=${JSON.stringify(compactAiDetectDiagnostics(diagnostics))}`);
}

function emptyMowableDetection(reason, metrics = {}) {
  const parcelAreaSqft = Number(metrics.parcelAreaSqft || 0);
  const detectedAreaSqft = Number(metrics.detectedAreaSqft || 0);
  const detectedRatio = parcelAreaSqft > 0 ? detectedAreaSqft / parcelAreaSqft : 0;
  const diagnostics = compactAiDetectDiagnostics({
    ...(metrics.visionDiagnostics || metrics.diagnostics || {}),
    reason,
    detectionPreset: metrics.detectionPreset ?? metrics.visionDiagnostics?.detectionPreset ?? metrics.diagnostics?.detectionPreset,
    thresholds: metrics.thresholds ?? metrics.visionDiagnostics?.thresholds ?? metrics.diagnostics?.thresholds,
    detectedRatio,
    confidence: metrics.confidence ?? metrics.visionDiagnostics?.confidence ?? metrics.diagnostics?.confidence,
    mode: metrics.mode ?? metrics.visionDiagnostics?.mode ?? metrics.diagnostics?.mode,
    usedNir: metrics.usedNir ?? metrics.visionDiagnostics?.usedNir ?? metrics.diagnostics?.usedNir,
    vegetationPixels: metrics.vegetationPixels ?? metrics.visionDiagnostics?.vegetationPixels ?? metrics.diagnostics?.vegetationPixels,
    polygonCount: metrics.polygonCount ?? metrics.visionDiagnostics?.polygonCount ?? metrics.diagnostics?.polygonCount,
    ndviThreshold: metrics.ndviThreshold ?? metrics.visionDiagnostics?.ndviThreshold ?? metrics.diagnostics?.ndviThreshold,
    rgbFilterUsed: metrics.rgbFilterUsed ?? metrics.visionDiagnostics?.rgbFilterUsed ?? metrics.diagnostics?.rgbFilterUsed,
    visibleThreshold: metrics.visibleThreshold ?? metrics.visionDiagnostics?.visibleThreshold ?? metrics.diagnostics?.visibleThreshold,
    excessGreenMin: metrics.excessGreenMin ?? metrics.visionDiagnostics?.excessGreenMin ?? metrics.diagnostics?.excessGreenMin,
    saturationMin: metrics.saturationMin ?? metrics.visionDiagnostics?.saturationMin ?? metrics.diagnostics?.saturationMin,
    brightnessMin: metrics.brightnessMin ?? metrics.visionDiagnostics?.brightnessMin ?? metrics.diagnostics?.brightnessMin,
    componentAreas: metrics.componentAreas ?? metrics.visionDiagnostics?.componentAreas ?? metrics.diagnostics?.componentAreas,
    rejectedComponents: metrics.rejectedComponents ?? metrics.visionDiagnostics?.rejectedComponents ?? metrics.diagnostics?.rejectedComponents,
    candidateScores: metrics.candidateScores ?? metrics.visionDiagnostics?.candidateScores ?? metrics.diagnostics?.candidateScores,
    highRatioAllowed: metrics.highRatioAllowed ?? metrics.visionDiagnostics?.highRatioAllowed ?? metrics.diagnostics?.highRatioAllowed,
    parcelBoundarySimilarity: metrics.parcelBoundarySimilarity ?? metrics.visionDiagnostics?.parcelBoundarySimilarity ?? metrics.diagnostics?.parcelBoundarySimilarity,
    exclusionEvidence: metrics.exclusionEvidence ?? metrics.visionDiagnostics?.exclusionEvidence ?? metrics.diagnostics?.exclusionEvidence,
    guardrailReason: metrics.guardrailReason ?? reason
  });
  if (metrics.featuresReturned !== undefined) {
    console.log(`[AI Detect] features returned=${Number(metrics.featuresReturned || 0)}`);
  }
  console.log(`[AI Detect] parcelAreaSqft=${Math.round(parcelAreaSqft)}`);
  if (diagnostics.detectionPreset) console.log(`[AI Detect] detectionPreset=${diagnostics.detectionPreset}`);
  console.log(`[AI Detect] detectedAreaSqft=${Math.round(detectedAreaSqft)}`);
  console.log(`[AI Detect] detectedRatio=${detectedRatio.toFixed(4)}`);
  console.log(`[AI Detect] final reject reason=${reason}`);
  console.log(`[AI Detect] accepted/rejected reason=${reason}`);
  const response = {
    ok: true,
    featureCollection: emptyFeatureCollection(),
    features: [],
    mowableAreaSqft: 0,
    parcelAreaSqft: Math.round(parcelAreaSqft),
    detectedAreaSqft: Math.round(detectedAreaSqft),
    detectedRatio,
    source: metrics.source || "none",
    message: AI_MOWABLE_FALLBACK_MESSAGE,
    warning: AI_MOWABLE_FALLBACK_MESSAGE,
    reason
  };
  if (metrics.includeDiagnostics) {
    response.diagnostics = diagnostics;
  }
  return response;
}

function featureCountFromPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return 0;
  if (isFeatureCollection(payload.featureCollection)) return payload.featureCollection.features.length;
  if (Array.isArray(payload.features)) return payload.features.length;
  if (Array.isArray(payload.polygons)) return payload.polygons.length;
  return 0;
}

async function checkVisionServiceStatus(visionServiceUrl) {
  try {
    const response = await fetchWithTimeout(`${visionServiceUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 2500);
    const payload = await response.json().catch(() => ({}));
    const status = response.ok && payload?.ok !== false ? "available" : `unavailable_http_${response.status}`;
    console.log(`[AI Detect] vision service status=${status}`);
    if (status !== "available") {
      console.log("[AI Detect] vision service unavailable");
    }
    return {
      available: response.ok && payload?.ok !== false,
      status,
      payload
    };
  } catch (err) {
    console.log(`[AI Detect] vision service status=unavailable error=${err.message}`);
    console.log("[AI Detect] vision service unavailable");
    return {
      available: false,
      status: "unavailable",
      error: err
    };
  }
}

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

function normalizedMowableCollectionFromPayload(payload = {}) {
  if (isFeatureCollection(payload.featureCollection)) {
    return {
      type: "FeatureCollection",
      features: featuresFromGeoJson(payload.featureCollection, { source: payload.source || "vision" })
    };
  }

  if (Array.isArray(payload.features)) {
    return {
      type: "FeatureCollection",
      features: payload.features
        .map((feature) => normalizeMowableFeature(feature, { source: payload.source || "vision" }))
        .filter(Boolean)
    };
  }

  if (Array.isArray(payload.polygons)) {
    return {
      type: "FeatureCollection",
      features: payload.polygons
        .map((geometry) => normalizeMowableFeature(geometry, { source: payload.source || "vision_service" }))
        .filter(Boolean)
    };
  }

  return null;
}

function normalizeMowableResponse(payload = {}) {
  if (!payload || typeof payload !== "object" || payload.ok === false) return null;

  const featureCollection = normalizedMowableCollectionFromPayload(payload);
  if (!featureCollection || !featureCollection.features.length) return null;

  const source = payload.source || (payload.mode === "vision-placeholder" ? "fallback" : "vision");
  featureCollection.features = featureCollection.features.map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      source
    }
  }));
  const mowableAreaSqft = Number(
    payload.mowableAreaSqft ||
    payload.mowableAreaSqFt ||
    payload.areaSqft ||
    payload.areaSqFt ||
    0
  ) || featureCollectionAreaSqft(featureCollection);
  const confidenceScore = numericConfidence(payload);
  const confidenceLabel = typeof payload.confidence === "string"
    ? payload.confidence
    : confidenceScore >= 0.68
      ? "beta_high"
      : confidenceScore >= 0.42
        ? "beta_medium"
        : "beta_low";
  return {
    ok: true,
    featureCollection,
    features: featureCollection.features,
    mowableAreaSqft,
    source,
    mode: payload.mode,
    detectionMode: payload.detectionMode || payload.detection_mode || payload.mode,
    detection_mode: payload.detection_mode || payload.detectionMode || payload.mode,
    confidence: confidenceLabel,
    confidenceScore,
    warning: payload.warning || (source === "fallback" ? "Vision service unavailable; using parcel-based draft." : undefined)
  };
}

function guardrailForMowableDetection(normalized, parcelCollection, parcelAreaSqft, detectedAreaSqft, payload = {}, visionDiagnostics = {}, detectionPreset = "") {
  const preset = normalizeAiDetectionPreset(detectionPreset || visionDiagnostics?.detectionPreset || payload?.detectionPreset, parcelAreaSqft);
  const presetThresholds = aiPresetGuardrailThresholds(preset);
  const detectedRatio = parcelAreaSqft > 0 ? detectedAreaSqft / parcelAreaSqft : 0;
  const confidence = normalized?.confidenceScore ?? numericConfidence(payload);
  const boundarySimilarity = normalized
    ? parcelBoundarySimilarity(normalized.featureCollection, parcelCollection, detectedAreaSqft, parcelAreaSqft)
    : 0;
  const exclusionEvidence = detectionExclusionEvidence(normalized, visionDiagnostics, detectedRatio, boundarySimilarity);
  const isLargeParcel = parcelAreaSqft > 43560;
  const detectionMode = String(visionDiagnostics?.detectionMode || visionDiagnostics?.detection_mode || payload?.detectionMode || payload?.detection_mode || "").toLowerCase();
  const isSmallHardscapeRemainder = preset === "small_residential" && detectionMode === "hardscape_exclusion_then_remainder";
  const smallHardscapeEvidence = isSmallHardscapeRemainder && exclusionEvidence.hardscapeExcluded;
  // Constrained/selected-boundary mode: user drew a mowable focus area.
  // Vegetation covering most of the selected area after hardscape removal is expected.
  const usedSelectedBoundary = Boolean(
    visionDiagnostics?.usedSelectedBoundary || payload?.usedSelectedBoundary ||
    visionDiagnostics?.constrainedBoundaryMode || payload?.constrainedBoundaryMode
  );
  const constrainedBoundarySource = String(
    visionDiagnostics?.detectionBoundarySource || payload?.detectionBoundarySource || ""
  );
  const isConstrainedBoundary = usedSelectedBoundary ||
    constrainedBoundarySource === "mowable" ||
    constrainedBoundarySource === "selected_area";
  const roughCandidateAllowed = Boolean(visionDiagnostics?.lowConfidenceCandidateReturned)
    && presetThresholds.allowLowConfidenceCandidate
    && (exclusionEvidence.present || isLargeParcel)
    && detectedRatio > 0.01
    && detectedRatio <= 0.97
    && boundarySimilarity < 0.99;
  if (roughCandidateAllowed) {
    console.log(`[AI Detect] roughCandidateAllowed=true isLargeParcel=${isLargeParcel} detectedRatio=${detectedRatio.toFixed(4)} boundarySimilarity=${Number(boundarySimilarity).toFixed(4)}`);
  }
  let reason = "";
  let highRatioAllowed = false;
  const allowMostlyFailedManualReview =
    String(normalized?.confidence || payload?.confidence || visionDiagnostics?.confidenceLabel || "").toLowerCase() === "beta_low" ||
    Boolean(visionDiagnostics?.lowConfidenceCandidateReturned) ||
    Number(normalized?.confidenceScore ?? payload?.confidenceScore ?? visionDiagnostics?.confidenceScore ?? confidence ?? 0) <= 0.42;

  if (!normalized || !Array.isArray(normalized.features) || !normalized.features.length) {
    reason = "no features";
  } else if (detectedAreaSqft <= 0) {
    reason = "non-positive area";
  } else if (detectedRatio > 0 && detectedRatio < 0.02) {
    reason = "extremely small detection";
  } else if (detectionUsesFallbackSource(normalized)) {
    reason = "parcel-sized fallback";
  } else if (detectedRatio > presetThresholds.hardRatioLimit && !roughCandidateAllowed && !isConstrainedBoundary) {
    reason = "detected ratio above hard limit";
  } else if (
    (boundarySimilarity >= 0.97 ||
    featureCollectionsApproximatelyEqual(normalized.featureCollection, parcelCollection, detectedAreaSqft, parcelAreaSqft))
    && !allowMostlyFailedManualReview
    && !smallHardscapeEvidence
    && !isConstrainedBoundary
  ) {
    // For constrained boundaries, matching the selected area is the expected outcome —
    // do not reject because the polygon fills the selected boundary.
    reason = "detected geometry matched the full parcel";
  } else if (
    (boundarySimilarity >= 0.97 ||
    featureCollectionsApproximatelyEqual(normalized.featureCollection, parcelCollection, detectedAreaSqft, parcelAreaSqft))
    && allowMostlyFailedManualReview
  ) {
    reason = "";
  } else if (detectedRatio >= presetThresholds.highRatioNeedsEvidence && detectedRatio <= presetThresholds.hardRatioLimit) {
    highRatioAllowed = roughCandidateAllowed || (
      smallHardscapeEvidence
      && detectedRatio <= presetThresholds.hardRatioLimit
    ) || (
      confidence !== null
      && confidence >= 0.45
      && boundarySimilarity < 0.95
      && exclusionEvidence.present
      && (preset === "large_rural" || exclusionEvidence.strong)
    ) || (
      // Constrained/selected-boundary: allow high ratio when hardscape was excluded.
      // Inside a user-selected area, vegetation covering 75-95% of the selected
      // boundary after manmade removal is expected and should not be rejected.
      isConstrainedBoundary
      && exclusionEvidence.present
      && detectedRatio <= presetThresholds.hardRatioLimit
    );
    if (!highRatioAllowed) {
      reason = "high detected ratio without enough exclusion evidence";
    }
  } else if (detectedRatio > presetThresholds.hardRatioLimit && !roughCandidateAllowed && !isConstrainedBoundary) {
    reason = "high detected ratio";
  } else if (confidence !== null && confidence < presetThresholds.minimumConfidence && !roughCandidateAllowed && !isConstrainedBoundary) {
    reason = "low confidence";
  }

  if (isConstrainedBoundary) {
    console.log(`[AI Detect] constrained boundary mode: usedSelectedBoundary=${usedSelectedBoundary} source=${constrainedBoundarySource} exclusionEvidence.present=${exclusionEvidence.present} exclusionEvidence.strong=${exclusionEvidence.strong} highRatioAllowed=${highRatioAllowed} reason=${reason || "none"}`);
  }

  return {
    reason,
    detectionPreset: preset,
    thresholds: presetThresholds,
    highRatioAllowed,
    parcelBoundarySimilarity: Number(boundarySimilarity.toFixed(4)),
    exclusionEvidence,
    guardrailReason: reason,
    isConstrainedBoundary,
  };
}

function rejectionReasonForMowableDetection(normalized, parcelCollection, parcelAreaSqft, detectedAreaSqft, payload = {}) {
  return guardrailForMowableDetection(normalized, parcelCollection, parcelAreaSqft, detectedAreaSqft, payload).reason;
}

async function handleAiDetectMowable(req, res, options = {}) {
  console.log("[AI Detect] request received");
  const body = req.body || {};
  const includeDiagnostics = shouldReturnAiDetectDiagnostics(req, body, Boolean(options.forceDiagnostics));
  const parcelGeoJson = body.parcelGeoJson || body.parcelGeoJSON || body.parcelFeature || body.feature;
  const parcelFeatures = featuresFromGeoJson(parcelGeoJson);

  if (!parcelFeatures.length) {
    console.log("[AI Detect] rejected reason=missing parcel geometry");
    console.log("[AI Detect] final reject reason=missing parcel geometry");
    console.log("[AI Detect] accepted/rejected reason=missing parcel geometry");
    return res.status(400).json({ ok: false, error: "parcelGeoJson with Polygon or MultiPolygon geometry is required." });
  }

  const validatedParcelGeoJson = {
    type: "FeatureCollection",
    features: parcelFeatures
  };
  const parcelAreaSqft = featureCollectionAreaSqft(validatedParcelGeoJson);
  // Priority: mowableGeoJson (user-selected boundary) > selectedAreaGeoJson > constraintGeoJson (legacy) > parcel fallback
  const rawBoundaryGeoJson = body.mowableGeoJson || body.selectedAreaGeoJson || body.constraintGeoJson || null;
  let boundarySource = "parcel";
  if (body.mowableGeoJson) boundarySource = "mowable";
  else if (body.selectedAreaGeoJson) boundarySource = "selected_area";
  else if (body.constraintGeoJson) boundarySource = "mowable";
  console.log("[AI Detect] constraintGeoJson present:", !!rawBoundaryGeoJson);
  const constraintFeatures = rawBoundaryGeoJson ? featuresFromGeoJson(rawBoundaryGeoJson) : [];
  console.log("[AI Detect] parsed constraint features:", constraintFeatures?.length || 0);
  const validatedConstraintGeoJson = constraintFeatures.length
    ? { type: "FeatureCollection", features: constraintFeatures }
    : null;
  const constraintAreaSqft = validatedConstraintGeoJson ? featureCollectionAreaSqft(validatedConstraintGeoJson) : 0;
  // Use the effective (selected/constraint) area for preset selection so a small drawn area
  // does not inherit large_rural thresholds from a large surrounding parcel.
  const effectiveAreaSqft = constraintAreaSqft > 0 ? constraintAreaSqft : parcelAreaSqft;
  const detectionPreset = normalizeAiDetectionPreset(body.detectionPreset, effectiveAreaSqft);
  if (validatedConstraintGeoJson) {
    console.log(`[AI Detect] boundary source: ${boundarySource} boundarySqft=${Math.round(constraintAreaSqft)}`);
    console.log(`[AI Detect] mode=constrained-selection constraintAreaSqft=${Math.round(constraintAreaSqft)}`);
  } else {
    console.log(`[AI Detect] boundary source: parcel parcelSqft=${Math.round(parcelAreaSqft)}`);
    console.log("[AI Detect] mode=full-parcel");
  }
  const visionServiceUrl = (process.env.VISION_SERVICE_URL || "http://127.0.0.1:8017").replace(/\/+$/, "");
  const visionStatus = await checkVisionServiceStatus(visionServiceUrl);

  if (!visionStatus.available) {
    return res.json(emptyMowableDetection("vision service unavailable", {
      parcelAreaSqft,
      detectionPreset,
      source: "vision_unavailable",
      featuresReturned: 0,
      includeDiagnostics,
      diagnostics: { reason: "vision service unavailable" }
    }));
  }

  try {
    const isLargeParcelRequest = detectionPreset === "large_rural";
    const visionTimeoutMs = isLargeParcelRequest ? 120000 : 60000;
    console.log(`[AI Detect] parcelAreaSqft=${Math.round(parcelAreaSqft)} detectionPreset=${detectionPreset} timeoutMs=${visionTimeoutMs}`);
    const upstream = await fetchWithTimeout(`${visionServiceUrl}/detect-mowable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parcelGeoJson: validatedParcelGeoJson,
        parcelFeature: body.parcelFeature || parcelFeatures[0],
        detectionPreset,
        address: body.address || body.parcelAddress || body.serviceAddress || "",
        center: body.center,
        lat: body.lat,
        lng: body.lng,
        zoom: body.zoom,
        source: body.source || "maplibre",
        debugArtifacts: Boolean(options.debugArtifacts || body.debugArtifacts),
        imageSource: body.imageSource || {
          type: "tile",
          provider: "esri-world-imagery",
          tileUrl: DEFAULT_SATELLITE_TILE_URL
        },
        ...(validatedConstraintGeoJson ? {
          constraintGeoJson: validatedConstraintGeoJson,
          mowableGeoJson: validatedConstraintGeoJson,
          boundarySource,
        } : {}),
      })
    }, visionTimeoutMs);
    console.log(`[AI Detect] vision service status=post_${upstream.status}`);
    console.log(`[AI Detect] vision response ok=${upstream.ok}`);

    if (!upstream.ok) {
      console.log(`[AI Detect] vision service status=upstream_http_${upstream.status}`);
      console.log("[AI Detect] vision service unavailable");
      console.log("[AI Detect] features returned=0");
      return res.json(emptyMowableDetection("vision service unavailable", {
        parcelAreaSqft,
        detectionPreset,
        source: "upstream_unavailable",
        featuresReturned: 0,
        includeDiagnostics,
        diagnostics: { reason: "vision service unavailable" }
      }));
    }

    const payload = await upstream.json().catch(() => null);
    console.log(`[AI Detect] vision response ok=${payload?.ok !== false}`);
    const visionDiagnostics = diagnosticsFromVisionPayload(payload || {});
    visionDiagnostics.detectionPreset = visionDiagnostics.detectionPreset || detectionPreset;
    logVisionDiagnostics(visionDiagnostics);
    const featuresReturned = featureCountFromPayload(payload);
    console.log(`[AI Detect] features returned=${featuresReturned}`);
    const normalized = normalizeMowableResponse(payload);
    const detectedAreaSqft = normalized ? featureCollectionAreaSqft(normalized.featureCollection) : 0;
    // effectiveAreaSqft is computed at handler top: constraint area when present, else parcel
    const guardrail = guardrailForMowableDetection(
      normalized,
      validatedParcelGeoJson,
      effectiveAreaSqft,
      detectedAreaSqft,
      payload || {},
      visionDiagnostics,
      detectionPreset
    );
    const rejectionReason = guardrail.reason;
    const nodeDetectedRatio = effectiveAreaSqft > 0 ? detectedAreaSqft / effectiveAreaSqft : 0;
    console.log(`[AI Detect] guardrail reason=${rejectionReason || "none"} detectionPreset=${detectionPreset} detectedRatio=${nodeDetectedRatio.toFixed(4)} boundarySimilarity=${guardrail.parcelBoundarySimilarity} highRatioAllowed=${guardrail.highRatioAllowed} lowConfCandidateReturned=${visionDiagnostics?.lowConfidenceCandidateReturned}`);
    console.log(`[AI Detect] exclusionEvidence=${JSON.stringify(guardrail.exclusionEvidence)} thresholds=${JSON.stringify(guardrail.thresholds)}`);
    console.log(`[AI Detect] selectedCandidate=${JSON.stringify(visionDiagnostics?.selectedCandidate || {})}`);

    if (rejectionReason) {
      console.log(`[AI Detect] REJECTED: reason=${rejectionReason} detectedRatio=${(parcelAreaSqft > 0 ? detectedAreaSqft / parcelAreaSqft : 0).toFixed(4)} parcelAreaSqft=${Math.round(parcelAreaSqft)}`);
      const rejectionResp = emptyMowableDetection(rejectionReason, {
        parcelAreaSqft,
        detectedAreaSqft,
        detectionPreset,
        source: normalized?.source || payload?.source || "vision",
        featuresReturned,
        includeDiagnostics,
        visionDiagnostics: {
          ...visionDiagnostics,
          detectionPreset,
          thresholds: guardrail.thresholds,
          highRatioAllowed: guardrail.highRatioAllowed,
          parcelBoundarySimilarity: guardrail.parcelBoundarySimilarity,
          exclusionEvidence: guardrail.exclusionEvidence,
          guardrailReason: guardrail.guardrailReason
        }
      });
      rejectionResp.detectionBoundarySource = boundarySource;
      rejectionResp.detectionBoundarySqft = Math.round(effectiveAreaSqft);
      rejectionResp.parcelSqft = Math.round(parcelAreaSqft);
      rejectionResp.usedSelectedBoundary = boundarySource !== "parcel";
      return res.json(rejectionResp);
    }

    console.log(`[AI Detect] parcelAreaSqft=${Math.round(parcelAreaSqft)}`);
    console.log(`[AI Detect] detectionPreset=${detectionPreset}`);
    console.log(`[AI Detect] detectedAreaSqft=${Math.round(detectedAreaSqft)}`);
    console.log(`[AI Detect] detectedRatio=${parcelAreaSqft > 0 ? (detectedAreaSqft / parcelAreaSqft).toFixed(4) : "0.0000"}`);
    console.log("[AI Detect] final reject reason=none");
    console.log("[AI Detect] accepted reason=vision polygons accepted");
    console.log("[AI Detect] accepted/rejected reason=accepted");
    if (includeDiagnostics) {
      normalized.diagnostics = compactAiDetectDiagnostics({
        ...visionDiagnostics,
        reason: "",
        guardrailReason: "",
        detectionPreset,
        thresholds: guardrail.thresholds,
        highRatioAllowed: guardrail.highRatioAllowed,
        parcelBoundarySimilarity: guardrail.parcelBoundarySimilarity,
        exclusionEvidence: guardrail.exclusionEvidence,
        detectedRatio: parcelAreaSqft > 0 ? detectedAreaSqft / parcelAreaSqft : 0,
        confidence: normalized.confidence,
        confidenceScore: normalized.confidenceScore,
        detection_mode: normalized.detection_mode,
        mode: normalized.mode ?? visionDiagnostics.mode
      });
    }
    normalized.detectionBoundarySource = boundarySource;
    normalized.detectionBoundarySqft = Math.round(effectiveAreaSqft);
    normalized.parcelSqft = Math.round(parcelAreaSqft);
    normalized.usedSelectedBoundary = boundarySource !== "parcel";
    return res.json(normalized);
  } catch (err) {
    console.log("[AI Detect] vision service status=unavailable");
    console.log("[AI Detect] vision service unavailable");
    console.warn("[AI Detect] vision service error", err.message);
    return res.json(emptyMowableDetection("vision service unavailable", {
      parcelAreaSqft,
      detectionPreset,
      source: "vision_unavailable",
      featuresReturned: 0,
      includeDiagnostics,
      diagnostics: { reason: "vision service unavailable" }
    }));
  }
}

app.post("/api/ai/detect-mowable", (req, res) => {
  return handleAiDetectMowable(req, res);
});

app.post("/api/ai/detect-mowable/debug", (req, res) => {
  return handleAiDetectMowable(req, res, { forceDiagnostics: true, debugArtifacts: true });
});

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

app.get("/", (_req, res) => {
  res.type("html").send(composeHtml());
});

app.get("/index.html", (_req, res) => {
  res.type("html").send(composeHtml());
});

app.get("/admin.html", (_req, res) => { res.redirect(301, "/admin/"); });

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
  const firstName = user.first_name || user.firstName || "";
  const lastName = user.last_name || user.lastName || "";
  const fullName = user.full_name || user.fullName || [firstName, lastName].filter(Boolean).join(" ");
  return {
    id: user.id,
    email: user.email,
    firstName,
    lastName,
    fullName,
    phone: user.phone || "",
    role: user.role,
    active: user.active !== false,
    avatarUrl: user.avatar_url || user.avatarUrl || "",
    createdAt: user.created_at || user.createdAt || null
  };
}

function splitFullName(name = "") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function composeFullName(firstName = "", lastName = "", fallback = "") {
  return [firstName, lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || String(fallback || "").trim();
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidLookingPhone(value) {
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

function submittedPhone(payload = {}) {
  return String(payload.phone || payload.customerPhone || payload.leadPhone || "").trim();
}

function phoneValidationError() {
  return "A valid phone number is required before booking, payment, or request submission.";
}

const SMS_CONSENT_TEXT = "I agree to receive SMS messages from MowNWA.com about my quote, booking, scheduling, job updates, payment/COD verification, and customer support. Message frequency may vary. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. View our Privacy Policy and Terms of Service.";
const SMS_CONSENT_REQUIRED_MESSAGE = "SMS consent is required before we can send verification texts.";
const PHONE_VERIFICATION_UNAVAILABLE_MESSAGE = "Phone verification is temporarily unavailable. Please try again shortly.";

function smsConsentAccepted(payload = {}) {
  return payload.smsConsent === true
    || payload.sms_consent === true
    || String(payload.smsConsent || "").toLowerCase() === "true"
    || String(payload.sms_consent || "").toLowerCase() === "true";
}

function smsConsentSnapshot(...payloads) {
  if (!payloads.some((payload) => smsConsentAccepted(payload || {}))) {
    return { accepted: false, at: null, text: null };
  }
  return {
    accepted: true,
    at: new Date().toISOString(),
    text: SMS_CONSENT_TEXT
  };
}

function requireSmsConsent(res, ...payloads) {
  const consent = smsConsentSnapshot(...payloads);
  if (!consent.accepted) {
    res.status(400).json({ ok: false, error: SMS_CONSENT_REQUIRED_MESSAGE });
    return null;
  }
  return consent;
}

function applySmsConsentSnapshot(payload = {}, consent = {}) {
  if (!consent?.accepted) return payload;
  payload.smsConsent = true;
  payload.sms_consent = true;
  payload.smsConsentAt = consent.at;
  payload.sms_consent_at = consent.at;
  payload.smsConsentText = consent.text;
  payload.sms_consent_text = consent.text;
  return payload;
}

const DUPLICATE_EMAIL_MESSAGE = "An account already exists with this email. Please sign in instead.";
const DUPLICATE_PHONE_MESSAGE = "An account already exists with this phone number. Please sign in instead.";
const CHECKOUT_DUPLICATE_EMAIL_MESSAGE = "An account already exists with this email. Please sign in to continue.";
const CHECKOUT_DUPLICATE_PHONE_MESSAGE = "An account already exists with this phone number. Please sign in to continue.";

function toE164Phone(value) {
  const text = String(value || "").trim();
  if (isE164Phone(text)) return text;
  const digits = phoneDigits(text);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return text;
}

function normalizeAccountEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function normalizeAccountPhone(value) {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function isGuestPlaceholderEmail(email) {
  return /^phone-[^@]+@example\.com$/i.test(normalizeAccountEmail(email));
}

const NORMALIZED_USER_PHONE_SQL = `
  CASE
    WHEN regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = '' THEN ''
    WHEN length(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')) = 10
      THEN '+1' || regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
    WHEN length(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')) = 11
      AND left(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 1) = '1'
      THEN '+' || regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
    ELSE '+' || regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
  END
`;

function generateSixDigitCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function codVerificationMessage(code) {
  return `MowNWA: Your cash/check-on-site verification code is ${code}. Enter this code to confirm your mowing request.`;
}

function isCodPaymentMethod(value) {
  return String(value || "").trim().toLowerCase() === "onsite_cash_check";
}

function codVerificationIsExpired(sentAt) {
  const sentMs = new Date(sentAt || 0).getTime();
  return !Number.isFinite(sentMs) || Date.now() - sentMs > 15 * 60 * 1000;
}

const PHONE_VERIFICATION_PURPOSE_COD = "cod_checkout";
const PHONE_VERIFICATION_SESSION_TTL_MS = 30 * 60 * 1000;

function phoneVerificationSessionKey(phone, purpose = PHONE_VERIFICATION_PURPOSE_COD) {
  return `${normalizePhoneForVerification(phone)}|${String(purpose || PHONE_VERIFICATION_PURPOSE_COD).trim().toLowerCase()}`;
}

function phoneVerificationSessionStore(req) {
  if (!req.session) return null;
  if (!req.session.phoneVerifications || typeof req.session.phoneVerifications !== "object") {
    req.session.phoneVerifications = {};
  }
  return req.session.phoneVerifications;
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function recordPhoneVerificationSession(req, { phone, purpose, provider } = {}) {
  const store = phoneVerificationSessionStore(req);
  if (!store) return null;
  const normalizedPhone = normalizePhoneForVerification(phone);
  const verifiedAt = new Date().toISOString();
  const record = {
    phone: normalizedPhone,
    purpose: String(purpose || PHONE_VERIFICATION_PURPOSE_COD),
    provider: provider || getPhoneVerifyProvider(),
    verifiedAt
  };
  store[phoneVerificationSessionKey(normalizedPhone, record.purpose)] = record;
  return record;
}

function verifiedPhoneSession(req, phone, purpose = PHONE_VERIFICATION_PURPOSE_COD) {
  const store = phoneVerificationSessionStore(req);
  const record = store?.[phoneVerificationSessionKey(phone, purpose)];
  if (!record) return null;
  const verifiedMs = new Date(record.verifiedAt || 0).getTime();
  if (!Number.isFinite(verifiedMs) || Date.now() - verifiedMs > PHONE_VERIFICATION_SESSION_TTL_MS) {
    delete store[phoneVerificationSessionKey(phone, purpose)];
    return null;
  }
  return record;
}

/* =========================================================
   IDEMPOTENT PRICING SCHEMA SETUP
   Runs at startup — safe to run on every start (IF NOT EXISTS).
   Covers all pricing tables the estimate engine depends on.
   ========================================================= */

let pricingSchemaEnsured = false;
async function ensurePricingSchema() {
  if (pricingSchemaEnsured) return true;
  try {
    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        app_name TEXT,
        default_state TEXT DEFAULT 'AR',
        parcel_mode TEXT,
        maps_mode TEXT,
        minimum_cut_price NUMERIC(10,2) DEFAULT 38,
        complexity_rules JSONB DEFAULT '{}',
        terrain_settings JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Add terrain_settings column to existing deployments that pre-date this column
    await pgdb.query(`
      ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS terrain_settings JSONB DEFAULT '{}'
    `).catch(() => {});

    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_fee NUMERIC(10,2) DEFAULT 0,
        rate_per_1000_sqft NUMERIC(10,4) DEFAULT 0,
        minimum_price NUMERIC(10,2) DEFAULT 0,
        active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS regions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT DEFAULT 'AR',
        market_multiplier NUMERIC(6,4) DEFAULT 1.0,
        travel_fee NUMERIC(10,2) DEFAULT 0,
        minimum_job NUMERIC(10,2) DEFAULT 0,
        featured_cities TEXT[] DEFAULT '{}',
        active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS provider_pricing (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        base_fee NUMERIC(10,2) DEFAULT 0,
        rate_per_1000_sqft NUMERIC(10,4) DEFAULT 0,
        minimum_price NUMERIC(10,2) DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    /* Per-service provider pricing overrides (replaces the one-row-per-provider limitation) */
    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS provider_service_pricing (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        base_fee NUMERIC(10,2),
        rate_per_1000_sqft NUMERIC(10,4),
        minimum_price NUMERIC(10,2),
        enabled BOOLEAN DEFAULT true,
        notes TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(provider_id, service_id)
      )
    `);

    /* Tiered / bracket pricing: different $/k-sqft rates at different lot sizes */
    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS price_tiers (
        id TEXT PRIMARY KEY,
        service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        min_sqft INTEGER NOT NULL DEFAULT 0,
        max_sqft INTEGER,
        rate_per_1000_sqft NUMERIC(10,4) NOT NULL,
        label TEXT,
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    /* Global bulk / sliding-scale pricing tiers (not per-service) */
    await pgdb.query(`
      CREATE TABLE IF NOT EXISTS bulk_pricing_tiers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        start_sqft INTEGER NOT NULL DEFAULT 0,
        end_sqft INTEGER,
        rate_per_1000_sqft NUMERIC(10,4) NOT NULL,
        sort_order INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    /* Seed default bulk tiers if none exist yet */
    const existingBulk = await pgdb.query("SELECT 1 FROM bulk_pricing_tiers LIMIT 1").catch(() => ({ rows: [] }));
    if (!existingBulk.rows.length) {
      const defaults = [
        { id: 'bulk_std',   label: 'Standard (0–8,000 sq ft)',        enabled: true, start: 0,     end: 8000,  rate: 4.50, order: 0 },
        { id: 'bulk_med',   label: 'Volume (8,001–15,000 sq ft)',      enabled: true, start: 8000,  end: 15000, rate: 3.80, order: 1 },
        { id: 'bulk_large', label: 'Large lawn (15,001–30,000 sq ft)', enabled: true, start: 15000, end: 30000, rate: 3.25, order: 2 },
        { id: 'bulk_open',  label: 'Open lawn (30,001+ sq ft)',        enabled: true, start: 30000, end: null,  rate: 2.75, order: 3 },
      ];
      for (const d of defaults) {
        await pgdb.query(
          `INSERT INTO bulk_pricing_tiers (id, label, enabled, start_sqft, end_sqft, rate_per_1000_sqft, sort_order, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO NOTHING`,
          [d.id, d.label, d.enabled, d.start, d.end, d.rate, d.order]
        ).catch(() => {});
      }
    }

    /* Snapshot of the pricing breakdown used at booking time */
    await pgdb.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pricing_breakdown JSONB
    `).catch(() => {});

    pricingSchemaEnsured = true;
    console.log('[Startup] Pricing schema ensured (all IF NOT EXISTS).');
    return true;
  } catch (err) {
    console.warn('[Startup] Could not ensure pricing schema:', err.message);
    return false;
  }
}

let usersPhoneColumnEnsured = false;
async function ensureUsersPhoneColumn() {
  if (usersPhoneColumnEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT");
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT");
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT");
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true");
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by TEXT");
    await pgdb.query(`
      UPDATE users
      SET
        first_name = CASE
          WHEN COALESCE(TRIM(first_name), '') = '' THEN split_part(TRIM(COALESCE(full_name, '')), ' ', 1)
          ELSE first_name
        END,
        last_name = CASE
          WHEN COALESCE(TRIM(last_name), '') = ''
            AND array_length(regexp_split_to_array(TRIM(COALESCE(full_name, '')), '\\s+'), 1) > 1
          THEN regexp_replace(TRIM(COALESCE(full_name, '')), '^\\S+\\s*', '')
          ELSE last_name
        END
      WHERE COALESCE(TRIM(full_name), '') <> ''
        AND (COALESCE(TRIM(first_name), '') = '' OR COALESCE(TRIM(last_name), '') = '')
    `);
    usersPhoneColumnEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure users profile columns:", error.message);
    return false;
  }
}

async function findAccountContactConflict({ email, phone, excludeUserId = null } = {}) {
  await ensureUsersPhoneColumn();
  const normalizedEmail = normalizeAccountEmail(email);
  const normalizedPhone = normalizeAccountPhone(phone);
  const excludedId = excludeUserId == null ? null : String(excludeUserId);

  if (normalizedEmail && !isGuestPlaceholderEmail(normalizedEmail)) {
    const emailResult = await pgdb.query(
      `
      SELECT id, email, phone
      FROM users
      WHERE LOWER(TRIM(COALESCE(email, ''))) = $1
        AND LOWER(TRIM(COALESCE(email, ''))) !~ '^phone-[^@]+@example\\.com$'
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR id::text <> $2)
      LIMIT 1
      `,
      [normalizedEmail, excludedId]
    );
    if (emailResult.rows.length) {
      return { field: "email", error: DUPLICATE_EMAIL_MESSAGE, user: emailResult.rows[0] };
    }
  }

  if (normalizedPhone) {
    const phoneResult = await pgdb.query(
      `
      SELECT id, email, phone
      FROM users
      WHERE ${NORMALIZED_USER_PHONE_SQL} = $1
        AND LOWER(TRIM(COALESCE(email, ''))) !~ '^phone-[^@]+@example\\.com$'
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR id::text <> $2)
      LIMIT 1
      `,
      [normalizedPhone, excludedId]
    );
    if (phoneResult.rows.length) {
      return { field: "phone", error: DUPLICATE_PHONE_MESSAGE, user: phoneResult.rows[0] };
    }
  }

  return null;
}

async function checkAccountContactConflicts({ email, phone, currentUserId = null } = {}) {
  return findAccountContactConflict({ email, phone, excludeUserId: currentUserId });
}

function checkoutContactDebugEnabled() {
  const debugFlag = String(process.env.DEBUG_CHECKOUT_CONTACTS || "").trim().toLowerCase();
  return process.env.NODE_ENV !== "production" || ["1", "true", "yes", "on"].includes(debugFlag);
}

function maskEmailForDebug(value) {
  const email = normalizeAccountEmail(value);
  if (!email || !email.includes("@")) return email ? "***" : "";
  const [local, domain] = email.split("@");
  const tldIndex = domain.lastIndexOf(".");
  const domainSuffix = tldIndex > 0 ? domain.slice(tldIndex) : "";
  return `${local.slice(0, 1) || "*"}***@${domain.slice(0, 1) || "*"}***${domainSuffix}`;
}

function checkoutConflictDebugPayload({ email, phone } = {}) {
  if (!checkoutContactDebugEnabled()) return {};
  return {
    conflict_checked_email: maskEmailForDebug(email),
    conflict_checked_phone: maskPhone(normalizeAccountPhone(phone) || phone)
  };
}

function sendAccountContactConflict(res, conflict, options = {}) {
  const messages = options.messages || {};
  const error = messages[conflict.field] || conflict.error;
  return res.status(409).json({
    ok: false,
    field: conflict.field,
    code: "ACCOUNT_CONTACT_CONFLICT",
    error,
    ...(options.debug || {})
  });
}

function sendAdminAccountContactConflict(res, conflict) {
  return sendAccountContactConflict(res, conflict, {
    messages: {
      email: "That email is already used by another account.",
      phone: "That phone number is already used by another account."
    }
  });
}

function sendCheckoutAccountContactConflict(res, conflict, checkedContact = {}) {
  return sendAccountContactConflict(res, conflict, {
    messages: {
      email: CHECKOUT_DUPLICATE_EMAIL_MESSAGE,
      phone: CHECKOUT_DUPLICATE_PHONE_MESSAGE
    },
    debug: checkoutConflictDebugPayload(checkedContact)
  });
}

let accountContactIndexesEnsured = false;
async function ensureUniqueAccountContactIndexes() {
  if (accountContactIndexesEnsured) return true;
  await ensureUsersPhoneColumn();
  try {
    const emailDuplicates = await pgdb.query(`
      SELECT LOWER(TRIM(email)) AS normalized_email, COUNT(*)::int AS count, array_agg(id) AS user_ids
      FROM users
      WHERE COALESCE(TRIM(email), '') <> ''
        AND LOWER(TRIM(email)) !~ '^phone-[^@]+@example\\.com$'
        AND deleted_at IS NULL
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
      LIMIT 20
    `);
    if (emailDuplicates.rows.length) {
      console.warn("[Startup] Skipping users normalized-email unique index; duplicates found:", emailDuplicates.rows);
    } else {
      await pgdb.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_unique_account_email_norm_idx
        ON users (LOWER(TRIM(email)))
        WHERE COALESCE(TRIM(email), '') <> ''
          AND LOWER(TRIM(email)) !~ '^phone-[^@]+@example\\.com$'
          AND deleted_at IS NULL
      `);
    }

    const phoneDuplicates = await pgdb.query(`
      SELECT ${NORMALIZED_USER_PHONE_SQL} AS normalized_phone, COUNT(*)::int AS count, array_agg(id) AS user_ids
      FROM users
      WHERE ${NORMALIZED_USER_PHONE_SQL} <> ''
        AND LOWER(TRIM(COALESCE(email, ''))) !~ '^phone-[^@]+@example\\.com$'
        AND deleted_at IS NULL
      GROUP BY ${NORMALIZED_USER_PHONE_SQL}
      HAVING COUNT(*) > 1
      LIMIT 20
    `);
    if (phoneDuplicates.rows.length) {
      console.warn("[Startup] Skipping users normalized-phone unique index; duplicates found:", phoneDuplicates.rows);
    } else {
      await pgdb.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_unique_account_phone_norm_idx
        ON users ((${NORMALIZED_USER_PHONE_SQL}))
        WHERE ${NORMALIZED_USER_PHONE_SQL} <> ''
          AND LOWER(TRIM(COALESCE(email, ''))) !~ '^phone-[^@]+@example\\.com$'
          AND deleted_at IS NULL
      `);
    }

    accountContactIndexesEnsured = true;
    return true;
  } catch (error) {
    console.warn("[Startup] Could not ensure account contact unique indexes:", error.message);
    return false;
  }
}

let jobsScopeSnapshotColumnEnsured = false;
async function ensureJobsScopeSnapshotColumn() {
  if (jobsScopeSnapshotColumnEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_scope_snapshot JSONB");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scope_snapshot JSONB");
    await pgdb.query(`
      UPDATE jobs
      SET
        job_scope_snapshot = COALESCE(job_scope_snapshot, scope_snapshot),
        scope_snapshot = COALESCE(scope_snapshot, job_scope_snapshot)
      WHERE job_scope_snapshot IS NULL
         OR scope_snapshot IS NULL
    `);
    jobsScopeSnapshotColumnEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure jobs scope snapshot columns:", error.message);
    return false;
  }
}

let jobPhotoColumnsEnsured = false;
async function ensureJobPhotoColumns() {
  if (jobPhotoColumnsEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS before_photo_urls JSONB DEFAULT '[]'::jsonb");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS after_photo_urls JSONB DEFAULT '[]'::jsonb");
    await pgdb.query(`
      UPDATE jobs
      SET
        before_photo_urls = COALESCE(before_photo_urls, '[]'::jsonb),
        after_photo_urls = COALESCE(after_photo_urls, '[]'::jsonb)
      WHERE before_photo_urls IS NULL
         OR after_photo_urls IS NULL
    `);
    jobPhotoColumnsEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure job photo columns:", error.message);
    return false;
  }
}

let paymentColumnsEnsured = false;
async function ensurePaymentColumns() {
  if (paymentColumnsEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_method TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimate_at_booking NUMERIC");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pricing_breakdown_json JSONB");
    paymentColumnsEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure payment columns:", error.message);
    return false;
  }
}

let codVerificationColumnsEnsured = false;
async function ensureCodVerificationColumns() {
  if (codVerificationColumnsEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_status TEXT DEFAULT 'not_required'");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_code TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_sent_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verified_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_provider TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_message_sid TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_attempts INTEGER DEFAULT 0");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verified_provider TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verified_number TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verification_purpose TEXT");
    codVerificationColumnsEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure COD verification columns:", error.message);
    return false;
  }
}

let smsConsentColumnsEnsured = false;
async function ensureSmsConsentColumns() {
  if (smsConsentColumnsEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sms_consent_text TEXT");
    await pgdb.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ");
    await pgdb.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sms_consent_text TEXT");
    tableColumnCache.delete("jobs");
    tableColumnCache.delete("quotes");
    smsConsentColumnsEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure SMS consent columns:", error.message);
    return false;
  }
}

let jobsCustomerEmailColumnEnsured = false;
async function ensureJobsCustomerEmailColumn() {
  if (jobsCustomerEmailColumnEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_email TEXT");
    tableColumnCache.delete("jobs");
    jobsCustomerEmailColumnEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure jobs.customer_email column:", error.message);
    return false;
  }
}

let jobsAdminEditableContactColumnsEnsured = false;
async function ensureJobsAdminEditableContactColumns() {
  if (jobsAdminEditableContactColumnsEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_name TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_email TEXT");
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_phone TEXT");
    tableColumnCache.delete("jobs");
    jobsCustomerEmailColumnEnsured = true;
    jobsAdminEditableContactColumnsEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure admin editable job contact columns:", error.message);
    return false;
  }
}

const CLAIM_EMAIL_COLUMNS = ["customer_email", "email", "contact_email"];
const tableColumnCache = new Map();

async function tableColumns(tableName) {
  const safeTableName = String(tableName || "").trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(safeTableName)) return new Set();
  if (tableColumnCache.has(safeTableName)) return tableColumnCache.get(safeTableName);
  const result = await pgdb.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [safeTableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(safeTableName, columns);
  return columns;
}

async function emailColumnsForTable(tableName, { ensureCustomerEmail = false } = {}) {
  if (ensureCustomerEmail && tableName === "jobs") await ensureJobsCustomerEmailColumn();
  const columns = await tableColumns(tableName);
  return CLAIM_EMAIL_COLUMNS.filter((column) => columns.has(column));
}

function normalizeEmailForClaim(email) {
  return String(email || "").toLowerCase().trim();
}

function emailMatchPredicate(columns, parameterIndex = 2) {
  return columns
    .filter((column) => CLAIM_EMAIL_COLUMNS.includes(column))
    .map((column) => `LOWER(TRIM(${column})) = $${parameterIndex}`)
    .join(" OR ");
}

async function claimJobsForUserEmail(userId, email) {
  const normalizedEmail = normalizeEmailForClaim(email);
  const claimedJobIds = new Set();
  let quotesClaimed = 0;
  if (!userId || !normalizedEmail) return { jobsClaimed: 0, quotesClaimed: 0 };

  try {
    const jobEmailColumns = await emailColumnsForTable("jobs", { ensureCustomerEmail: true });
    const jobEmailMatch = emailMatchPredicate(jobEmailColumns, 2);
    if (jobEmailMatch) {
      const result = await pgdb.query(
        `
        UPDATE jobs
        SET customer_user_id = $1
        WHERE customer_user_id IS NULL
          AND (${jobEmailMatch})
        RETURNING id
        `,
        [userId, normalizedEmail]
      );
      result.rows.forEach((row) => claimedJobIds.add(String(row.id)));
    }

    const payments = readJsonArray(PAYMENTS_FILE);
    const matchingPaymentJobIds = [];
    let paymentsChanged = false;
    for (const payment of payments) {
      const paymentEmail = normalizeEmailForClaim(payment.customer?.email || payment.customer_email || payment.email);
      if (!paymentEmail || paymentEmail !== normalizedEmail) continue;
      if (payment.job_id) matchingPaymentJobIds.push(String(payment.job_id));
      if (!payment.customer_user_id) {
        payment.customer_user_id = userId;
        paymentsChanged = true;
      }
    }

    if (matchingPaymentJobIds.length) {
      const hasCustomerEmail = jobEmailColumns.includes("customer_email");
      const result = await pgdb.query(
        `
        UPDATE jobs
        SET
          customer_user_id = $1${hasCustomerEmail ? ",\n          customer_email = COALESCE(NULLIF(TRIM(customer_email), ''), $3)" : ""}
        WHERE customer_user_id IS NULL
          AND id = ANY($2::text[])
        RETURNING id
        `,
        hasCustomerEmail
          ? [userId, matchingPaymentJobIds, normalizedEmail]
          : [userId, matchingPaymentJobIds]
      );
      result.rows.forEach((row) => claimedJobIds.add(String(row.id)));
    }
    if (paymentsChanged) writeJsonArray(PAYMENTS_FILE, payments);

    const quoteEmailColumns = await emailColumnsForTable("quotes");
    const quoteEmailMatch = emailMatchPredicate(quoteEmailColumns, 2);
    if (quoteEmailMatch) {
      const result = await pgdb.query(
        `
        UPDATE quotes
        SET customer_user_id = $1
        WHERE customer_user_id IS NULL
          AND (${quoteEmailMatch})
        RETURNING id
        `,
        [userId, normalizedEmail]
      );
      quotesClaimed = result.rows.length;
    }

    console.log(`[Auth Claim Jobs] user=${userId} email=${normalizedEmail} claimed=${claimedJobIds.size}`);
    return { jobsClaimed: claimedJobIds.size, quotesClaimed };
  } catch (error) {
    console.warn(`[Auth Claim Jobs] user=${userId} email=${normalizedEmail} failed: ${error.message}`);
    return { jobsClaimed: claimedJobIds.size, quotesClaimed, error: error.message };
  }
}

async function attachCheckoutJobToUser(jobId, user = {}, email = "") {
  const normalizedEmail = normalizeEmailForClaim(email || user.email || "");
  if (!jobId || !user?.id) return;
  const hasCustomerEmail = await ensureJobsCustomerEmailColumn();
  await pgdb.query(
    `
    UPDATE jobs
    SET
      customer_user_id = COALESCE(customer_user_id, $2)${hasCustomerEmail ? ",\n      customer_email = COALESCE(NULLIF(TRIM(customer_email), ''), $3)" : ""}
    WHERE id = $1
      AND (customer_user_id IS NULL OR customer_user_id = $2)
    `,
    hasCustomerEmail ? [jobId, user.id, normalizedEmail] : [jobId, user.id]
  );
}

async function updateUserPhoneIfBlank(userId, phone) {
  const trimmed = String(phone || "").trim();
  const normalizedPhone = normalizeAccountPhone(trimmed);
  if (!userId || !trimmed || !normalizedPhone || !isValidLookingPhone(trimmed)) return false;
  if (!(await ensureUsersPhoneColumn())) return false;
  try {
    const conflict = await findAccountContactConflict({ phone: normalizedPhone, excludeUserId: userId });
    if (conflict) return false;
    const result = await pgdb.query(
      `
      UPDATE users
      SET phone = $2
      WHERE id = $1
        AND COALESCE(TRIM(phone), '') = ''
      RETURNING phone
      `,
      [userId, normalizedPhone]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.warn("Could not update blank user phone:", error.message);
    return false;
  }
}

function rejectMissingPhone(res) {
  return res.status(400).json({ ok: false, error: phoneValidationError() });
}

async function userWithAvatar(user) {
  if (!user?.id || user.avatar_url || user.avatarUrl) return user;
  try {
    const result = await pgdb.query(
      `
      SELECT avatar_url
      FROM user_auth_providers
      WHERE user_id = $1
        AND COALESCE(avatar_url, '') <> ''
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [user.id]
    );
    return result.rows[0]?.avatar_url
      ? { ...user, avatar_url: result.rows[0].avatar_url }
      : user;
  } catch {
    return user;
  }
}

async function findUserByEmail(email) {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return null;
  const result = await pgdb.query("SELECT * FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1", [normalized]);
  return result.rows[0] || null;
}

async function findOrCreateCustomerUser({ email, fullName, firstName, lastName, phone } = {}) {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return { user: null, created: false };

  await ensureUsersPhoneColumn();
  const existing = await findUserByEmail(normalized);
  if (existing) {
    await updateUserPhoneIfBlank(existing.id, phone);
    return { user: existing, created: false };
  }

  try {
    const split = splitFullName(fullName);
    const safeFirstName = String(firstName || split.firstName || "").trim();
    const safeLastName = String(lastName || split.lastName || "").trim();
    const safeFullName = composeFullName(safeFirstName, safeLastName, fullName);
    const normalizedPhone = normalizeAccountPhone(phone);
    const phoneConflict = normalizedPhone
      ? await findAccountContactConflict({ phone: normalizedPhone })
      : null;
    const safePhone = phoneConflict ? "" : normalizedPhone;
    const result = await pgdb.query(
      `
      INSERT INTO users (id, email, password_hash, full_name, first_name, last_name, phone, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'customer')
      RETURNING *
      `,
      [nanoid(10), normalized, hashPassword(nanoid(40)), safeFullName, safeFirstName, safeLastName, safePhone]
    );
    return { user: result.rows[0], created: true };
  } catch (error) {
    if (error.code === "23505") {
      const raced = await findUserByEmail(normalized);
      if (raced) return { user: raced, created: false };
    }
    throw error;
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        if (idx < 0) return [part, ""];
        return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function cookieSecure(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https" || APP_BASE_URL.startsWith("https://");
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: "lax",
    path: "/"
  });
}

function clearPassportSessionCookie(req, res) {
  res.clearCookie("connect.sid", {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: "lax",
    path: "/"
  });
}

function authTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  return bearerToken || parseCookies(req)[SESSION_COOKIE_NAME] || "";
}

async function createSessionForUser(userId) {
  const token = nanoid(32);
  await pgdb.query(
    "INSERT INTO sessions (token, user_id) VALUES ($1, $2)",
    [token, userId]
  );
  return token;
}

function safeQuoteReturnPath(returnTo = "", appBaseUrl = APP_BASE_URL) {
  const fallback = "/?auth=success&view=quote";
  const raw = String(returnTo || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, appBaseUrl);
    if (parsed.origin !== new URL(appBaseUrl).origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

function appRedirectUrl(returnTo = "", appBaseUrl = APP_BASE_URL) {
  return new URL(safeQuoteReturnPath(returnTo, appBaseUrl), appBaseUrl).toString();
}

function authErrorRedirect(provider, reason = "auth_failed", appBaseUrl = APP_BASE_URL) {
  const url = new URL("/?auth=error&view=quote", appBaseUrl);
  url.searchParams.set("provider", provider);
  url.searchParams.set("reason", reason);
  return url.toString();
}

function safeOAuthQuery(query = {}) {
  const value = (key) => query[key] == null ? "" : String(query[key]);
  const truncated = (key) => {
    const raw = value(key);
    return raw ? raw.slice(0, 160) : "";
  };
  return {
    keys: Object.keys(query),
    hasCode: Boolean(value("code")),
    codeLength: value("code").length,
    hasState: Boolean(value("state")),
    stateLength: value("state").length,
    error: truncated("error"),
    errorReason: truncated("error_reason"),
    errorDescription: truncated("error_description")
  };
}

function safePassportInfo(info) {
  if (!info) return null;
  if (typeof info === "string") return info.slice(0, 160);
  if (info.message) return String(info.message).slice(0, 160);
  return {
    name: info.name || null,
    status: info.status || null
  };
}

function safeFacebookLoginSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return ["account", "checkout", "legacy_custom"].includes(source) ? source : "account";
}

function safeFacebookLoginStep(value) {
  const step = String(value || "").trim().toLowerCase();
  return ["manual", "request", "estimate", "property", "draw", "start"].includes(step) ? step : "request";
}

function encodeStatePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeStatePayload(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function setOAuthStateCookie(req, res, payload) {
  res.cookie(OAUTH_STATE_COOKIE_NAME, encodeStatePayload(payload), {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000
  });
}

function clearOAuthStateCookie(req, res) {
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: "lax",
    path: "/"
  });
}

function oauthRedirectUri(provider) {
  return `${APP_BASE_URL}/auth/${provider}/callback`;
}

console.info("[Facebook OAuth] config", {
  appIdLoaded: Boolean(FACEBOOK_APP_ID),
  appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
  passportCallbackURL: FACEBOOK_CALLBACK_URL,
  requiredCallbackURLs: FACEBOOK_REQUIRED_CALLBACK_URLS,
  allowedHosts: Array.from(configuredAllowedAppHosts()).sort(),
  facebookLoginRoute: "/api/auth/facebook"
});

let userAuthProvidersEnsured = false;

async function ensureUserAuthProvidersTable() {
  if (userAuthProvidersEnsured) return;
  const result = await pgdb.query(
    `
    SELECT format_type(a.atttypid, a.atttypmod) AS user_id_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'users'
      AND n.nspname = current_schema()
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1
    `
  );
  const userIdType = result.rows[0]?.user_id_type === "integer" ? "INTEGER" : "TEXT";
  await pgdb.query(
    `
    CREATE TABLE IF NOT EXISTS user_auth_providers (
      id SERIAL PRIMARY KEY,
      user_id ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(provider, provider_user_id)
    )
    `
  );
  await pgdb.query("ALTER TABLE user_auth_providers ADD COLUMN IF NOT EXISTS avatar_url TEXT");
  userAuthProvidersEnsured = true;
}

async function linkPasswordProvider(user) {
  if (!user?.id || !user?.email) return;
  await ensureUserAuthProvidersTable();
  const email = String(user.email).toLowerCase().trim();
  await pgdb.query(
    `
    INSERT INTO user_auth_providers (user_id, provider, provider_user_id, email)
    VALUES ($1, 'password', $2, $2)
    ON CONFLICT (provider, provider_user_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      email = EXCLUDED.email,
      updated_at = NOW()
    `,
    [user.id, email]
  );
}

async function findOrCreateUserForOAuth({ provider, providerUserId, email, fullName, avatarUrl }) {
  await ensureUsersPhoneColumn();
  await ensureUserAuthProvidersTable();
  const normalizedEmail = String(email || "").toLowerCase().trim();
  const safeAvatarUrl = String(avatarUrl || "").trim().slice(0, 1000);
  if (!provider || !providerUserId) throw new Error("Missing provider identity");
  if (!normalizedEmail) throw new Error("Email permission is required");

  const client = await pgdb.pool.connect();
  try {
    await client.query("BEGIN");

    const linked = await client.query(
      `
      SELECT u.*
      FROM user_auth_providers uap
      JOIN users u ON u.id = uap.user_id
      WHERE uap.provider = $1
        AND uap.provider_user_id = $2
      LIMIT 1
      `,
      [provider, providerUserId]
    );

    if (linked.rows.length) {
      if (linked.rows[0].active === false || linked.rows[0].deleted_at) {
        throw new Error("This account is inactive");
      }
      await client.query(
        `
        UPDATE user_auth_providers
        SET email = $3,
            avatar_url = COALESCE(NULLIF($4, ''), avatar_url),
            updated_at = NOW()
        WHERE provider = $1
          AND provider_user_id = $2
        `,
        [provider, providerUserId, normalizedEmail, safeAvatarUrl]
      );
      await client.query("COMMIT");
      return { ...linked.rows[0], avatar_url: safeAvatarUrl || linked.rows[0].avatar_url || "" };
    }

    const split = splitFullName(fullName);
    const userResult = await client.query(
      `
      INSERT INTO users (id, email, password_hash, full_name, first_name, last_name, role)
      VALUES ($1, $2, $3, $4, $5, $6, 'customer')
      ON CONFLICT (email) DO UPDATE SET
        full_name = CASE
          WHEN COALESCE(users.full_name, '') = '' THEN EXCLUDED.full_name
          ELSE users.full_name
        END,
        first_name = CASE
          WHEN COALESCE(users.first_name, '') = '' THEN EXCLUDED.first_name
          ELSE users.first_name
        END,
        last_name = CASE
          WHEN COALESCE(users.last_name, '') = '' THEN EXCLUDED.last_name
          ELSE users.last_name
        END
      RETURNING *
      `,
      [nanoid(10), normalizedEmail, hashPassword(nanoid(40)), fullName || "", split.firstName, split.lastName]
    );

    const user = userResult.rows[0];
    if (user.active === false || user.deleted_at) {
      throw new Error("This account is inactive");
    }
    await client.query(
      `
      INSERT INTO user_auth_providers (user_id, provider, provider_user_id, email, avatar_url)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (provider, provider_user_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        email = EXCLUDED.email,
        avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), user_auth_providers.avatar_url),
        updated_at = NOW()
      `,
      [user.id, provider, providerUserId, normalizedEmail, safeAvatarUrl]
    );

    await client.query("COMMIT");
    return { ...user, avatar_url: safeAvatarUrl };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function fetchJsonOrThrow(url, options = {}, label = "OAuth provider") {
  const response = await fetchWithTimeout(url, options, 8000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label} request failed`);
  }
  return data;
}

function decodeJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function getGoogleProfile(code) {
  const tokenParams = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: oauthRedirectUri("google"),
    grant_type: "authorization_code"
  });

  const tokenData = await fetchJsonOrThrow(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams
    },
    "Google token"
  );

  if (!tokenData.id_token) throw new Error("Google did not return an identity token");

  const verified = await fetchJsonOrThrow(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenData.id_token)}`,
    {},
    "Google token verification"
  );

  if (verified.aud !== GOOGLE_CLIENT_ID) throw new Error("Invalid Google token audience");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(verified.iss)) {
    throw new Error("Invalid Google token issuer");
  }

  const payload = decodeJwtPayload(tokenData.id_token);
  return {
    provider: "google",
    providerUserId: verified.sub || payload.sub,
    email: verified.email || payload.email || "",
    fullName: verified.name || payload.name || "",
    avatarUrl: verified.picture || payload.picture || ""
  };
}

function createAccountSetupToken({ user, payment, createdUser }) {
  if (!user || !createdUser) return null;
  const token = nanoid(36);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const rows = readJsonArray(ACCOUNT_SETUP_TOKENS_FILE)
    .filter((item) => item.user_id !== user.id && item.payment_id !== payment.id && item.expires_at > new Date().toISOString());
  const record = {
    token,
    user_id: user.id,
    email: user.email,
    payment_id: payment.id,
    job_id: payment.job_id || null,
    created_user: Boolean(createdUser),
    expires_at: expiresAt,
    created_at: new Date().toISOString()
  };
  rows.push(record);
  writeJsonArray(ACCOUNT_SETUP_TOKENS_FILE, rows);
  return {
    token,
    url: accountSetupReturnUrl(token),
    email: user.email,
    createdUser: Boolean(createdUser),
    expiresAt
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

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function requireAuth(req, res, next) {
  try {
    const token = authTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    // Simple API key bypass for admin (works without PostgreSQL)
    if (ADMIN_API_KEY && token === ADMIN_API_KEY) {
      req.user = { id: "admin-key", email: "admin", role: "admin" };
      req.authToken = token;
      return next();
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

    req.user = await userWithAvatar(result.rows[0]);
    req.authToken = token;
    next();
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function optionalAuth(req, _res, next) {
  try {
    const token = authTokenFromRequest(req);

    if (!token) return next();

    if (ADMIN_API_KEY && token === ADMIN_API_KEY) {
      req.user = { id: "admin-key", email: "admin", role: "admin" };
      req.authToken = token;
      return next();
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

    if (result.rows.length) {
      req.user = await userWithAvatar(result.rows[0]);
      req.authToken = token;
    }
  } catch (error) {
    console.warn("Optional auth failed", error.message);
  }
  next();
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
  try {
    const [settingsResult, servicesResult, regionsResult, tiersResult, bulkTiersResult] = await Promise.all([
      pgdb.query("SELECT * FROM app_settings WHERE id = 1 LIMIT 1"),
      pgdb.query("SELECT * FROM services WHERE active = true ORDER BY sort_order ASC, name ASC"),
      pgdb.query("SELECT * FROM regions WHERE active = true ORDER BY sort_order ASC, name ASC"),
      pgdb.query("SELECT * FROM price_tiers WHERE active = true ORDER BY service_id, sort_order ASC, min_sqft ASC").catch(() => ({ rows: [] })),
      pgdb.query("SELECT * FROM bulk_pricing_tiers ORDER BY sort_order ASC, start_sqft ASC").catch(() => ({ rows: [] }))
    ]);

    const row = settingsResult.rows[0] || {};

    /* Group tiers by service_id for O(1) lookup in estimate */
    const tiersByService = {};
    for (const t of tiersResult.rows) {
      if (!tiersByService[t.service_id]) tiersByService[t.service_id] = [];
      tiersByService[t.service_id].push({
        id: t.id,
        serviceId: t.service_id,
        minSqft: Number(t.min_sqft || 0),
        maxSqft: t.max_sqft != null ? Number(t.max_sqft) : null,
        ratePer1000Sqft: Number(t.rate_per_1000_sqft || 0),
        label: t.label || "",
        sortOrder: Number(t.sort_order || 0)
      });
    }

    const dbServices = servicesResult.rows.map((s) => ({
      id: s.id,
      name: s.name || "",
      label: s.name || "",
      baseFee: Number(s.base_fee || 0),
      ratePer1000Sqft: Number(s.rate_per_1000_sqft || 0),
      minimumPrice: Number(s.minimum_price || 0),
      active: Boolean(s.active),
      sortOrder: Number(s.sort_order || 0),
      tiers: tiersByService[s.id] || []
    }));

    const dbRegions = regionsResult.rows.map((r) => ({
      id: r.id,
      name: r.name || "",
      label: r.name || "",
      state: r.state || DEFAULT_STATE,
      marketMultiplier: Number(r.market_multiplier || 1),
      travelFee: Number(r.travel_fee || 0),
      minimumJob: Number(r.minimum_job || 0),
      featuredCities: Array.isArray(r.featured_cities) ? r.featured_cities : [],
      active: Boolean(r.active),
      sortOrder: Number(r.sort_order || 0)
    }));

    const bulkTiers = bulkTiersResult.rows.map((t) => ({
      id: t.id,
      label: t.label || "",
      enabled: Boolean(t.enabled),
      startSqft: Number(t.start_sqft || 0),
      endSqft: t.end_sqft != null ? Number(t.end_sqft) : null,
      ratePer1000Sqft: Number(t.rate_per_1000_sqft || 0),
      sortOrder: Number(t.sort_order || 0)
    }));

    return {
      appName: row.app_name || APP_NAME,
      defaultState: row.default_state || DEFAULT_STATE,
      parcelMode: row.parcel_mode || "arkansas-live-plus-manual-fallback",
      mapsMode: row.maps_mode || "google-address + arkansas-gis-parcel + manual-adjust",
      minimumCutPrice: Number(row.minimum_cut_price || 38),
      complexityRules: row.complexity_rules || defaultSettings.complexityRules,
      services: dbServices.length ? dbServices : (localSettings.services || []),
      regions: dbRegions.length ? dbRegions : (localSettings.regions || []),
      tiersByService,
      bulkTiers: bulkTiers.filter((t) => t.enabled)
    };
  } catch (err) {
    console.warn("DB unavailable, using local settings.json fallback:", err.message);
    return {
      ...defaultSettings,
      services: localSettings.services || [],
      regions: localSettings.regions || [],
      tiersByService: {},
      bulkTiers: []
    };
  }
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


function roundToNearestFive(value) {
  const num = Number(value || 0);
  return Math.round(num / 5) * 5;
}

function isTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes' || v === 'on';
}

function estimateQuote(payload, settings) {
  const service = findService(settings, payload.serviceType) || settings.services[0];
  const region = findRegion(settings, payload.regionId);
  const rules = settings.complexityRules || {};
  const mowAreaSqft = Number(payload.mowAreaSqft || 0);
  console.log('[TurfLynk Area Trace] F. estimateQuote | mowAreaSqft=' + mowAreaSqft + ' lotAreaSqft=' + Number(payload.lotAreaSqft || 0) + ' serviceType=' + (payload.serviceType || '') + ' regionId=' + (payload.regionId || '') + ' source=payload');
  if (mowAreaSqft <= 0) return roundToNearestFive(0);

  const areaUnits = mowAreaSqft > 0 ? mowAreaSqft / 1000 : 0;
  const breakdown = [];

  const baseFee = Number(service?.baseFee || 0);
  const ratePer1000 = Number(service?.ratePer1000Sqft || 0);
  const areaCharge = areaUnits * ratePer1000;
  const serviceMinimum = Number(service?.minimumPrice || settings.minimumCutPrice || 0);
  const rawServiceCharge = baseFee + areaCharge;
  const appliedMinimum = rawServiceCharge < serviceMinimum;

  let estimate = Math.max(serviceMinimum, rawServiceCharge);

  if (appliedMinimum) {
    breakdown.push({ label: "Service minimum", amount: estimate });
  } else {
    if (baseFee > 0) breakdown.push({ label: "Base fee", amount: baseFee });
    breakdown.push({ label: `Area charge (${Math.round(mowAreaSqft).toLocaleString()} sq ft × $${ratePer1000}/k)`, amount: Math.round(areaCharge * 100) / 100 });
  }

  const regionMinimum = Number(region?.minimumJob || 0);
  if (regionMinimum > 0 && estimate < regionMinimum) {
    estimate = regionMinimum;
    breakdown.length = 0;
    breakdown.push({ label: "Region minimum", amount: estimate });
  }

  const marketMultiplier = Number(region?.marketMultiplier || 1);
  if (marketMultiplier !== 1) {
    const adj = estimate * (marketMultiplier - 1);
    estimate *= marketMultiplier;
    breakdown.push({ label: `Market adjustment (${Math.round((marketMultiplier - 1) * 100)}%)`, amount: Math.round(adj * 100) / 100 });
  }

  const travelFee = Number(region?.travelFee || 0);
  if (travelFee > 0) {
    estimate += travelFee;
    breakdown.push({ label: "Travel fee", amount: travelFee });
  }

  const yardType = String(payload.yardType || "standard");
  if (yardType === "open_flat") {
    const adj = estimate * -0.15;
    estimate *= 0.85;
    breakdown.push({ label: "Open / flat yard discount (−15%)", amount: Math.round(adj * 100) / 100 });
  }
  if (yardType === "tight_cutup") {
    const adj = estimate * 0.25;
    estimate *= 1.25;
    breakdown.push({ label: "Tight / cut-up yard upcharge (+25%)", amount: Math.round(adj * 100) / 100 });
  }
  if (yardType === "heavy_trimming") {
    const adj = estimate * 0.35;
    estimate *= 1.35;
    breakdown.push({ label: "Heavy trimming upcharge (+35%)", amount: Math.round(adj * 100) / 100 });
  }

  if (payload.propertyType === "corner") { const v = Number(rules.cornerLotUpcharge || 0); if (v) { estimate += v; breakdown.push({ label: "Corner lot", amount: v }); } }
  if (payload.propertyType === "double_corner") { const v = Number(rules.doubleCornerUpcharge || 0); if (v) { estimate += v; breakdown.push({ label: "Double corner lot", amount: v }); } }
  if (isTrue(payload.fenced)) { const v = Number(rules.fencedUpcharge || 0); if (v > 0) { estimate += v; breakdown.push({ label: "Fenced yard", amount: v }); } }
  if (isTrue(payload.obstacles)) { const v = Number(rules.obstaclesUpcharge || 0); if (v > 0) { estimate += v; breakdown.push({ label: "Obstacles / tight areas", amount: v }); } }
  if (isTrue(payload.rushJob)) { const v = Number(rules.rushJobUpcharge || 0); if (v > 0) { estimate += v; breakdown.push({ label: "Rush job", amount: v }); } }
  if (isTrue(payload.limitedAccess)) { const v = Number(rules.limitedAccessUpcharge || 0); if (v > 0) { estimate += v; breakdown.push({ label: "Limited access", amount: v }); } }
  if (isTrue(payload.gates)) { const v = Number(rules.gateHandlingUpcharge || 0); if (v > 0) { estimate += v; breakdown.push({ label: "Gate handling", amount: v }); } }

  if (isTrue(payload.overgrown)) {
    const m = Number(rules.overgrownMultiplier || 1);
    if (m > 1) { const adj = estimate * (m - 1); estimate *= m; breakdown.push({ label: `Overgrown yard (+${Math.round((m - 1) * 100)}%)`, amount: Math.round(adj * 100) / 100 }); }
  }
  if (isTrue(payload.slopedTerrain)) {
    const m = Number(rules.slopedTerrainMultiplier || 1);
    if (m > 1) { const adj = estimate * (m - 1); estimate *= m; breakdown.push({ label: `Sloped terrain (+${Math.round((m - 1) * 100)}%)`, amount: Math.round(adj * 100) / 100 }); }
  }
  if (isTrue(payload.denseVegetation)) {
    const m = Number(rules.denseVegetationMultiplier || 1);
    if (m > 1) { const adj = estimate * (m - 1); estimate *= m; breakdown.push({ label: `Dense vegetation (+${Math.round((m - 1) * 100)}%)`, amount: Math.round(adj * 100) / 100 }); }
  }

  const final = roundToNearestFive(Math.round(estimate * 100) / 100);
  return final;
}

/* Apply tiered / step pricing if the service has price_tiers configured.
   Returns { areaCharge, tierLines } where tierLines are per-bracket breakdown rows.
   Falls back to the flat rate when no tiers are defined. */
function applyTieredAreaCharge(mowAreaSqft, service) {
  const tiers = Array.isArray(service?.tiers) ? service.tiers : [];
  const activeTiers = tiers
    .filter((t) => t.ratePer1000Sqft != null)
    .sort((a, b) => a.minSqft - b.minSqft);

  if (!activeTiers.length) {
    /* No tiers — use the flat service rate */
    const ratePer1000 = Number(service?.ratePer1000Sqft || 0);
    const areaCharge = (mowAreaSqft / 1000) * ratePer1000;
    const label = service?.tiers?.length
      ? `Area charge (${Math.round(mowAreaSqft).toLocaleString()} sq ft × $${ratePer1000}/k sq ft)`
      : `Area charge (${Math.round(mowAreaSqft).toLocaleString()} sq ft × $${ratePer1000}/k sq ft)`;
    return {
      areaCharge: Math.round(areaCharge * 100) / 100,
      tierLines: [{ label, amount: Math.round(areaCharge * 100) / 100 }]
    };
  }

  /* Step through tiers smallest-first */
  let remaining = mowAreaSqft;
  let total = 0;
  const tierLines = [];

  for (const tier of activeTiers) {
    if (remaining <= 0) break;
    const tierStart = tier.minSqft;
    const tierEnd = tier.maxSqft != null ? tier.maxSqft : Infinity;
    const tierWidth = tierEnd === Infinity ? remaining : Math.max(0, tierEnd - tierStart);
    const sqftInTier = Math.min(remaining, tierWidth);
    if (sqftInTier <= 0) continue;

    const charge = (sqftInTier / 1000) * Number(tier.ratePer1000Sqft || 0);
    total += charge;
    const rangeLabel = tier.maxSqft != null
      ? `${Math.round(tierStart).toLocaleString()}–${Math.round(tier.maxSqft).toLocaleString()} sq ft`
      : `${Math.round(tierStart).toLocaleString()}+ sq ft`;
    const lineLabel = tier.label || `${rangeLabel} @ $${tier.ratePer1000Sqft}/k sq ft`;
    tierLines.push({ label: lineLabel, amount: Math.round(charge * 100) / 100 });
    remaining -= sqftInTier;
  }

  return { areaCharge: Math.round(total * 100) / 100, tierLines };
}

/* applyBulkSlidingScale — incremental sliding-scale pricing for large lawns.
   Each tier covers a band [startSqft, endSqft) and applies its own rate to the
   sqft that falls inside that band — no retroactive repricing of earlier bands.
   Returns { areaCharge, standardCharge, bulkDiscount, tierLines, isBulkApplied } */
function applyBulkSlidingScale(mowAreaSqft, standardRatePer1000, bulkTiers) {
  const activeTiers = (bulkTiers || [])
    .filter((t) => t.enabled !== false && t.ratePer1000Sqft != null)
    .sort((a, b) => a.startSqft - b.startSqft);

  const standardCharge = Math.round((mowAreaSqft / 1000) * standardRatePer1000 * 100) / 100;

  if (!activeTiers.length) {
    const label = `Area charge (${Math.round(mowAreaSqft).toLocaleString()} sq ft × $${standardRatePer1000}/k sq ft)`;
    return { areaCharge: standardCharge, standardCharge, bulkDiscount: 0, tierLines: [{ label, amount: standardCharge }], isBulkApplied: false };
  }

  let remaining = mowAreaSqft;
  let totalCharge = 0;
  const tierLines = [];
  let isBulkApplied = false;

  for (const tier of activeTiers) {
    if (remaining <= 0) break;
    const bandEnd = tier.endSqft != null ? tier.endSqft : Infinity;
    const bandWidth = bandEnd === Infinity ? remaining : Math.max(0, bandEnd - tier.startSqft);
    const sqftInBand = Math.min(remaining, bandWidth);
    if (sqftInBand <= 0) continue;

    const rate = Number(tier.ratePer1000Sqft || 0);
    const charge = Math.round((sqftInBand / 1000) * rate * 100) / 100;
    totalCharge += charge;

    const isDiscount = rate < standardRatePer1000;
    if (isDiscount) isBulkApplied = true;

    const lineLabel = tier.label || (isDiscount
      ? `Volume pricing (${Math.round(sqftInBand).toLocaleString()} sq ft × $${rate}/k sq ft)`
      : `Area charge (${Math.round(sqftInBand).toLocaleString()} sq ft × $${rate}/k sq ft)`);

    tierLines.push({ label: lineLabel, amount: charge });
    remaining -= sqftInBand;
  }

  const areaCharge = Math.round(totalCharge * 100) / 100;
  const bulkDiscount = Math.max(0, Math.round((standardCharge - areaCharge) * 100) / 100);
  return { areaCharge, standardCharge, bulkDiscount, tierLines, isBulkApplied };
}

function estimateQuoteWithBreakdown(payload, settings) {
  const service = findService(settings, payload.serviceType) || settings.services[0];
  const region = findRegion(settings, payload.regionId);
  const rules = settings.complexityRules || {};
  const mowAreaSqft = Number(payload.mowAreaSqft || 0);
  if (mowAreaSqft <= 0) return { estimate: 0, breakdown: [] };

  const breakdown = [];

  const baseFee = Number(service?.baseFee || 0);
  const serviceMinimum = Number(service?.minimumPrice || settings.minimumCutPrice || 0);

  /* Bulk sliding-scale takes priority over service-specific tiers when configured */
  const bulkTiers = Array.isArray(settings.bulkTiers) ? settings.bulkTiers : [];
  const hasServiceTiers = Array.isArray(service?.tiers) && service.tiers.filter((t) => t.ratePer1000Sqft != null).length > 0;
  const standardRatePer1000 = Number(service?.ratePer1000Sqft || 0);

  let areaCharge, tierLines, bulkDiscount = 0, isBulkApplied = false;
  if (bulkTiers.length > 0) {
    ({ areaCharge, tierLines, bulkDiscount, isBulkApplied } = applyBulkSlidingScale(mowAreaSqft, standardRatePer1000, bulkTiers));
  } else if (hasServiceTiers) {
    ({ areaCharge, tierLines } = applyTieredAreaCharge(mowAreaSqft, service));
  } else {
    ({ areaCharge, tierLines } = applyTieredAreaCharge(mowAreaSqft, service));
  }

  const rawServiceCharge = baseFee + areaCharge;
  const appliedMinimum = rawServiceCharge < serviceMinimum;

  let estimate = Math.max(serviceMinimum, rawServiceCharge);

  if (appliedMinimum) {
    breakdown.push({ label: "Service minimum", amount: estimate });
  } else {
    if (baseFee > 0) breakdown.push({ label: "Base fee", amount: baseFee });
    if (isBulkApplied && bulkDiscount > 0) {
      /* Show: standard rate charge + discount line so they add up to areaCharge */
      const stdCharge = Math.round((areaCharge + bulkDiscount) * 100) / 100;
      breakdown.push({ label: `Area charge (${Math.round(mowAreaSqft).toLocaleString()} sq ft × $${standardRatePer1000}/k sq ft)`, amount: stdCharge });
      breakdown.push({ label: "Bulk / open-lawn pricing discount", amount: -bulkDiscount });
    } else {
      for (const line of tierLines) breakdown.push(line);
    }
  }

  const regionMinimum = Number(region?.minimumJob || 0);
  if (regionMinimum > 0 && estimate < regionMinimum) {
    estimate = regionMinimum;
    breakdown.length = 0;
    breakdown.push({ label: "Region minimum", amount: estimate });
  }

  const marketMultiplier = Number(region?.marketMultiplier || 1);
  if (Math.abs(marketMultiplier - 1) > 0.001) {
    const adj = estimate * (marketMultiplier - 1);
    estimate *= marketMultiplier;
    const pct = Math.round((marketMultiplier - 1) * 100);
    breakdown.push({ label: `Market adjustment (${pct > 0 ? '+' : ''}${pct}%)`, amount: Math.round(adj * 100) / 100 });
  }

  const travelFee = Number(region?.travelFee || 0);
  if (travelFee > 0) {
    estimate += travelFee;
    breakdown.push({ label: "Travel fee", amount: travelFee });
  }

  const yardType = String(payload.yardType || "standard");
  if (yardType === "open_flat") {
    const adj = estimate * -0.15;
    estimate *= 0.85;
    breakdown.push({ label: "Open / flat yard (−15%)", amount: Math.round(adj * 100) / 100 });
  } else if (yardType === "tight_cutup") {
    const adj = estimate * 0.25;
    estimate *= 1.25;
    breakdown.push({ label: "Tight / cut-up yard (+25%)", amount: Math.round(adj * 100) / 100 });
  } else if (yardType === "heavy_trimming") {
    const adj = estimate * 0.35;
    estimate *= 1.35;
    breakdown.push({ label: "Heavy trimming (+35%)", amount: Math.round(adj * 100) / 100 });
  }

  const addUpcharge = (cond, label, amount) => {
    if (!cond || amount <= 0) return;
    estimate += amount;
    breakdown.push({ label, amount });
  };
  const addMultiplier = (cond, label, multiplier) => {
    if (!cond || multiplier <= 1) return;
    const adj = estimate * (multiplier - 1);
    const amount = Math.round(adj * 100) / 100;
    if (amount <= 0) return;
    estimate *= multiplier;
    breakdown.push({ label, amount });
  };

  addUpcharge(payload.propertyType === "corner", "Corner lot upcharge", Number(rules.cornerLotUpcharge || 0));
  addUpcharge(payload.propertyType === "double_corner", "Double corner lot upcharge", Number(rules.doubleCornerUpcharge || 0));
  addUpcharge(isTrue(payload.fenced), "Fenced yard upcharge", Number(rules.fencedUpcharge || 0));
  addUpcharge(isTrue(payload.obstacles), "Obstacles / tight areas upcharge", Number(rules.obstaclesUpcharge || 0));
  addUpcharge(isTrue(payload.rushJob), "Rush job upcharge", Number(rules.rushJobUpcharge || 0));
  addUpcharge(isTrue(payload.limitedAccess), "Limited access upcharge", Number(rules.limitedAccessUpcharge || 0));
  addUpcharge(isTrue(payload.gates), "Gate handling upcharge", Number(rules.gateHandlingUpcharge || 0));
  addMultiplier(isTrue(payload.overgrown), `Overgrown yard (+${Math.round((Number(rules.overgrownMultiplier || 1) - 1) * 100)}%)`, Number(rules.overgrownMultiplier || 1));
  addMultiplier(isTrue(payload.slopedTerrain), `Sloped terrain (+${Math.round((Number(rules.slopedTerrainMultiplier || 1) - 1) * 100)}%)`, Number(rules.slopedTerrainMultiplier || 1));
  addMultiplier(isTrue(payload.denseVegetation), `Dense vegetation (+${Math.round((Number(rules.denseVegetationMultiplier || 1) - 1) * 100)}%)`, Number(rules.denseVegetationMultiplier || 1));

  const final = roundToNearestFive(Math.round(estimate * 100) / 100);
  const activeBulkTiers = isBulkApplied ? (settings?.bulkTiers || []) : [];
  return { estimate: final, breakdown, activeBulkTiers };
}

function numberField(body, name) {
  const n = Number(body?.[name] || 0);
  return Number.isFinite(n) ? n : 0;
}

function mowableEstimateFields(body = {}) {
  return {
    parcelAreaSqft: numberField(body, "parcelAreaSqft"),
    buildingFootprintSqft: numberField(body, "buildingFootprintSqft"),
    buildingAdjustedSqft: numberField(body, "buildingAdjustedSqft"),
    estimatedNonMowableSqft: numberField(body, "estimatedNonMowableSqft"),
    autoEstimatedMowableSqft: numberField(body, "autoEstimatedMowableSqft"),
    mowableEstimateConfidence: body.mowableEstimateConfidence || "",
    buildingFootprintsSource: body.buildingFootprintsSource || "",
    customerAdjustedMowableSqft: numberField(body, "customerAdjustedMowableSqft")
  };
}

function mowableEstimateDetails(body = {}) {
  const fields = mowableEstimateFields(body);
  return [
    fields.parcelAreaSqft > 0 ? `Parcel area sqft: ${fields.parcelAreaSqft}` : "",
    fields.buildingFootprintSqft > 0 ? `Building footprint sqft: ${fields.buildingFootprintSqft}` : "",
    fields.buildingAdjustedSqft > 0 ? `Building adjusted sqft: ${fields.buildingAdjustedSqft}` : "",
    fields.estimatedNonMowableSqft > 0 ? `Estimated non-mowable sqft: ${fields.estimatedNonMowableSqft}` : "",
    fields.autoEstimatedMowableSqft > 0 ? `Auto estimated mowable sqft: ${fields.autoEstimatedMowableSqft}` : "",
    fields.customerAdjustedMowableSqft > 0 ? `Customer adjusted mowable sqft: ${fields.customerAdjustedMowableSqft}` : "",
    fields.mowableEstimateConfidence ? `Mowable estimate confidence: ${fields.mowableEstimateConfidence}` : "",
    fields.buildingFootprintsSource ? `Building footprints source: ${fields.buildingFootprintsSource}` : ""
  ].filter(Boolean);
}

function listField(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function aiPhotoAnalysisPlaceholder(body = {}) {
  return {
    photo_type: body.photo_type || "customer_scope",
    ai_analysis_json: body.ai_analysis_json || null,
    detected_services: listField(body.detected_services || body.service_types || body.requested_tasks),
    difficulty: body.difficulty || "unknown",
    access_concerns: listField(body.access_concerns),
    equipment_recommendation: body.equipment_recommendation || "",
    instant_quote_safe: body.instant_quote_safe == null ? false : Boolean(body.instant_quote_safe),
    rough_price_low: body.rough_price_low == null ? null : Number(body.rough_price_low),
    rough_price_high: body.rough_price_high == null ? null : Number(body.rough_price_high),
    customer_questions: listField(body.customer_questions),
    live_bid_recommended: body.live_bid_recommended == null ? true : Boolean(body.live_bid_recommended),
    provider_notes: body.provider_notes || "",
    customer_summary: body.customer_summary || "Based on your photos, this may require a live bid. The range shown is only a rough expectation. A provider will confirm final pricing."
  };
}

function servicePayloadFields(body = {}) {
  return {
    quote_type: body.quote_type || body.quoteType || "instant_mow",
    selected_yard_areas: listField(body.selected_yard_areas || body.selectedYardAreas),
    gate_size_category: body.gate_size_category || body.gate_access_type || "",
    gate_access_type: body.gate_access_type || body.gate_size_category || "",
    gate_width_inches: body.gate_width_inches ? Number(body.gate_width_inches) : null,
    mower_access: body.mower_access || "",
    gate_locked: body.gate_locked || "",
    yard_access_notes: body.yard_access_notes || body.access_notes || "",
    access_notes: body.access_notes || body.yard_access_notes || "",
    community_access_type: body.community_access_type || "no",
    community_access_instructions_encrypted: body.community_access_instructions_encrypted || body.community_access_instructions || "",
    grass_height_range: body.grass_height_range || "",
    service_frequency: body.service_frequency || "",
    pets: body.pets || "",
    pet_waste_level: body.pet_waste_level || "",
    obstacles_list: listField(body.obstacles_list),
    requested_tasks: listField(body.requested_tasks || body.requestedTasks),
    customer_notes: body.customer_notes || body.notes || "",
    available_days_json: listField(body.available_days_json || body.availableDays),
    time_preference: body.time_preference || "",
    schedule_flexibility: body.schedule_flexibility || "",
    available_date_start: body.available_date_start || null,
    available_date_end: body.available_date_end || null,
    specific_service_date: body.specific_service_date || null,
    estimated_price_low: body.estimated_price_low ? Number(body.estimated_price_low) : null,
    estimated_price_high: body.estimated_price_high ? Number(body.estimated_price_high) : null,
    final_price: body.final_price ? Number(body.final_price) : null,
    scope_locked: Boolean(body.scope_locked),
    included_tasks_json: listField(body.included_tasks_json),
    excluded_tasks_json: listField(body.excluded_tasks_json)
  };
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
  const outFields = '*';

  if (lat && lng) {
    const polygonHit = await fetchLayerQuery(6, {
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      outSR: "4326",
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
      outSR: "4326",
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
        outSR: "4326",
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
      outSR: "4326",
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
  const attrs = { ...(feature.properties || {}), ...(feature.attributes || {}) };
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

  let areaSqft = acres > 0 ? Math.round(acres * 43560) : 0;
  if (!areaSqft && attrs) {
    areaSqft = normalizeParcelAreaSqft(attrs);
  }
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

app.get("/api/admin/phone-verification/health", requireAuth, requireRole("admin"), (_req, res) => {
  res.json(getPhoneVerificationHealth());
});

app.get("/api/config", async (_req, res) => {
  try {
    const settings = await loadSettingsFromDb();
    res.json({
      ok: true,
      appName: settings.appName,
      siteBrand: SITE_BRAND,
      siteMode: SITE_MODE,
      publicDomain: PUBLIC_DOMAIN,
      primaryRegion: PRIMARY_REGION,
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

const SERVICE_PRICING_NUMBER_FIELDS = ["baseFee", "ratePer1000Sqft", "minimumPrice"];

function hasOwn(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field);
}

function badServiceSettingsRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function coerceServicePricingNumber(value, field, serviceId) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw badServiceSettingsRequest(`Invalid ${field} for service ${serviceId}`);
  }
  if (number < 0) {
    throw badServiceSettingsRequest(`${field} cannot be negative for service ${serviceId}`);
  }
  return number;
}

function coerceServiceActive(value, serviceId) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return Boolean(value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  throw badServiceSettingsRequest(`Invalid active value for service ${serviceId}`);
}

function mergeServiceSettings(existingService, incomingService) {
  const next = { ...existingService };
  const serviceId = String(existingService.id);

  for (const field of SERVICE_PRICING_NUMBER_FIELDS) {
    if (hasOwn(incomingService, field)) {
      next[field] = coerceServicePricingNumber(incomingService[field], field, serviceId);
    }
  }

  if (hasOwn(incomingService, "active")) {
    next.active = coerceServiceActive(incomingService.active, serviceId);
  }

  for (const field of ["name", "label"]) {
    if (hasOwn(incomingService, field)) {
      const value = String(incomingService[field] || "").trim();
      if (!value) throw badServiceSettingsRequest(`Invalid ${field} for service ${serviceId}`);
      next[field] = value;
    }
  }

  if (hasOwn(incomingService, "sortOrder")) {
    const sortOrder = Number(incomingService.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      throw badServiceSettingsRequest(`Invalid sortOrder for service ${serviceId}`);
    }
    next.sortOrder = sortOrder;
  }

  next.id = existingService.id;
  return next;
}

async function syncServiceSettingsToDb(services, updatedIds) {
  if (!updatedIds.size) return;
  try {
    await Promise.all(services
      .filter((service) => updatedIds.has(String(service.id)))
      .map((service) => pgdb.query(
        `
        UPDATE services
        SET
          name = COALESCE($2, name),
          base_fee = $3,
          rate_per_1000_sqft = $4,
          minimum_price = $5,
          active = $6,
          sort_order = COALESCE($7, sort_order),
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          service.id,
          service.name || service.label || null,
          Number(service.baseFee || 0),
          Number(service.ratePer1000Sqft || 0),
          Number(service.minimumPrice || 0),
          service.active !== false,
          service.sortOrder != null ? Number(service.sortOrder) : null
        ]
      )));
  } catch (error) {
    console.warn("Could not sync service settings to DB:", error.message);
  }
}

app.get("/api/admin/settings/services", requireAuth, requireRole("admin"), (_req, res) => {
  try {
    const settings = readSettingsFile();
    res.json({ ok: true, services: Array.isArray(settings.services) ? settings.services : [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/admin/settings/services", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const incomingServices = req.body?.services;
    if (!Array.isArray(incomingServices)) {
      return res.status(400).json({ ok: false, error: "services must be an array" });
    }

    const settings = readSettingsFile();
    const existingServices = Array.isArray(settings.services) ? settings.services : [];
    const servicesById = new Map(existingServices.map((service) => [String(service.id), service]));
    const updatesById = new Map();
    const seenIds = new Set();

    for (const incomingService of incomingServices) {
      if (!incomingService || typeof incomingService !== "object" || Array.isArray(incomingService)) {
        throw badServiceSettingsRequest("Each service must be an object");
      }

      const serviceId = String(incomingService.id || "").trim();
      if (!serviceId || !servicesById.has(serviceId)) {
        throw badServiceSettingsRequest(`Unknown service id: ${serviceId || "(missing)"}`);
      }
      if (seenIds.has(serviceId)) {
        throw badServiceSettingsRequest(`Duplicate service id: ${serviceId}`);
      }

      seenIds.add(serviceId);
      updatesById.set(serviceId, mergeServiceSettings(servicesById.get(serviceId), incomingService));
    }

    const nextSettings = {
      ...settings,
      services: existingServices.map((service) => updatesById.get(String(service.id)) || service)
    };

    writeSettingsFile(nextSettings);
    await syncServiceSettingsToDb(nextSettings.services, seenIds);

    res.json({ ok: true, services: nextSettings.services });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
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

/* -----------------------------------------------------------------------
   Admin terrain settings — GET / PATCH / test
   ----------------------------------------------------------------------- */

/** Read terrain_settings from DB row, merged with env defaults. */
async function loadTerrainSettings() {
  try {
    const result = await pgdb.query("SELECT terrain_settings FROM app_settings WHERE id = 1 LIMIT 1");
    const db = result.rows[0]?.terrain_settings || {};
    return {
      mode:                       db.mode           || process.env.TERRAIN_MODE                    || "off",
      provider:                   db.provider       || process.env.TERRAIN_ELEVATION_PROVIDER       || "usgs_epqs",
      samplePoints:               db.samplePoints   != null ? Number(db.samplePoints) : parseInt(process.env.TERRAIN_SAMPLE_POINTS || "9", 10),
      cacheTtlHours:              db.cacheTtlHours  != null ? Number(db.cacheTtlHours) : parseFloat(process.env.TERRAIN_CACHE_TTL_HOURS || "168"),
      customerUI:                 db.customerUI     != null ? Boolean(db.customerUI) : (process.env.TERRAIN_ENABLE_CUSTOMER_UI || "true") !== "false",
      debug:                      db.debug          != null ? Boolean(db.debug) : (process.env.TERRAIN_DEBUG || "false") === "true",
      instantBookingMaxCategory:  db.instantBookingMaxCategory  || process.env.TERRAIN_INSTANT_BOOKING_MAX_CATEGORY || "High",
      instantBookingMaxScore:     db.instantBookingMaxScore     != null ? Number(db.instantBookingMaxScore)    : parseFloat(process.env.TERRAIN_INSTANT_BOOKING_MAX_SCORE || "8.0"),
      blockExtremeInstantPay:     db.blockExtremeInstantPay     != null ? Boolean(db.blockExtremeInstantPay)  : (process.env.TERRAIN_BLOCK_EXTREME_INSTANT_PAY || "true") !== "false",
      manualReviewMessage:        db.manualReviewMessage        || DEFAULT_TERRAIN_MANUAL_REVIEW_MESSAGE,
    };
  } catch (_) {
    return {
      mode:                       process.env.TERRAIN_MODE                    || "off",
      provider:                   process.env.TERRAIN_ELEVATION_PROVIDER       || "usgs_epqs",
      samplePoints:               parseInt(process.env.TERRAIN_SAMPLE_POINTS  || "9", 10),
      cacheTtlHours:              parseFloat(process.env.TERRAIN_CACHE_TTL_HOURS || "168"),
      customerUI:                 (process.env.TERRAIN_ENABLE_CUSTOMER_UI || "true") !== "false",
      debug:                      (process.env.TERRAIN_DEBUG || "false") === "true",
      instantBookingMaxCategory:  process.env.TERRAIN_INSTANT_BOOKING_MAX_CATEGORY || "High",
      instantBookingMaxScore:     parseFloat(process.env.TERRAIN_INSTANT_BOOKING_MAX_SCORE || "8.0"),
      blockExtremeInstantPay:     (process.env.TERRAIN_BLOCK_EXTREME_INSTANT_PAY || "true") !== "false",
      manualReviewMessage:        DEFAULT_TERRAIN_MANUAL_REVIEW_MESSAGE,
    };
  }
}

app.get("/api/admin/settings/terrain", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const settings  = await loadTerrainSettings();
    const providers = listTerrainProviders();
    res.json({ ok: true, settings, providers, cacheSize: terrainCacheSize() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/admin/settings/terrain", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body    = req.body || {};
    const current = await loadTerrainSettings();
    const VALID_MODES     = ["off", "display_only", "pricing_enabled"];
    const VALID_PROVIDERS = listTerrainProviders();
    const VALID_SAMPLES   = [5, 9, 13, 17];

    const VALID_MAX_CATEGORIES = ["Flat", "Moderate", "High", "Extreme"];
    const next = {
      mode:                      VALID_MODES.includes(body.mode)          ? body.mode     : current.mode,
      provider:                  VALID_PROVIDERS.includes(body.provider)  ? body.provider : current.provider,
      samplePoints:              VALID_SAMPLES.includes(Number(body.samplePoints)) ? Number(body.samplePoints) : current.samplePoints,
      cacheTtlHours:             body.cacheTtlHours != null ? Math.max(0, Number(body.cacheTtlHours)) : current.cacheTtlHours,
      customerUI:                body.customerUI    != null ? Boolean(body.customerUI) : current.customerUI,
      debug:                     body.debug         != null ? Boolean(body.debug)      : current.debug,
      instantBookingMaxCategory: VALID_MAX_CATEGORIES.includes(body.instantBookingMaxCategory) ? body.instantBookingMaxCategory : current.instantBookingMaxCategory,
      instantBookingMaxScore:    body.instantBookingMaxScore != null ? Math.min(10, Math.max(0, Number(body.instantBookingMaxScore))) : current.instantBookingMaxScore,
      blockExtremeInstantPay:    body.blockExtremeInstantPay != null ? Boolean(body.blockExtremeInstantPay) : current.blockExtremeInstantPay,
      manualReviewMessage:       typeof body.manualReviewMessage === "string" ? body.manualReviewMessage.slice(0, 1000) : current.manualReviewMessage,
    };

    await pgdb.query(
      `INSERT INTO app_settings (id, terrain_settings, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET terrain_settings = EXCLUDED.terrain_settings, updated_at = NOW()`,
      [JSON.stringify(next)]
    );

    // Apply to process.env so the running instance picks up the change immediately
    process.env.TERRAIN_MODE                              = next.mode;
    process.env.TERRAIN_ELEVATION_PROVIDER               = next.provider;
    process.env.TERRAIN_SAMPLE_POINTS                    = String(next.samplePoints);
    process.env.TERRAIN_CACHE_TTL_HOURS                  = String(next.cacheTtlHours);
    process.env.TERRAIN_ENABLE_CUSTOMER_UI               = next.customerUI ? "true" : "false";
    process.env.TERRAIN_DEBUG                            = next.debug ? "true" : "false";
    process.env.TERRAIN_INSTANT_BOOKING_MAX_CATEGORY     = next.instantBookingMaxCategory;
    process.env.TERRAIN_INSTANT_BOOKING_MAX_SCORE        = String(next.instantBookingMaxScore);
    process.env.TERRAIN_BLOCK_EXTREME_INSTANT_PAY        = next.blockExtremeInstantPay ? "true" : "false";

    // Clear cache when settings change (provider/mode switch)
    terrainCacheClear();

    res.json({ ok: true, settings: next });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/settings/terrain/test", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await calculateTerrain({
      parcelGeoJson:  body.parcelGeoJson  || undefined,
      mowableGeoJson: body.mowableGeoJson || undefined,
      lat:            body.lat   != null ? Number(body.lat)   : undefined,
      lng:            body.lng   != null ? Number(body.lng)   : undefined,
      address:        body.address || undefined,
      _adminOverrides: {
        mode:     body.mode     || undefined,
        provider: body.provider || undefined,
      },
    }).catch((err) => ({ available: false, error: err?.message }));

    res.json({ ok: true, terrain: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -----------------------------------------------------------------------
   Terrain manual review request — customer submits when blocked by guardrail
   ----------------------------------------------------------------------- */

app.post("/api/terrain/manual-review-request", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const review = {
      id:             nanoid(12),
      createdAt:      new Date().toISOString(),
      status:         "new",
      customerName:   String(body.customerName || body.name || "").trim().slice(0, 200),
      customerPhone:  String(body.customerPhone || body.phone || "").trim().slice(0, 30),
      customerEmail:  String(body.customerEmail || body.email || "").trim().slice(0, 200),
      address:        String(body.address || "").trim().slice(0, 300),
      city:           String(body.city || "").trim().slice(0, 100),
      state:          String(body.state || "").trim().slice(0, 50),
      zip:            String(body.zip || "").trim().slice(0, 20),
      estimate:       Number(body.estimate || 0) || null,
      terrain: body.terrain && typeof body.terrain === "object" ? {
        difficultyScore:    body.terrain.difficultyScore,
        difficultyCategory: body.terrain.difficultyCategory,
        elevationChangeFt:  body.terrain.elevationChangeFt,
        averageGradePercent: body.terrain.averageGradePercent,
        maxGradePercent:    body.terrain.maxGradePercent,
        terrainGuardrail:   body.terrain.terrainGuardrail,
      } : null,
      reasonCode:     String(body.reasonCode || "").trim().slice(0, 100),
      parcelGeoJson:  body.parcelGeoJson || body.parcelGeoJSON || null,
      mowableGeoJson: body.mowableGeoJson || body.mowableGeoJSON || body.selectedMowableGeoJSON || null,
      notes:          String(body.notes || body.message || "").trim().slice(0, 2000),
    };

    const reviews = readJsonArray(TERRAIN_MANUAL_REVIEWS_FILE);
    reviews.push(review);
    writeJsonArray(TERRAIN_MANUAL_REVIEWS_FILE, reviews);

    res.json({ ok: true, id: review.id, message: "Manual review request submitted." });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/terrain/manual-review-requests", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const reviews = readJsonArray(TERRAIN_MANUAL_REVIEWS_FILE);
    res.json({ ok: true, reviews: reviews.slice().reverse() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── AI DETECTION TUNING — admin-only endpoints ──────────────────────────────
const AI_TUNING_PRESETS_FILE = path.join(__dirname, "../data/ai_tuning_presets.json");
const AI_TEST_PARCELS_FILE   = path.join(__dirname, "../data/ai_test_parcels.json");
const VISION_URL_FOR_ADMIN   = () => (process.env.TURFLYNK_VISION_URL || process.env.VISION_SERVICE_URL || "http://127.0.0.1:8017").replace(/\/$/, "");

function readAiJsonFile(filePath, fallback = []) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { return fallback; }
}
function writeAiJsonFile(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// GET /api/admin/ai-tuning/presets
app.get("/api/admin/ai-tuning/presets", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ ok: true, presets: readAiJsonFile(AI_TUNING_PRESETS_FILE) });
});

// POST /api/admin/ai-tuning/presets — upsert a preset by name (draft/validated only — never overwrites production)
app.post("/api/admin/ai-tuning/presets", requireAuth, requireRole("admin"), (req, res) => {
  const {
    name, label, description, basePreset, thresholds, status,
    // New enriched metadata fields (all optional, backward-compatible)
    notes, parcelLabel, parcelAddress, detectionMode, confidenceScore, settingsFingerprint,
  } = req.body || {};
  if (!name || !thresholds) return res.status(400).json({ ok: false, error: "name and thresholds required" });
  const validStatuses = ["draft", "validated"];
  const safeStatus = validStatuses.includes(status) ? status : "draft";
  const presets = readAiJsonFile(AI_TUNING_PRESETS_FILE);
  const idx = presets.findIndex((p) => p.name === name);
  if (idx >= 0) {
    const existing = presets[idx];
    const existingStatus = existing.status || (existing.isProduction ? "production" : "draft");
    if (existingStatus === "production") {
      return res.status(400).json({ ok: false, error: "Cannot overwrite a production preset via normal save. Use the promote endpoint or archive it first." });
    }
  }
  const now = new Date().toISOString();
  const record = {
    name, label: label || name,
    description: description || notes || "",
    notes: notes || description || "",
    basePreset: basePreset || "medium_residential", thresholds,
    status: safeStatus, isProduction: false,
    // Enriched metadata — nullable, safe for old clients that don't send them
    parcelLabel:          parcelLabel          || null,
    parcelAddress:        parcelAddress        || null,
    detectionMode:        detectionMode        || null,
    confidenceScore:      confidenceScore      != null ? Number(confidenceScore) : null,
    settingsFingerprint:  settingsFingerprint  || null,
    savedAt: idx >= 0 ? (presets[idx].savedAt || now) : now,
    updatedAt: now,
  };
  if (idx >= 0) presets[idx] = record; else presets.push(record);
  writeAiJsonFile(AI_TUNING_PRESETS_FILE, presets);
  res.json({ ok: true, preset: record });
});

// PATCH /api/admin/ai-tuning/presets/:name/label — rename display label (does not change internal name key)
app.patch("/api/admin/ai-tuning/presets/:name/label", requireAuth, requireRole("admin"), (req, res) => {
  const { label, notes } = req.body || {};
  if (!label?.trim()) return res.status(400).json({ ok: false, error: "label is required" });
  const presets = readAiJsonFile(AI_TUNING_PRESETS_FILE);
  const idx = presets.findIndex((p) => p.name === req.params.name);
  if (idx < 0) return res.status(404).json({ ok: false, error: "Preset not found" });
  presets[idx].label = label.trim().slice(0, 120);
  if (notes !== undefined) {
    presets[idx].notes = String(notes || "").slice(0, 500);
    presets[idx].description = presets[idx].notes;
  }
  presets[idx].updatedAt = new Date().toISOString();
  writeAiJsonFile(AI_TUNING_PRESETS_FILE, presets);
  res.json({ ok: true, preset: presets[idx] });
});

// POST /api/admin/ai-tuning/presets/:name/duplicate — copy a preset with a new unique name
app.post("/api/admin/ai-tuning/presets/:name/duplicate", requireAuth, requireRole("admin"), (req, res) => {
  const presets = readAiJsonFile(AI_TUNING_PRESETS_FILE);
  const src = presets.find((p) => p.name === req.params.name);
  if (!src) return res.status(404).json({ ok: false, error: "Preset not found" });
  const now = new Date();
  const ts = `${(now.getMonth()+1).toString().padStart(2,"0")}${now.getDate().toString().padStart(2,"0")}-${now.getHours().toString().padStart(2,"0")}${now.getMinutes().toString().padStart(2,"0")}`;
  // Build a unique name: slug of existing name + timestamp
  const baseSlug = src.name.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").slice(0, 28).replace(/-$/, "");
  let newName = `${baseSlug}-copy-${ts}`;
  // Ensure uniqueness
  let suffix = 2;
  while (presets.some((p) => p.name === newName)) { newName = `${baseSlug}-copy-${ts}-${suffix++}`; }
  const record = {
    ...src,
    name: newName,
    label: `${src.label || src.name} (copy)`,
    status: "draft",
    isProduction: false,
    savedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    promotedAt: undefined,
    archivedAt: undefined,
  };
  delete record.promotedAt;
  delete record.archivedAt;
  presets.push(record);
  writeAiJsonFile(AI_TUNING_PRESETS_FILE, presets);
  res.json({ ok: true, preset: record });
});

// PATCH /api/admin/ai-tuning/presets/:name/status — change status (draft ↔ validated, or archive)
app.patch("/api/admin/ai-tuning/presets/:name/status", requireAuth, requireRole("admin"), (req, res) => {
  const { status } = req.body || {};
  const allowed = ["draft", "validated", "archived"];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: `status must be one of: ${allowed.join(", ")}` });
  const presets = readAiJsonFile(AI_TUNING_PRESETS_FILE);
  const idx = presets.findIndex((p) => p.name === req.params.name);
  if (idx < 0) return res.status(404).json({ ok: false, error: "Preset not found" });
  const current = presets[idx].status || (presets[idx].isProduction ? "production" : "draft");
  if (current === "production") {
    return res.status(400).json({ ok: false, error: "Cannot change production preset status. Use the promote endpoint to demote it first." });
  }
  presets[idx].status = status;
  presets[idx].isProduction = false;
  presets[idx].statusUpdatedAt = new Date().toISOString();
  writeAiJsonFile(AI_TUNING_PRESETS_FILE, presets);
  res.json({ ok: true, preset: presets[idx] });
});

// POST /api/admin/ai-tuning/presets/:name/promote — promote to production, auto-archive previous production
app.post("/api/admin/ai-tuning/presets/:name/promote", requireAuth, requireRole("admin"), (req, res) => {
  const presets = readAiJsonFile(AI_TUNING_PRESETS_FILE);
  const idx = presets.findIndex((p) => p.name === req.params.name);
  if (idx < 0) return res.status(404).json({ ok: false, error: "Preset not found" });
  const candidateStatus = presets[idx].status || (presets[idx].isProduction ? "production" : "draft");
  if (candidateStatus === "archived") return res.status(400).json({ ok: false, error: "Cannot promote an archived preset. Unarchive it first." });
  const archivedNames = [];
  for (const p of presets) {
    if ((p.status === "production" || p.isProduction) && p.name !== req.params.name) {
      p.status = "archived";
      p.isProduction = false;
      p.archivedAt = new Date().toISOString();
      archivedNames.push(p.name);
    }
  }
  presets[idx].status = "production";
  presets[idx].isProduction = true;
  presets[idx].promotedAt = new Date().toISOString();
  writeAiJsonFile(AI_TUNING_PRESETS_FILE, presets);
  res.json({ ok: true, preset: presets[idx], archivedPrev: archivedNames });
});

// DELETE /api/admin/ai-tuning/presets/:name — blocked for production presets
app.delete("/api/admin/ai-tuning/presets/:name", requireAuth, requireRole("admin"), (req, res) => {
  const presets = readAiJsonFile(AI_TUNING_PRESETS_FILE);
  const target = presets.find((p) => p.name === req.params.name);
  if (target && (target.status === "production" || target.isProduction)) {
    return res.status(400).json({ ok: false, error: "Cannot delete a production preset. Archive it first." });
  }
  writeAiJsonFile(AI_TUNING_PRESETS_FILE, presets.filter((p) => p.name !== req.params.name));
  res.json({ ok: true });
});

// GET /api/admin/ai-tuning/test-parcels
app.get("/api/admin/ai-tuning/test-parcels", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ ok: true, parcels: readAiJsonFile(AI_TEST_PARCELS_FILE) });
});

// POST /api/admin/ai-tuning/test-parcels
app.post("/api/admin/ai-tuning/test-parcels", requireAuth, requireRole("admin"), (req, res) => {
  const { label, address, parcelGeoJson, lat, lng, notes, category } = req.body || {};
  if (!label || !parcelGeoJson) return res.status(400).json({ ok: false, error: "label and parcelGeoJson required" });
  const parcels = readAiJsonFile(AI_TEST_PARCELS_FILE);
  const record = { id: nanoid(8), label, address: address || "", parcelGeoJson, lat, lng, notes: notes || "", category: category || "general", savedAt: new Date().toISOString() };
  parcels.push(record);
  writeAiJsonFile(AI_TEST_PARCELS_FILE, parcels);
  res.json({ ok: true, parcel: record });
});

// DELETE /api/admin/ai-tuning/test-parcels/:id
app.delete("/api/admin/ai-tuning/test-parcels/:id", requireAuth, requireRole("admin"), (req, res) => {
  const parcels = readAiJsonFile(AI_TEST_PARCELS_FILE).filter((p) => p.id !== req.params.id);
  writeAiJsonFile(AI_TEST_PARCELS_FILE, parcels);
  res.json({ ok: true });
});

// POST /api/admin/ai-tuning/detect — proxy to vision /detect-debug (admin only)
app.post("/api/admin/ai-tuning/detect", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const upstream = await fetch(`${VISION_URL_FOR_ADMIN()}/detect-debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
  } catch (err) {
    res.status(503).json({ ok: false, error: "Vision service unavailable", detail: err.message });
  }
});

// GET /api/admin/ai-tuning/built-in-presets — fetch preset definitions from vision service
app.get("/api/admin/ai-tuning/built-in-presets", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const upstream = await fetch(`${VISION_URL_FOR_ADMIN()}/debug/presets`);
    const json = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(json);
  } catch (err) {
    res.status(503).json({ ok: false, error: "Vision service unavailable", detail: err.message });
  }
});

// ── AI TUNING PRO: Ground Truth Annotations ──────────────────────────────────
// Admin-only. Stores parcel annotations (tags, notes) for ML training support.
// Does NOT affect production detection or customer-facing flows.

const AI_GT_PATH = path.join(__dirname, "..", "data", "ai_ground_truth.json");

function readGroundTruth() {
  try {
    if (!existsSync(AI_GT_PATH)) return {};
    return JSON.parse(readFileSync(AI_GT_PATH, "utf8"));
  } catch { return {}; }
}

function writeGroundTruth(data) {
  writeFileSync(AI_GT_PATH, JSON.stringify(data, null, 2), "utf8");
}

app.get("/api/admin/ai-tuning/ground-truth", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ ok: true, annotations: readGroundTruth() });
});

app.post("/api/admin/ai-tuning/ground-truth", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { parcelHash, tags, notes, manualAreas, savedAt } = req.body || {};
    if (!parcelHash) return res.status(400).json({ ok: false, error: "parcelHash required" });
    const all = readGroundTruth();
    all[parcelHash] = {
      tags: Array.isArray(tags) ? tags : [],
      notes: String(notes || "").slice(0, 1000),
      manualAreas: manualAreas || null,
      savedAt: savedAt || new Date().toISOString(),
      savedBy: req.user?.email || "admin",
    };
    writeGroundTruth(all);
    res.json({ ok: true, annotation: all[parcelHash] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/ai-tuning/ground-truth/:hash", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const all = readGroundTruth();
    if (!all[req.params.hash]) return res.status(404).json({ ok: false, error: "Not found" });
    delete all[req.params.hash];
    writeGroundTruth(all);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── AI TUNING PRO: Experiment Snapshots ──────────────────────────────────────
// Persists named experiment snapshots server-side (per-admin session).
// Complements the client-side localStorage snapshots with server-backed storage.

const AI_SNAPSHOTS_PATH = path.join(__dirname, "..", "data", "ai_experiment_snapshots.json");

function readSnapshots() {
  try {
    if (!existsSync(AI_SNAPSHOTS_PATH)) return [];
    return JSON.parse(readFileSync(AI_SNAPSHOTS_PATH, "utf8"));
  } catch { return []; }
}

function writeSnapshots(arr) {
  writeFileSync(AI_SNAPSHOTS_PATH, JSON.stringify(arr, null, 2), "utf8");
}

app.get("/api/admin/ai-tuning/experiment-snapshots", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ ok: true, snapshots: readSnapshots() });
});

app.post("/api/admin/ai-tuning/experiment-snapshots", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { name, overrides, basePreset, resultSummary } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    const all = readSnapshots();
    const snapshot = {
      id: "snap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      name: String(name).slice(0, 100),
      overrides: overrides || {},
      basePreset: basePreset || "medium_residential",
      resultSummary: resultSummary || null,
      savedAt: new Date().toISOString(),
      savedBy: req.user?.email || "admin",
    };
    all.push(snapshot);
    // Keep last 50 server snapshots
    if (all.length > 50) all.splice(0, all.length - 50);
    writeSnapshots(all);
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/ai-tuning/experiment-snapshots/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const all = readSnapshots().filter((s) => s.id !== req.params.id);
    writeSnapshots(all);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── END AI DETECTION TUNING ──────────────────────────────────────────────────

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

/* =========================================================
   PRICE TIERS — admin CRUD for tiered/bracket pricing
   GET  /api/price-tiers          — all tiers (optionally ?serviceId=)
   POST /api/price-tiers          — create tier
   PUT  /api/price-tiers/:id      — update tier
   DELETE /api/price-tiers/:id    — remove tier
   ========================================================= */

app.get("/api/price-tiers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const serviceId = req.query.serviceId;
    const result = serviceId
      ? await pgdb.query(
          "SELECT * FROM price_tiers WHERE service_id = $1 ORDER BY sort_order ASC, min_sqft ASC",
          [serviceId]
        )
      : await pgdb.query("SELECT * FROM price_tiers ORDER BY service_id, sort_order ASC, min_sqft ASC");
    res.json({
      ok: true,
      tiers: result.rows.map((t) => ({
        id: t.id,
        serviceId: t.service_id,
        minSqft: Number(t.min_sqft || 0),
        maxSqft: t.max_sqft != null ? Number(t.max_sqft) : null,
        ratePer1000Sqft: Number(t.rate_per_1000_sqft || 0),
        label: t.label || "",
        sortOrder: Number(t.sort_order || 0),
        active: Boolean(t.active)
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/price-tiers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.serviceId) return res.status(400).json({ ok: false, error: "serviceId required" });
    if (body.minSqft == null) return res.status(400).json({ ok: false, error: "minSqft required" });
    if (body.ratePer1000Sqft == null) return res.status(400).json({ ok: false, error: "ratePer1000Sqft required" });
    const result = await pgdb.query(
      `INSERT INTO price_tiers (id, service_id, min_sqft, max_sqft, rate_per_1000_sqft, label, sort_order, active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
      [
        nanoid(10),
        String(body.serviceId),
        Number(body.minSqft),
        body.maxSqft != null ? Number(body.maxSqft) : null,
        Number(body.ratePer1000Sqft),
        String(body.label || ""),
        Number(body.sortOrder || 0),
        body.active !== false
      ]
    );
    const t = result.rows[0];
    res.status(201).json({
      ok: true,
      tier: {
        id: t.id, serviceId: t.service_id, minSqft: Number(t.min_sqft), maxSqft: t.max_sqft != null ? Number(t.max_sqft) : null,
        ratePer1000Sqft: Number(t.rate_per_1000_sqft), label: t.label || "", sortOrder: Number(t.sort_order), active: Boolean(t.active)
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/price-tiers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await pgdb.query(
      `UPDATE price_tiers SET
        min_sqft = COALESCE($2, min_sqft),
        max_sqft = CASE WHEN $3::boolean THEN $4::integer ELSE max_sqft END,
        rate_per_1000_sqft = COALESCE($5, rate_per_1000_sqft),
        label = COALESCE($6, label),
        sort_order = COALESCE($7, sort_order),
        active = COALESCE($8, active),
        updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        body.minSqft != null ? Number(body.minSqft) : null,
        "maxSqft" in body,
        body.maxSqft != null ? Number(body.maxSqft) : null,
        body.ratePer1000Sqft != null ? Number(body.ratePer1000Sqft) : null,
        body.label != null ? String(body.label) : null,
        body.sortOrder != null ? Number(body.sortOrder) : null,
        body.active != null ? Boolean(body.active) : null
      ]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Tier not found" });
    const t = result.rows[0];
    res.json({
      ok: true,
      tier: {
        id: t.id, serviceId: t.service_id, minSqft: Number(t.min_sqft), maxSqft: t.max_sqft != null ? Number(t.max_sqft) : null,
        ratePer1000Sqft: Number(t.rate_per_1000_sqft), label: t.label || "", sortOrder: Number(t.sort_order), active: Boolean(t.active)
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/price-tiers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pgdb.query("DELETE FROM price_tiers WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Tier not found" });
    res.json({ ok: true, deleted: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   BULK / VOLUME PRICING TIERS — admin-controlled sliding-scale
   GET    /api/admin/bulk-tiers       — list all tiers
   POST   /api/admin/bulk-tiers       — create tier
   PUT    /api/admin/bulk-tiers/:id   — update tier
   DELETE /api/admin/bulk-tiers/:id   — delete tier
   POST   /api/admin/bulk-tiers/seed  — (re)seed defaults if empty
   ========================================================= */

function rowToBulkTier(t) {
  return {
    id: t.id,
    label: t.label || "",
    enabled: Boolean(t.enabled),
    startSqft: Number(t.start_sqft || 0),
    endSqft: t.end_sqft != null ? Number(t.end_sqft) : null,
    ratePer1000Sqft: Number(t.rate_per_1000_sqft || 0),
    sortOrder: Number(t.sort_order || 0)
  };
}

app.get("/api/admin/bulk-tiers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pgdb.query("SELECT * FROM bulk_pricing_tiers ORDER BY sort_order ASC, start_sqft ASC");
    res.json({ ok: true, tiers: result.rows.map(rowToBulkTier) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/bulk-tiers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    if (body.startSqft == null) return res.status(400).json({ ok: false, error: "startSqft required" });
    if (body.ratePer1000Sqft == null) return res.status(400).json({ ok: false, error: "ratePer1000Sqft required" });
    const result = await pgdb.query(
      `INSERT INTO bulk_pricing_tiers (id, label, enabled, start_sqft, end_sqft, rate_per_1000_sqft, sort_order, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [
        nanoid(10),
        String(body.label || ""),
        body.enabled !== false,
        Number(body.startSqft),
        body.endSqft != null ? Number(body.endSqft) : null,
        Number(body.ratePer1000Sqft),
        Number(body.sortOrder || 0)
      ]
    );
    res.status(201).json({ ok: true, tier: rowToBulkTier(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/admin/bulk-tiers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await pgdb.query(
      `UPDATE bulk_pricing_tiers SET
        label = COALESCE($2, label),
        enabled = COALESCE($3, enabled),
        start_sqft = COALESCE($4, start_sqft),
        end_sqft = CASE WHEN $5::boolean THEN $6::integer ELSE end_sqft END,
        rate_per_1000_sqft = COALESCE($7, rate_per_1000_sqft),
        sort_order = COALESCE($8, sort_order),
        updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        body.label != null ? String(body.label) : null,
        body.enabled != null ? Boolean(body.enabled) : null,
        body.startSqft != null ? Number(body.startSqft) : null,
        "endSqft" in body,
        body.endSqft != null ? Number(body.endSqft) : null,
        body.ratePer1000Sqft != null ? Number(body.ratePer1000Sqft) : null,
        body.sortOrder != null ? Number(body.sortOrder) : null
      ]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Tier not found" });
    res.json({ ok: true, tier: rowToBulkTier(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/bulk-tiers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pgdb.query("DELETE FROM bulk_pricing_tiers WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Tier not found" });
    res.json({ ok: true, deleted: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/bulk-tiers/seed", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const existing = await pgdb.query("SELECT 1 FROM bulk_pricing_tiers LIMIT 1");
    if (existing.rows.length) return res.json({ ok: true, seeded: false, message: "Tiers already exist — delete all before re-seeding." });
    const defaults = [
      { id: 'bulk_std',   label: 'Standard (0–8,000 sq ft)',        enabled: true, start: 0,     end: 8000,  rate: 4.50, order: 0 },
      { id: 'bulk_med',   label: 'Volume (8,001–15,000 sq ft)',      enabled: true, start: 8000,  end: 15000, rate: 3.80, order: 1 },
      { id: 'bulk_large', label: 'Large lawn (15,001–30,000 sq ft)', enabled: true, start: 15000, end: 30000, rate: 3.25, order: 2 },
      { id: 'bulk_open',  label: 'Open lawn (30,001+ sq ft)',        enabled: true, start: 30000, end: null,  rate: 2.75, order: 3 },
    ];
    for (const d of defaults) {
      await pgdb.query(
        `INSERT INTO bulk_pricing_tiers (id, label, enabled, start_sqft, end_sqft, rate_per_1000_sqft, sort_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO NOTHING`,
        [d.id, d.label, d.enabled, d.start, d.end, d.rate, d.order]
      );
    }
    res.json({ ok: true, seeded: true, count: defaults.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   PROVIDER SERVICE PRICING — per-service overrides
   GET  /api/provider/pricing      — provider's per-service pricing
   PUT  /api/provider/pricing      — save per-service pricing
   ========================================================= */

app.get("/api/provider/pricing", requireAuth, providerAccessMiddleware, async (req, res) => {
  try {
    if (req.user.role === "admin") return res.json({ ok: true, pricing: [] });
    const provider = await ensureProviderProfileForUser(req.user, {});
    const result = await pgdb.query(
      "SELECT * FROM provider_service_pricing WHERE provider_id = $1 ORDER BY service_id",
      [provider.id]
    );
    res.json({
      ok: true,
      pricing: result.rows.map((r) => ({
        serviceId: r.service_id,
        baseFee: r.base_fee != null ? Number(r.base_fee) : null,
        ratePer1000Sqft: r.rate_per_1000_sqft != null ? Number(r.rate_per_1000_sqft) : null,
        minimumPrice: r.minimum_price != null ? Number(r.minimum_price) : null,
        enabled: Boolean(r.enabled),
        notes: r.notes || ""
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/pricing", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const body = req.body || {};
    const rows = Array.isArray(body.pricing) ? body.pricing : [];
    const provider = await ensureProviderProfileForUser(req.user, {});
    for (const item of rows) {
      if (!item.serviceId) continue;
      await pgdb.query(
        `INSERT INTO provider_service_pricing (id, provider_id, service_id, base_fee, rate_per_1000_sqft, minimum_price, enabled, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (provider_id, service_id) DO UPDATE SET
           base_fee = EXCLUDED.base_fee,
           rate_per_1000_sqft = EXCLUDED.rate_per_1000_sqft,
           minimum_price = EXCLUDED.minimum_price,
           enabled = EXCLUDED.enabled,
           notes = EXCLUDED.notes,
           updated_at = NOW()`,
        [
          nanoid(10),
          provider.id,
          String(item.serviceId),
          item.baseFee != null ? Number(item.baseFee) : null,
          item.ratePer1000Sqft != null ? Number(item.ratePer1000Sqft) : null,
          item.minimumPrice != null ? Number(item.minimumPrice) : null,
          item.enabled !== false,
          String(item.notes || "").slice(0, 1000)
        ]
      );
    }
    const saved = await pgdb.query(
      "SELECT * FROM provider_service_pricing WHERE provider_id = $1 ORDER BY service_id",
      [provider.id]
    );
    res.json({
      ok: true,
      pricing: saved.rows.map((r) => ({
        serviceId: r.service_id,
        baseFee: r.base_fee != null ? Number(r.base_fee) : null,
        ratePer1000Sqft: r.rate_per_1000_sqft != null ? Number(r.rate_per_1000_sqft) : null,
        minimumPrice: r.minimum_price != null ? Number(r.minimum_price) : null,
        enabled: Boolean(r.enabled),
        notes: r.notes || ""
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/estimate", async (req, res) => {
  try {
    const _body = req.body || {};
    console.log('[TurfLynk Area Trace] F. /api/estimate received | mowAreaSqft=' + Number(_body.mowAreaSqft || 0) + ' lotAreaSqft=' + Number(_body.lotAreaSqft || 0) + ' serviceType=' + (_body.serviceType || '') + ' source=request.body');
    const settings = await loadSettingsFromDb();
    const { estimate, breakdown, activeBulkTiers } = estimateQuoteWithBreakdown(_body, settings);
    console.log('[TurfLynk Area Trace] F. /api/estimate result | estimate=' + estimate + ' mowAreaSqft=' + Number(_body.mowAreaSqft || 0));

    // Terrain system — safe no-op when TERRAIN_MODE=off (default).
    // Never throws; always returns at minimum a disabled stub.
    // Priority: mowableGeoJson > parcelGeoJson (do NOT sample steep woods/ditches outside mow area).
    const terrain = await calculateTerrain({
      lat:             _body.lat    ? Number(_body.lat)    : undefined,
      lng:             _body.lng    ? Number(_body.lng)    : undefined,
      address:         _body.address        || undefined,
      parcelGeoJson:   _body.parcelGeoJson  || _body.parcelGeoJSON  || undefined,
      mowableGeoJson:  _body.mowableGeoJson || _body.mowableGeoJSON || _body.selectedMowableGeoJSON || undefined,
    }).catch(() => ({ enabled: false, mode: "off", available: false, priceMultiplier: 1.0 }));

    // Attach guardrail — tells client whether instant booking is allowed.
    const terrainSettings = await loadTerrainSettings().catch(() => ({}));
    terrain.terrainGuardrail = computeTerrainGuardrail(terrain, terrainSettings);

    res.json({ ok: true, estimate, breakdown, activeBulkTiers: activeBulkTiers || [], terrain });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

function bookingAccessNotesRequired(payload = {}) {
  const gate = payload.gate_size_category || payload.gate_access_type || "";
  const mowerAccess = payload.mower_access || "";
  const community = payload.community_access_type || "";
  return (
    (gate && gate !== "no_gate_open_access") ||
    (mowerAccess && mowerAccess !== "yes") ||
    (community && community !== "no")
  );
}

function instantCheckoutMissingFields(payload = {}) {
  const missing = [];
  if (!String(payload.name || payload.customerName || "").trim()) missing.push("name");
  if (!isValidLookingPhone(payload.phone || payload.customerPhone || "")) missing.push("phone");
  if (!String(payload.email || payload.customerEmail || "").trim()) missing.push("email");
  if (!String(payload.address || "").trim()) missing.push("address");
  const accessNotes = payload.yard_access_notes || payload.access_notes || payload.notes || payload.community_access_instructions || "";
  if (bookingAccessNotesRequired(payload) && !String(accessNotes).trim()) missing.push("access notes");
  return missing;
}

/**
 * Server-side terrain guardrail check for checkout endpoints.
 * Re-calculates terrain from GeoJSON (uses cache — same data as estimate call).
 * Returns null when no check is needed, or { blocked, guardrail } when check ran.
 */
async function checkTerrainGuardrailForCheckout(jobPayload) {
  const mowableGeoJson =
    jobPayload.mowableGeoJson  || jobPayload.mowableGeoJSON ||
    jobPayload.selectedMowableGeoJSON || null;
  const parcelGeoJson  =
    jobPayload.parcelGeoJson   || jobPayload.parcelGeoJSON  || null;

  if (!mowableGeoJson && !parcelGeoJson) return null; // No location data — skip

  const terrainSettings = await loadTerrainSettings().catch(() => ({}));
  if ((terrainSettings.mode || "off") === "off") return null; // Terrain disabled

  const terrain = await calculateTerrain({
    lat:            jobPayload.lat ? Number(jobPayload.lat) : undefined,
    lng:            jobPayload.lng ? Number(jobPayload.lng) : undefined,
    parcelGeoJson,
    mowableGeoJson,
  }).catch(() => null);

  if (!terrain) return null;

  const guardrail = computeTerrainGuardrail(terrain, terrainSettings);
  return { terrain, guardrail, blocked: guardrail.manualReviewRequired };
}

function normalizeInstantCheckoutPayload(payload = {}, calculatedEstimate = 0) {
  const name = payload.name || payload.customerName || "";
  const phone = String(payload.customerPhone || payload.phone || payload.leadPhone || "").trim();
  const email = normalizeAccountEmail(payload.customerEmail || payload.email || "");
  return {
    ...payload,
    name,
    phone,
    email,
    customerName: payload.customerName || name,
    customerPhone: payload.customerPhone || phone,
    customerEmail: payload.customerEmail || email,
    serviceType: payload.serviceType || payload.service_type || "mowing",
    budget: calculatedEstimate,
    estimate: calculatedEstimate,
    final_price: calculatedEstimate,
    scope_locked: true
  };
}

app.post("/api/checkout/instant-mow", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const jobPayload = body.job && typeof body.job === "object" ? body.job : body;
    const quoteId = body.quote_id || jobPayload.quote_id || jobPayload.quoteId || "";
    const missing = instantCheckoutMissingFields(jobPayload);
    if (missing.length) {
      const onlyPhone = missing.length === 1 && missing[0] === "phone";
      return res.status(400).json({ ok: false, error: onlyPhone ? phoneValidationError() : `Missing booking fields: ${missing.join(", ")}` });
    }
    const smsConsent = requireSmsConsent(res, body, jobPayload);
    if (!smsConsent) return;
    applySmsConsentSnapshot(jobPayload, smsConsent);

    const settings = await loadSettingsFromDb();
    const calculatedEstimate = estimateQuote(jobPayload, settings);
    const amount = Math.round(Number(calculatedEstimate || 0) * 100);
    if (amount <= 0) {
      return res.status(400).json({ ok: false, error: "Checkout amount is required" });
    }
    const checkoutJobPayload = normalizeInstantCheckoutPayload(jobPayload, calculatedEstimate);
    const contactConflict = await checkAccountContactConflicts({
      email: checkoutJobPayload.email,
      phone: checkoutJobPayload.phone,
      currentUserId: req.user?.id || null
    });
    if (contactConflict) {
      return sendCheckoutAccountContactConflict(res, contactConflict, {
        email: checkoutJobPayload.email,
        phone: checkoutJobPayload.phone
      });
    }

    // Terrain guardrail — re-checks from GeoJSON (uses cache; same data as estimate).
    const terrainCheck = await checkTerrainGuardrailForCheckout(jobPayload).catch(() => null);
    if (terrainCheck?.blocked) {
      return res.status(422).json({
        ok: false,
        terrain_blocked: true,
        terrainBlocked: true,
        terrainGuardrail: terrainCheck.guardrail,
        error: terrainCheck.guardrail.message || "Online booking is not available for this property due to terrain. Please request a manual review.",
      });
    }

    const secretKey = stripeSecretKey();
    const serviceSnapshot = {
      serviceType: checkoutJobPayload.serviceType || "mowing",
      address: checkoutJobPayload.address || "",
      city: checkoutJobPayload.city || "",
      state: checkoutJobPayload.state || "",
      zip: checkoutJobPayload.zip || "",
      mowAreaSqft: Number(jobPayload.mowAreaSqft || 0),
      lotAreaSqft: Number(jobPayload.lotAreaSqft || 0),
      preferredDate: checkoutJobPayload.preferredDate || null,
      notes: jobPayload.notes || jobPayload.yard_access_notes || ""
    };
    if (!secretKey) {
      const job = await insertJobForUser(req.user?.id || null, checkoutJobPayload, "open", {
        paymentStatus: "checkout_pending",
        paymentMethod: "stripe"
      });
      const payment = {
        id: nanoid(10),
        job_id: job.id,
        quote_id: quoteId || null,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        amount: amount / 100,
        currency: "usd",
        customer: {
          name: checkoutJobPayload.name,
          phone: checkoutJobPayload.phone,
          email: checkoutJobPayload.email
        },
        service: serviceSnapshot,
        status: "checkout_pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        note: "Stripe is not configured in this environment."
      };
      const payments = readJsonArray(PAYMENTS_FILE);
      payments.push(payment);
      writeJsonArray(PAYMENTS_FILE, payments);
      await updateUserPhoneIfBlank(req.user?.id || null, checkoutJobPayload.phone);
      return res.json({
        ok: true,
        paymentStatus: "checkout_pending",
        checkoutUrl: null,
        job,
        payment,
        message: "Stripe is not configured in this environment."
      });
    }

    assertStripeTestMode(secretKey);

    const job = await insertJobForUser(req.user?.id || null, checkoutJobPayload, "payment_pending", {
      paymentStatus: "checkout_pending",
      paymentMethod: "stripe"
    });
    const payment = {
      id: nanoid(10),
      job_id: job.id,
      quote_id: quoteId || null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      amount: amount / 100,
      currency: "usd",
      customer: {
        name: checkoutJobPayload.name,
        phone: checkoutJobPayload.phone,
        email: checkoutJobPayload.email
      },
      service: serviceSnapshot,
      status: "checkout_pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const payments = readJsonArray(PAYMENTS_FILE);
    payments.push(payment);
    writeJsonArray(PAYMENTS_FILE, payments);

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${APP_BASE_URL || PUBLIC_BASE_URL || "https://mownwa.com"}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", checkoutReturnUrl("cancel", { job_id: job.id }));
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(amount));
    params.set("line_items[0][price_data][product_data][name]", "Instant standard lawn mowing");
    params.set("client_reference_id", job.id);
    params.set("metadata[payment_id]", payment.id);
    params.set("metadata[job_id]", job.id);
    params.set("metadata[quote_id]", quoteId);
    params.set("metadata[customer_user_id]", req.user?.id || "");
    params.set("metadata[customer_name]", checkoutJobPayload.name || "");
    params.set("metadata[customer_phone]", checkoutJobPayload.phone || "");
    params.set("metadata[customer_email]", checkoutJobPayload.email || "");
    params.set("customer_email", checkoutJobPayload.email || "");
    params.set("metadata[service_type]", checkoutJobPayload.serviceType || "mowing");
    params.set("metadata[scope]", "standard_mowing_only");

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      payment.status = "checkout_failed";
      payment.updated_at = new Date().toISOString();
      payment.error = session.error?.message || "Stripe checkout failed";
      writeJsonArray(PAYMENTS_FILE, payments);
      await pgdb.query("UPDATE jobs SET status = 'payment_failed' WHERE id = $1", [job.id]);
      return res.status(502).json({ ok: false, error: session.error?.message || "Stripe checkout failed" });
    }

    payment.status = "checkout_created";
    payment.stripe_checkout_session_id = session.id;
    payment.stripe_payment_intent_id = session.payment_intent || null;
    payment.updated_at = new Date().toISOString();
    writeJsonArray(PAYMENTS_FILE, payments);
    await updateUserPhoneIfBlank(req.user?.id || null, checkoutJobPayload.phone);

    res.json({
      ok: true,
      paymentStatus: "checkout_created",
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      job,
      payment
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/phone-verification/start", optionalAuth, async (req, res) => {
  try {
    const phone = normalizePhoneForVerification(req.body?.phone || req.body?.customerPhone || "");
    const purpose = String(req.body?.purpose || PHONE_VERIFICATION_PURPOSE_COD).trim() || PHONE_VERIFICATION_PURPOSE_COD;
    if (!isE164Phone(phone)) {
      return res.status(400).json({ ok: false, error: "A valid phone number is required." });
    }
    const result = await startPhoneVerification({
      phone,
      purpose,
      userId: req.user?.id || null,
      ip: requestIp(req)
    });
    if (!result.ok) {
      const status = result.status === "rate_limited" ? 429 : (result.missing?.length ? 503 : 502);
      return res.status(status).json({
        ok: false,
        status: result.status || "failed",
        code: status >= 500 ? "PHONE_VERIFICATION_UNAVAILABLE" : undefined,
        error: status >= 500 ? PHONE_VERIFICATION_UNAVAILABLE_MESSAGE : (result.error || "Could not start phone verification.")
      });
    }
    res.json({
      ok: true,
      provider: result.provider || getPhoneVerifyProvider(),
      status: result.status || "pending",
      message: "Text code sent. Enter the 6-digit code below."
    });
  } catch (error) {
    res.status(500).json({ ok: false, code: "PHONE_VERIFICATION_UNAVAILABLE", error: PHONE_VERIFICATION_UNAVAILABLE_MESSAGE });
  }
});

app.post("/api/phone-verification/check", optionalAuth, async (req, res) => {
  try {
    const phone = normalizePhoneForVerification(req.body?.phone || req.body?.customerPhone || "");
    const code = String(req.body?.code || "").replace(/\D/g, "");
    const purpose = String(req.body?.purpose || PHONE_VERIFICATION_PURPOSE_COD).trim() || PHONE_VERIFICATION_PURPOSE_COD;
    if (!isE164Phone(phone)) {
      return res.status(400).json({ ok: false, error: "A valid phone number is required." });
    }
    if (!/^\d{4,10}$/.test(code)) {
      return res.status(400).json({ ok: false, error: "A valid verification code is required." });
    }
    const result = await checkPhoneVerification({
      phone,
      code,
      purpose,
      userId: req.user?.id || null,
      ip: requestIp(req)
    });
    if (!result.ok || result.status !== "approved") {
      const unavailable = Boolean(result.missing?.length);
      const status = unavailable ? 503 : (result.status === "rate_limited" ? 429 : 400);
      return res.status(status).json({
        ok: false,
        status: result.status || "failed",
        code: unavailable ? "PHONE_VERIFICATION_UNAVAILABLE" : undefined,
        error: unavailable ? PHONE_VERIFICATION_UNAVAILABLE_MESSAGE : "We could not verify that code. Please try again."
      });
    }
    const record = recordPhoneVerificationSession(req, {
      phone,
      purpose,
      provider: result.provider || getPhoneVerifyProvider()
    });
    res.json({
      ok: true,
      provider: result.provider || getPhoneVerifyProvider(),
      status: "approved",
      verified: true,
      phoneVerifiedAt: record?.verifiedAt || new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ ok: false, code: "PHONE_VERIFICATION_UNAVAILABLE", error: PHONE_VERIFICATION_UNAVAILABLE_MESSAGE });
  }
});

app.post("/api/checkout/pay-onsite", optionalAuth, async (req, res) => {
  try {
    await ensureCodVerificationColumns();
    const body = req.body || {};
    const jobPayload = body.job && typeof body.job === "object" ? body.job : body;
    const quoteId = body.quote_id || jobPayload.quote_id || jobPayload.quoteId || "";
    const missing = instantCheckoutMissingFields(jobPayload);
    if (missing.length) {
      const onlyPhone = missing.length === 1 && missing[0] === "phone";
      return res.status(400).json({ ok: false, error: onlyPhone ? phoneValidationError() : `Missing booking fields: ${missing.join(", ")}` });
    }
    const smsConsent = requireSmsConsent(res, body, jobPayload);
    if (!smsConsent) return;
    applySmsConsentSnapshot(jobPayload, smsConsent);

    const settings = await loadSettingsFromDb();
    const calculatedEstimate = estimateQuote(jobPayload, settings);
    if (Number(calculatedEstimate || 0) <= 0) {
      return res.status(400).json({ ok: false, error: "Booking amount is required" });
    }
    const onsiteJobPayload = normalizeInstantCheckoutPayload({
      ...jobPayload,
      payment_status: "onsite_pending",
      payment_method: "onsite_cash_check"
    }, calculatedEstimate);
    const contactConflict = await checkAccountContactConflicts({
      email: onsiteJobPayload.email,
      phone: onsiteJobPayload.phone,
      currentUserId: req.user?.id || null
    });
    if (contactConflict) {
      return sendCheckoutAccountContactConflict(res, contactConflict, {
        email: onsiteJobPayload.email,
        phone: onsiteJobPayload.phone
      });
    }

    // Terrain guardrail — re-checks from GeoJSON (uses cache; same data as estimate).
    const onsiteTerrainCheck = await checkTerrainGuardrailForCheckout(jobPayload).catch(() => null);
    if (onsiteTerrainCheck?.blocked) {
      return res.status(422).json({
        ok: false,
        terrain_blocked: true,
        terrainBlocked: true,
        terrainGuardrail: onsiteTerrainCheck.guardrail,
        error: onsiteTerrainCheck.guardrail.message || "Online booking is not available for this property due to terrain. Please request a manual review.",
      });
    }

    const smsTo = toE164Phone(onsiteJobPayload.phone);
    if (!isE164Phone(smsTo)) {
      return res.status(400).json({ ok: false, error: "A valid E.164-capable phone number is required for cash/check-on-site verification." });
    }
    const phoneVerification = verifiedPhoneSession(req, smsTo, PHONE_VERIFICATION_PURPOSE_COD);
    if (!phoneVerification) {
      return res.status(403).json({
        ok: false,
        verification_required: true,
        verificationRequired: true,
        error: "Phone verification is required before reserving a cash/check-on-site job."
      });
    }

    let job = await insertJobForUser(req.user?.id || null, onsiteJobPayload, "open", {
      paymentStatus: "onsite_pending",
      paymentMethod: "onsite_cash_check"
    });
    const updatedJob = await pgdb.query(
      `
      UPDATE jobs
      SET cod_verification_status = 'verified',
          cod_verified_at = NOW(),
          cod_verification_code = NULL,
          cod_verification_provider = $2,
          phone_verified_at = $3,
          phone_verified_provider = $2,
          phone_verified_number = $4,
          phone_verification_purpose = $5
      WHERE id = $1
      RETURNING *
      `,
      [
        job.id,
        phoneVerification.provider || getPhoneVerifyProvider(),
        phoneVerification.verifiedAt,
        smsTo,
        PHONE_VERIFICATION_PURPOSE_COD
      ]
    );
    if (updatedJob.rows[0]) job = mapJobRow(updatedJob.rows[0]);

    const payment = {
      id: nanoid(10),
      job_id: job.id,
      quote_id: quoteId || null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      amount: calculatedEstimate,
      currency: "usd",
      customer: {
        name: onsiteJobPayload.name,
        phone: onsiteJobPayload.phone,
        email: onsiteJobPayload.email
      },
      service: {
        serviceType: onsiteJobPayload.serviceType || "mowing",
        address: onsiteJobPayload.address || "",
        city: onsiteJobPayload.city || "",
        state: onsiteJobPayload.state || "",
        zip: onsiteJobPayload.zip || "",
        mowAreaSqft: Number(jobPayload.mowAreaSqft || 0),
        lotAreaSqft: Number(jobPayload.lotAreaSqft || 0),
        preferredDate: onsiteJobPayload.preferredDate || null,
        notes: jobPayload.notes || jobPayload.yard_access_notes || ""
      },
      payment_method: "onsite_cash_check",
      status: "onsite_pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      note: "Cash or check collected at time of service after COD phone verification."
    };
    const payments = readJsonArray(PAYMENTS_FILE);
    payments.push(payment);
    writeJsonArray(PAYMENTS_FILE, payments);
    await updateUserPhoneIfBlank(req.user?.id || null, onsiteJobPayload.phone);

    res.status(201).json({
      ok: true,
      verification_required: false,
      verificationRequired: false,
      jobId: job.id,
      paymentStatus: "onsite_pending",
      paymentMethod: "onsite_cash_check",
      checkoutUrl: null,
      job,
      payment,
      message: "Your onsite-payment job is confirmed."
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/payments/create-checkout-session", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const paymentPhone = String(body.customerPhone || body.phone || body.leadPhone || "").trim() || req.user?.phone || "";
    const paymentEmail = normalizeEmailForClaim(body.customerEmail || body.email || req.user.email || "");
    if (!isValidLookingPhone(paymentPhone)) return rejectMissingPhone(res);
    const amount = Math.round(Number(body.amount || body.final_price || body.estimate || 0) * 100);
    if (amount <= 0) return res.status(400).json({ ok: false, error: "Checkout amount is required" });
    const contactConflict = await checkAccountContactConflicts({
      email: paymentEmail,
      phone: paymentPhone,
      currentUserId: req.user.id
    });
    if (contactConflict) {
      return sendCheckoutAccountContactConflict(res, contactConflict, {
        email: paymentEmail,
        phone: paymentPhone
      });
    }

    if (body.job_id && req.user.role !== "admin") {
      await attachCheckoutJobToUser(body.job_id, req.user, paymentEmail);
    }

    const secretKey = stripeSecretKey();
    if (!secretKey) {
      const payment = {
        id: nanoid(10),
        job_id: body.job_id || null,
        bid_request_id: body.bid_request_id || null,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        amount: amount / 100,
        customer: {
          name: body.name || body.customerName || req.user.full_name || "",
          email: paymentEmail,
          phone: paymentPhone
        },
        status: "checkout_pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const payments = readJsonArray(PAYMENTS_FILE);
      payments.push(payment);
      writeJsonArray(PAYMENTS_FILE, payments);
      await updateUserPhoneIfBlank(req.user.id, paymentPhone);
      return res.json({ ok: true, paymentStatus: payment.status, checkoutUrl: null, payment });
    }

    assertStripeTestMode(secretKey);

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${APP_BASE_URL || PUBLIC_BASE_URL || "https://mownwa.com"}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", checkoutReturnUrl("cancel"));
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(amount));
    params.set("line_items[0][price_data][product_data][name]", body.description || "TurfLynk service payment");
    params.set("metadata[job_id]", body.job_id || "");
    params.set("metadata[bid_request_id]", body.bid_request_id || "");
    params.set("metadata[customer_phone]", paymentPhone);
    params.set("metadata[customer_email]", paymentEmail);
    if (paymentEmail) params.set("customer_email", paymentEmail);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const session = await stripeRes.json();
    if (!stripeRes.ok) return res.status(502).json({ ok: false, error: session.error?.message || "Stripe checkout failed" });

    const payment = {
      id: nanoid(10),
      job_id: body.job_id || null,
      bid_request_id: body.bid_request_id || null,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent || null,
      amount: amount / 100,
      customer: {
        name: body.name || body.customerName || req.user.full_name || "",
        email: paymentEmail,
        phone: paymentPhone
      },
      status: "checkout_created",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const payments = readJsonArray(PAYMENTS_FILE);
    payments.push(payment);
    writeJsonArray(PAYMENTS_FILE, payments);
    await updateUserPhoneIfBlank(req.user.id, paymentPhone);
    res.json({ ok: true, paymentStatus: payment.status, checkoutUrl: session.url, checkoutSessionId: session.id, payment });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function ensurePaidPaymentAccount(payment = {}, session = {}) {
  const metadata = session.metadata || {};
  const customer = payment.customer || {};
  const email = customer.email || session.customer_details?.email || metadata.customer_email || "";
  if (!email) return null;

  const fullName = customer.name || metadata.customer_name || session.customer_details?.name || "";
  const paymentPhone = customer.phone || metadata.customer_phone || session.customer_details?.phone || "";
  const { user, created } = await findOrCreateCustomerUser({ email, fullName, phone: paymentPhone });
  if (!user) return null;
  await updateUserPhoneIfBlank(user.id, paymentPhone);
  await claimJobsForUserEmail(user.id, user.email || email);

  if (payment.job_id) {
    const hasCustomerEmail = await ensureJobsCustomerEmailColumn();
    await pgdb.query(
      `UPDATE jobs
       SET customer_user_id = COALESCE(customer_user_id, $2)${hasCustomerEmail ? ", customer_email = COALESCE(NULLIF(TRIM(customer_email), ''), $3)" : ""}
       WHERE id = $1`,
      hasCustomerEmail ? [payment.job_id, user.id, normalizeEmailForClaim(email)] : [payment.job_id, user.id]
    );
  }

  if (payment.quote_id) {
    await pgdb.query(
      "UPDATE quotes SET customer_user_id = COALESCE(customer_user_id, $2) WHERE id = $1",
      [payment.quote_id, user.id]
    );
  }

  payment.customer_user_id = payment.customer_user_id || user.id;
  payment.customer = {
    ...customer,
    name: customer.name || fullName,
    email: customer.email || user.email,
    phone: customer.phone || metadata.customer_phone || session.customer_details?.phone || ""
  };

  if (!payment.account_setup && created) {
    payment.account_setup = createAccountSetupToken({ user, payment, createdUser: created });
  } else if (!payment.account_setup) {
    payment.account_setup = {
      email: user.email,
      createdUser: false,
      existingUser: true
    };
  }

  return payment.account_setup;
}

async function markCheckoutSessionPaid(session = {}) {
  await ensurePaymentColumns();
  const metadata = session.metadata || {};
  const payments = readJsonArray(PAYMENTS_FILE);
  let payment = payments.find((item) => item.stripe_checkout_session_id === session.id);
  if (!payment && metadata.payment_id) {
    payment = payments.find((item) => item.id === metadata.payment_id);
  }

  if (!payment) {
    payment = {
      id: metadata.payment_id || nanoid(10),
      job_id: metadata.job_id || null,
      quote_id: metadata.quote_id || null,
      stripe_checkout_session_id: session.id || null,
      stripe_payment_intent_id: null,
      amount: session.amount_total ? Number(session.amount_total) / 100 : 0,
      customer: {
        name: metadata.customer_name || session.customer_details?.name || "",
        phone: metadata.customer_phone || session.customer_details?.phone || "",
        email: session.customer_details?.email || ""
      },
      status: "checkout_created",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    payments.push(payment);
  }

  payment.status = "paid";
  payment.paid_at = payment.paid_at || new Date().toISOString();
  payment.job_id = payment.job_id || metadata.job_id || null;
  payment.quote_id = payment.quote_id || metadata.quote_id || null;
  payment.stripe_checkout_session_id = session.id || payment.stripe_checkout_session_id || null;
  payment.stripe_payment_intent_id = session.payment_intent || payment.stripe_payment_intent_id || null;
  payment.amount = session.amount_total ? Number(session.amount_total) / 100 : payment.amount;
  payment.customer = payment.customer || {
    name: metadata.customer_name || session.customer_details?.name || "",
    phone: metadata.customer_phone || session.customer_details?.phone || "",
    email: session.customer_details?.email || ""
  };
  const accountSetup = await ensurePaidPaymentAccount(payment, session);
  if (accountSetup) payment.account_setup = accountSetup;
  payment.updated_at = new Date().toISOString();
  writeJsonArray(PAYMENTS_FILE, payments);

  if (payment.job_id) {
    await ensureJobsScopeSnapshotColumn();
    await pgdb.query(
      `
      UPDATE jobs
      SET
        status = CASE WHEN status IN ('payment_pending', 'checkout_pending') THEN 'open' ELSE status END,
        payment_status = 'paid',
        payment_method = COALESCE(payment_method, 'stripe'),
        stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id),
        paid_at = COALESCE(paid_at, NOW()),
        job_scope_snapshot = COALESCE(job_scope_snapshot, scope_snapshot),
        scope_snapshot = COALESCE(scope_snapshot, job_scope_snapshot),
        details = CASE
          WHEN COALESCE(details, '') ILIKE '%Payment status: paid%' THEN details
          ELSE CONCAT(
            COALESCE(details, ''),
            CASE WHEN COALESCE(details, '') = '' THEN '' ELSE E'\n' END,
            'Payment status: paid',
            CASE WHEN $2::text = '' THEN '' ELSE CONCAT(E'\nStripe checkout session: ', $2::text) END
          )
        END
      WHERE id = $1
      `,
      [payment.job_id, session.id || "", session.payment_intent || null]
    );
  }

  if (payment.quote_id) {
    await pgdb.query(
      `
      UPDATE quotes
      SET
        status = 'paid',
        converted_to_job_id = COALESCE(converted_to_job_id, $2),
        converted_at = COALESCE(converted_at, NOW())
      WHERE id = $1
      `,
      [payment.quote_id, payment.job_id]
    );
  }

  return payment;
}

app.post("/api/stripe/webhook", async (req, res) => {
  try {
    if (!verifyStripeWebhookSignature(req)) {
      return res.status(400).json({ ok: false, error: "Invalid Stripe signature" });
    }

    const event = req.body || {};
    const session = event.data?.object || {};
    if (event.type === "checkout.session.completed" && session.id) {
      const payment = await markCheckoutSessionPaid(session);
      return res.json({ ok: true, received: true, paymentStatus: payment.status });
    }
    res.json({ ok: true, received: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
      const attrs = { ...(result.feature.properties || {}), ...(result.feature.attributes || {}) };
      result.feature = {
        ...result.feature,
        attributes: attrs,
        properties: attrs
      };
      result.normalized = normalizeParcelFeature(result.feature);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* -------------------- AUTH -------------------- */

app.post("/api/auth/register", async (req, res) => {
  let normalizedEmail = "";
  let normalizedPhone = "";
  try {
    const { email, password, confirmPassword, fullName, firstName, lastName, phone, role } = req.body || {};
    normalizedEmail = normalizeAccountEmail(email);
    normalizedPhone = normalizeAccountPhone(phone);

    if (!normalizedEmail || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ ok: false, field: "password", error: "Password must be at least 8 characters." });
    }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ ok: false, field: "confirmPassword", error: "Passwords do not match." });
    }

    const allowedRoles = new Set(["customer", "provider"]);
    const safeRole = allowedRoles.has(role) ? role : "customer";
    await ensureUsersPhoneColumn();
    const conflict = await findAccountContactConflict({ email: normalizedEmail, phone: normalizedPhone });
    if (conflict) return sendAccountContactConflict(res, conflict);

    const split = splitFullName(fullName);
    const safeFirstName = String(firstName || split.firstName || "").trim();
    const safeLastName = String(lastName || split.lastName || "").trim();
    const safeFullName = composeFullName(safeFirstName, safeLastName, fullName);

    const result = await pgdb.query(
      `
      INSERT INTO users (id, email, password_hash, full_name, first_name, last_name, phone, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, full_name, first_name, last_name, phone, role, active, created_at
      `,
      [nanoid(10), normalizedEmail, hashPassword(password), safeFullName, safeFirstName, safeLastName, normalizedPhone, safeRole]
    );
    await linkPasswordProvider(result.rows[0]);
    await claimJobsForUserEmail(result.rows[0].id, result.rows[0].email);

    res.status(201).json({
      ok: true,
      user: sanitizeUser(result.rows[0])
    });
  } catch (error) {
    if (error.code === "23505") {
      const conflict = await findAccountContactConflict({ email: normalizedEmail, phone: normalizedPhone });
      if (conflict) return sendAccountContactConflict(res, conflict);
      return res.status(409).json({ ok: false, field: "email", error: DUPLICATE_EMAIL_MESSAGE });
    }
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    await ensureUsersPhoneColumn();
    const result = await pgdb.query(
      "SELECT * FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [normalizeAccountEmail(email)]
    );

    const user = result.rows[0];

    if (!user || user.password_hash !== hashPassword(password || "")) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }
    if (user.active === false || user.deleted_at) {
      return res.status(403).json({ ok: false, error: "This account is inactive" });
    }

    await linkPasswordProvider(user);
    const token = await createSessionForUser(user.id);
    setSessionCookie(req, res, token);
    await claimJobsForUserEmail(user.id, user.email);
    const sessionUser = await userWithAvatar(user);

    res.json({
      ok: true,
      token,
      user: sanitizeUser(sessionUser)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/set-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ ok: false, error: "Missing setup token or password" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    }

    const now = new Date().toISOString();
    const rows = readJsonArray(ACCOUNT_SETUP_TOKENS_FILE);
    const record = rows.find((item) => item.token === token && item.expires_at > now);
    if (!record) {
      return res.status(400).json({ ok: false, error: "Account setup link is invalid or expired" });
    }

    const result = await pgdb.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *",
      [hashPassword(password), record.user_id]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ ok: false, error: "Account not found" });
    }
    if (user.active === false || user.deleted_at) {
      return res.status(403).json({ ok: false, error: "This account is inactive" });
    }

    writeJsonArray(
      ACCOUNT_SETUP_TOKENS_FILE,
      rows.filter((item) => item.token !== token)
    );

    await linkPasswordProvider(user);
    const sessionToken = await createSessionForUser(user.id);
    setSessionCookie(req, res, sessionToken);
    await claimJobsForUserEmail(user.id, user.email);

    res.json({
      ok: true,
      token: sessionToken,
      user: sanitizeUser(user)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/me", optionalAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.user?.role ? sanitizeUser(req.user) : (req.user || null)
  });
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = authTokenFromRequest(req);
    if (token) {
      await pgdb.query("DELETE FROM sessions WHERE token = $1", [token]);
    }
    clearSessionCookie(req, res);
    clearPassportSessionCookie(req, res);
    const finish = () => res.json({ ok: true });
    const destroySession = () => {
      if (!req.session) return finish();
      req.session.destroy((error) => {
        if (error) {
          return res.status(500).json({ ok: false, error: error.message });
        }
        finish();
      });
    };
    req.logout((error) => {
      if (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
      destroySession();
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/facebook", (req, res, next) => {
  const source = safeFacebookLoginSource(req.query.source);
  const step = safeFacebookLoginStep(req.query.step);
  const callbackURL = facebookCallbackUrlForRequest(req);
  const appOrigin = appOriginForRequest(req);
  if (req.session) {
    req.session.facebookLoginSource = source;
    req.session.facebookLoginStep = step;
    req.session.facebookCallbackURL = callbackURL;
  }
  res.set("X-Facebook-Callback-URL", callbackURL);
  console.info(`[Facebook Login] source=${source} route=/api/auth/facebook`);
  console.info("[Facebook OAuth][Passport] start", {
    source,
    step,
    host: requestHost(req),
    appOrigin,
    appIdLoaded: Boolean(FACEBOOK_APP_ID),
    appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
    callbackURL,
    requiredCallbackURLs: FACEBOOK_REQUIRED_CALLBACK_URLS
  });
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.warn("[Facebook OAuth][Passport] start failed: provider_unconfigured", {
      source,
      step,
      appIdLoaded: Boolean(FACEBOOK_APP_ID),
      appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
      callbackURL
    });
    return res.redirect("/auth-failed.html");
  }
  return passport.authenticate("facebook", {
    scope: ["email"],
    callbackURL,
    state: encodeStatePayload({ provider: "facebook", source, step })
  })(req, res, next);
});

app.get("/api/auth/facebook/callback", (req, res, next) => {
  const statePayload = decodeStatePayload(req.query.state);
  const source = safeFacebookLoginSource(req.session?.facebookLoginSource || statePayload?.source);
  const step = safeFacebookLoginStep(req.session?.facebookLoginStep || statePayload?.step);
  const callbackURL = facebookCallbackUrlForRequest(req);
  const appOrigin = appOriginForRequest(req);
  console.info("[Facebook OAuth][Passport] callback received", {
    source,
    step,
    host: requestHost(req),
    appOrigin,
    callbackURL,
    query: safeOAuthQuery(req.query)
  });
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.warn("[Facebook OAuth][Passport] callback failed: provider_unconfigured", {
      source,
      step,
      appIdLoaded: Boolean(FACEBOOK_APP_ID),
      appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
      callbackURL,
      query: safeOAuthQuery(req.query)
    });
    return res.redirect("/auth-failed.html");
  }

  return passport.authenticate("facebook", { session: true, callbackURL }, (error, user, info) => {
    if (error || !user) {
      console.warn("[Facebook OAuth][Passport] callback failed", {
        errorMessage: error?.message || null,
        info: safePassportInfo(info),
        query: safeOAuthQuery(req.query),
        userPresent: Boolean(user),
        verifyCallbackRan: Boolean(req.facebookVerifyCallbackRan),
        profilePresent: Boolean(req.facebookProfilePresent),
        source,
        step,
        callbackURL
      });
      return res.redirect(authErrorRedirect("facebook", "auth_failed", appOrigin));
    }

    return req.logIn(user, async (loginError) => {
      if (loginError) {
        console.warn("[Facebook OAuth][Passport] session login failed", {
          errorMessage: loginError.message,
          userPresent: Boolean(user),
          emailPresent: Boolean(user.email),
          verifyCallbackRan: Boolean(req.facebookVerifyCallbackRan),
          profilePresent: Boolean(req.facebookProfilePresent),
          source,
          step,
          callbackURL
        });
        return res.redirect(authErrorRedirect("facebook", "session_failed", appOrigin));
      }

      console.info("[Facebook OAuth][Passport] callback succeeded", {
        userPresent: true,
        emailPresent: Boolean(user.email),
        verifyCallbackRan: Boolean(req.facebookVerifyCallbackRan),
        profilePresent: Boolean(req.facebookProfilePresent),
        provider: user.provider || "facebook",
        source,
        step,
        callbackURL
      });
      const returnStep = step;
      delete req.session.facebookLoginSource;
      delete req.session.facebookLoginStep;
      delete req.session.facebookCallbackURL;
      await claimJobsForUserEmail(user.id, user.email);
      return res.redirect(appRedirectUrl(`/?auth=success&view=quote&step=${encodeURIComponent(returnStep)}`, appOrigin));
    });
  })(req, res, next);
});

app.post("/api/facebook/data-deletion", async (req, res) => {
  const signedRequest = req.body?.signed_request;
  if (!signedRequest) {
    return res.status(400).json({ ok: false, error: "Missing signed_request" });
  }

  const payload = parseFacebookSignedRequest(signedRequest);
  if (!payload?.user_id) {
    return res.status(400).json({ ok: false, error: "Invalid signed_request" });
  }

  const hasMatchingUser = await hasStoredFacebookUserData(payload.user_id);
  const record = saveFacebookDataDeletionRequest(payload, hasMatchingUser);
  res.type("application/json").json({
    url: record.statusUrl,
    confirmation_code: record.confirmationCode
  });
});

app.get("/api/facebook/data-deletion/status/:code", (req, res) => {
  const confirmationCode = String(req.params.code || "");
  const record = findFacebookDataDeletionRequest(confirmationCode);
  const status = record?.status || "not found";
  const message = record
    ? record.status === "not_found"
      ? "No matching Facebook data was found and no further action is required."
      : "MowNWA received the Facebook data deletion request and will delete or anonymize user data associated with this request."
    : "No matching Facebook data was found and no further action is required.";
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MowNWA Facebook Data Deletion Status</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="legal-page auth-status-page">
    <p class="legal-brand">MowNWA.com</p>
    <h1>Your data deletion request has been received</h1>
    <p><strong>Confirmation code:</strong> ${escapeHtml(confirmationCode)}</p>
    <p><strong>Current status:</strong> ${escapeHtml(status)}</p>
    <p>${escapeHtml(message)}</p>
    <p>MowNWA will delete or anonymize user data associated with this request.</p>
    <p>Retention may still be required for legal, security, billing, or service-record reasons.</p>
    <p><a href="/">Back to MowNWA.com</a></p>
  </main>
</body>
</html>`);
});

app.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.redirect(authErrorRedirect("google", "provider_unconfigured"));
  }

  const state = crypto.randomBytes(24).toString("hex");
  const returnTo = safeQuoteReturnPath(req.query.returnTo || "/?auth=success&view=quote&step=request");
  setOAuthStateCookie(req, res, { provider: "google", state, returnTo });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: oauthRedirectUri("google"),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const stateCookie = decodeStatePayload(parseCookies(req)[OAUTH_STATE_COOKIE_NAME]);
    clearOAuthStateCookie(req, res);
    if (!stateCookie || stateCookie.provider !== "google" || stateCookie.state !== req.query.state) {
      return res.redirect(authErrorRedirect("google", "invalid_state"));
    }
    if (req.query.error) return res.redirect(authErrorRedirect("google", "provider_denied"));
    if (!req.query.code) return res.redirect(authErrorRedirect("google", "missing_code"));

    const profile = await getGoogleProfile(String(req.query.code));
    const user = await findOrCreateUserForOAuth(profile);
    const token = await createSessionForUser(user.id);
    setSessionCookie(req, res, token);
    await claimJobsForUserEmail(user.id, user.email);
    res.redirect(appRedirectUrl(stateCookie.returnTo));
  } catch (error) {
    console.warn("Google OAuth failed:", error.message);
    res.redirect(authErrorRedirect("google", "auth_failed"));
  }
});

app.get("/auth/facebook", (req, res) => {
  const step = safeFacebookLoginStep(new URL(req.query.returnTo || "/?step=request", APP_BASE_URL).searchParams.get("step"));
  console.warn("[Facebook OAuth][Custom] disabled; redirecting to Passport route", {
    route: "/api/auth/facebook",
    passportCallbackURL: FACEBOOK_CALLBACK_URL
  });
  res.redirect(`/api/auth/facebook?source=legacy_custom&step=${encodeURIComponent(step)}`);
});

app.get("/auth/facebook/callback", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  console.warn("[Facebook OAuth][Legacy] /auth/facebook/callback → /api/auth/facebook/callback", {
    passportCallbackURL: FACEBOOK_CALLBACK_URL,
    hasCode: Boolean(req.query.code),
    hasState: Boolean(req.query.state)
  });
  res.redirect(302, `/api/auth/facebook/callback${qs ? `?${qs}` : ""}`);
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
      mowerDeckSizeInches: Number(row.mower_deck_size_inches || 0) || null,
      hasSmallGateMower: Boolean(row.has_small_gate_mower),
      servicesOffered: parseJsonArray(row.services_offered),
      onboardingStatus: row.onboarding_status || "",
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

    const serviceAreas = readJsonArray(PROVIDER_SERVICE_AREAS_FILE);
    const providerArea = {
      provider_user_id: req.user.id,
      provider_profile_id: providerId,
      cities: listField(body.serviceAreaCities || body.cities).map((city) => ({
        id: nanoid(10),
        city,
        state: DEFAULT_STATE,
        region_id: PRIMARY_REGION,
        radius_miles: body.radius_miles == null ? null : Number(body.radius_miles),
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })),
      zones: [],
      preferences: {
        accepts_nearby_jobs: Boolean(body.accepts_nearby_jobs),
        max_extra_travel_miles: body.max_extra_travel_miles == null ? null : Number(body.max_extra_travel_miles),
        service_areas_paused: false
      },
      equipment: {
        mower_deck_size_inches: body.mower_deck_size_inches == null ? null : Number(body.mower_deck_size_inches),
        has_small_gate_mower: Boolean(body.has_small_gate_mower)
      },
      services_offered: listField(body.servicesOffered || body.services),
      updated_at: new Date().toISOString()
    };
    const existingAreaIndex = serviceAreas.findIndex((item) => item.provider_user_id === req.user.id);
    if (existingAreaIndex >= 0) serviceAreas[existingAreaIndex] = providerArea;
    else serviceAreas.push(providerArea);
    writeJsonArray(PROVIDER_SERVICE_AREAS_FILE, serviceAreas);

    res.status(201).json({
      ok: true,
      provider: {
        id: providerResult.rows[0].id,
        userId: providerResult.rows[0].user_id,
        businessName: providerResult.rows[0].business_name,
        bio: providerResult.rows[0].bio,
        equipment: providerResult.rows[0].equipment,
        phone: providerResult.rows[0].phone,
        mowerDeckSizeInches: providerArea.equipment.mower_deck_size_inches,
        hasSmallGateMower: providerArea.equipment.has_small_gate_mower,
        servicesOffered: providerArea.services_offered,
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

function currentProviderArea(userId) {
  const rows = readJsonArray(PROVIDER_SERVICE_AREAS_FILE);
  return rows.find((row) => row.provider_user_id === userId) || {
    provider_user_id: userId,
    cities: [],
    zones: [],
    preferences: {
      accepts_nearby_jobs: false,
      max_extra_travel_miles: null,
      service_areas_paused: false
    },
    equipment: {
      mower_deck_size_inches: null,
      has_small_gate_mower: false
    },
    services_offered: [],
    updated_at: null
  };
}

function saveProviderArea(area) {
  const rows = readJsonArray(PROVIDER_SERVICE_AREAS_FILE);
  const idx = rows.findIndex((row) => row.provider_user_id === area.provider_user_id);
  area.updated_at = new Date().toISOString();
  if (idx >= 0) rows[idx] = area;
  else rows.push(area);
  writeJsonArray(PROVIDER_SERVICE_AREAS_FILE, rows);
  return area;
}

const PROVIDER_SERVICE_DEFAULTS = [
  { id: "mowing", label: "Mowing" },
  { id: "mowing_edging", label: "Mowing + Edging" },
  { id: "full_service", label: "Full Service" },
  { id: "cleanup", label: "Cleanup" },
  { id: "leaf_cleanup", label: "Leaf Cleanup" },
  { id: "mulch_refresh", label: "Mulch Refresh" }
];

function providerAccessMiddleware(req, res, next) {
  return requireRole("provider", "admin")(req, res, next);
}

function providerAreaForRequest(req) {
  return currentProviderArea(req.user.id);
}

function providerProfileRowToApi(row = {}, area = {}, user = {}) {
  const profileSettings = area.profile_settings || {};
  return {
    id: row.id || area.provider_profile_id || null,
    userId: row.user_id || area.provider_user_id || user.id || null,
    businessName: row.business_name || profileSettings.business_name || "",
    contactName: profileSettings.contact_name || user.full_name || user.fullName || "",
    phone: row.phone || profileSettings.phone || user.phone || "",
    email: user.email || profileSettings.email || "",
    businessAddress: profileSettings.business_address || "",
    baseCity: profileSettings.base_city || "",
    deckSize: area.equipment?.mower_deck_size_inches || profileSettings.deck_size || "",
    mowerDeckSizeInches: area.equipment?.mower_deck_size_inches || null,
    hasSmallGateMower: Boolean(area.equipment?.has_small_gate_mower),
    bio: row.bio || profileSettings.bio || "",
    equipment: row.equipment || profileSettings.equipment || "",
    logoUrl: profileSettings.logo_url || "",
    notificationPreferences: area.notification_preferences || {},
    createdAt: row.created_at || null,
    updatedAt: area.updated_at || null
  };
}

async function loadProviderProfileForUser(user) {
  const area = currentProviderArea(user.id);
  const result = await pgdb.query(
    "SELECT * FROM provider_profiles WHERE user_id = $1 LIMIT 1",
    [user.id]
  );
  return {
    row: result.rows[0] || {},
    area,
    profile: providerProfileRowToApi(result.rows[0] || {}, area, user)
  };
}

async function ensureProviderProfileForUser(user, body = {}) {
  const existing = await pgdb.query(
    "SELECT * FROM provider_profiles WHERE user_id = $1 LIMIT 1",
    [user.id]
  );
  if (existing.rows.length) {
    const updated = await pgdb.query(
      `
      UPDATE provider_profiles
      SET business_name = $2,
          bio = $3,
          equipment = $4,
          phone = $5
      WHERE user_id = $1
      RETURNING *
      `,
      [
        user.id,
        body.businessName || body.business_name || existing.rows[0].business_name || "",
        body.bio || existing.rows[0].bio || "",
        body.equipment || existing.rows[0].equipment || "",
        body.phone || existing.rows[0].phone || user.phone || ""
      ]
    );
    return updated.rows[0];
  }

  const created = await pgdb.query(
    `
    INSERT INTO provider_profiles (id, user_id, business_name, bio, equipment, phone)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [
      nanoid(10),
      user.id,
      body.businessName || body.business_name || "",
      body.bio || "",
      body.equipment || "",
      body.phone || user.phone || ""
    ]
  );
  return created.rows[0];
}

function providerServicesFromArea(area = {}, pricing = {}) {
  const saved = Array.isArray(area.provider_services) ? area.provider_services : [];
  const enabledSet = new Set(listField(area.services_offered));
  return PROVIDER_SERVICE_DEFAULTS.map((service) => {
    const row = saved.find((item) => item.id === service.id) || {};
    const enabled = row.enabled == null
      ? enabledSet.has(service.id) || (service.id === "mowing" && !saved.length && !enabledSet.size)
      : Boolean(row.enabled);
    return {
      id: service.id,
      label: service.label,
      enabled,
      basePrice: Number(row.basePrice ?? row.base_price ?? pricing.baseFee ?? 0),
      minimumPrice: Number(row.minimumPrice ?? row.minimum_price ?? pricing.minimumPrice ?? 0),
      ratePerSqft: Number(row.ratePerSqft ?? row.rate_per_sqft ?? pricing.ratePerSqft ?? 0),
      notes: row.notes || ""
    };
  });
}

async function loadProviderPricing(providerProfileId) {
  if (!providerProfileId) return {};
  const result = await pgdb.query(
    `
    SELECT base_fee, rate_per_1000_sqft, minimum_price
    FROM provider_pricing
    WHERE provider_id = $1
    ORDER BY id ASC
    LIMIT 1
    `,
    [providerProfileId]
  );
  const row = result.rows[0] || {};
  return {
    baseFee: Number(row.base_fee || 0),
    ratePerSqft: Number(row.rate_per_1000_sqft || 0) / 1000,
    minimumPrice: Number(row.minimum_price || 0)
  };
}

app.get("/api/provider/profile", requireAuth, providerAccessMiddleware, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.json({ ok: true, profile: { user: sanitizeUser(req.user), admin: true } });
    }
    const { profile, area } = await loadProviderProfileForUser(req.user);
    res.json({ ok: true, profile: { user: sanitizeUser(req.user), ...profile, serviceArea: area } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/profile", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const body = req.body || {};
    const row = await ensureProviderProfileForUser(req.user, body);
    await updateUserPhoneIfBlank(req.user.id, body.phone || row.phone || "");
    const area = providerAreaForRequest(req);
    area.provider_profile_id = row.id;
    area.profile_settings = {
      ...(area.profile_settings || {}),
      business_name: body.businessName || body.business_name || row.business_name || "",
      contact_name: body.contactName || body.contact_name || "",
      phone: body.phone || row.phone || "",
      email: body.email || req.user.email || "",
      business_address: body.businessAddress || body.business_address || "",
      base_city: body.baseCity || body.base_city || "",
      deck_size: body.deckSize || body.deck_size || body.mowerDeckSizeInches || "",
      bio: body.bio || row.bio || "",
      equipment: body.equipment || row.equipment || "",
      logo_url: body.logoUrl || body.logo_url || ""
    };
    area.equipment = {
      ...(area.equipment || {}),
      mower_deck_size_inches: body.mowerDeckSizeInches == null && body.deckSize == null
        ? (area.equipment?.mower_deck_size_inches || null)
        : Number(body.mowerDeckSizeInches || body.deckSize || 0) || null,
      has_small_gate_mower: body.hasSmallGateMower == null
        ? Boolean(area.equipment?.has_small_gate_mower)
        : Boolean(body.hasSmallGateMower)
    };
    area.notification_preferences = body.notificationPreferences || area.notification_preferences || {};
    const savedArea = saveProviderArea(area);
    res.json({ ok: true, profile: providerProfileRowToApi(row, savedArea, req.user) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/equipment", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const body = req.body || {};
    const area = currentProviderArea(req.user.id);
    area.equipment = {
      mower_deck_size_inches: body.mower_deck_size_inches == null ? null : Number(body.mower_deck_size_inches),
      has_small_gate_mower: Boolean(body.has_small_gate_mower)
    };
    res.json({ ok: true, profile: saveProviderArea(area) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/services-offered", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    area.services_offered = listField(req.body?.services_offered || req.body?.servicesOffered || req.body?.services);
    res.json({ ok: true, profile: saveProviderArea(area) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/provider/services", requireAuth, providerAccessMiddleware, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.json({ ok: true, services: PROVIDER_SERVICE_DEFAULTS.map((service) => ({ ...service, enabled: false })) });
    }
    const { row, area } = await loadProviderProfileForUser(req.user);
    const pricing = await loadProviderPricing(row.id);
    res.json({ ok: true, services: providerServicesFromArea(area, pricing) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/services", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const body = req.body || {};
    const services = Array.isArray(body.services) ? body.services : [];
    const normalized = PROVIDER_SERVICE_DEFAULTS.map((service) => {
      const row = services.find((item) => item.id === service.id) || {};
      return {
        id: service.id,
        enabled: Boolean(row.enabled),
        basePrice: Number(row.basePrice || row.base_price || 0),
        minimumPrice: Number(row.minimumPrice || row.minimum_price || 0),
        ratePerSqft: Number(row.ratePerSqft || row.rate_per_sqft || 0),
        notes: String(row.notes || "").slice(0, 1000)
      };
    });
    const area = providerAreaForRequest(req);
    area.provider_services = normalized;
    area.services_offered = normalized.filter((service) => service.enabled).map((service) => service.id);
    const saved = saveProviderArea(area);

    const provider = await ensureProviderProfileForUser(req.user, {});
    const firstEnabled = normalized.find((service) => service.enabled) || normalized[0];
    if (firstEnabled) {
      const existing = await pgdb.query("SELECT id FROM provider_pricing WHERE provider_id = $1 LIMIT 1", [provider.id]);
      if (existing.rows.length) {
        await pgdb.query(
          `
          UPDATE provider_pricing
          SET base_fee = $2,
              rate_per_1000_sqft = $3,
              minimum_price = $4
          WHERE id = $1
          `,
          [
            existing.rows[0].id,
            firstEnabled.basePrice,
            firstEnabled.ratePerSqft * 1000,
            firstEnabled.minimumPrice
          ]
        );
      } else {
        await pgdb.query(
          `
          INSERT INTO provider_pricing (id, provider_id, base_fee, rate_per_1000_sqft, minimum_price)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            nanoid(10),
            provider.id,
            firstEnabled.basePrice,
            firstEnabled.ratePerSqft * 1000,
            firstEnabled.minimumPrice
          ]
        );
      }
    }

    res.json({ ok: true, services: providerServicesFromArea(saved, {}) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/provider/service-areas", requireAuth, providerAccessMiddleware, (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.json({ ok: true, provider_user_id: req.user.id, cities: [], counties: [], zones: [], preferences: {}, admin: true });
    }
    const area = currentProviderArea(req.user.id);
    res.json({ ok: true, ...area });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/service-areas", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const body = req.body || {};
    const area = currentProviderArea(req.user.id);
    const radius = body.radiusMiles ?? body.radius_miles ?? "";
    area.cities = listField(body.cities).map((city) => ({
      id: nanoid(10),
      city,
      state: DEFAULT_STATE,
      region_id: PRIMARY_REGION,
      radius_miles: radius === "" || radius == null ? null : Number(radius),
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    area.counties = listField(body.counties);
    area.service_area_settings = {
      base_address: body.baseAddress || body.base_address || "",
      base_city: body.baseCity || body.base_city || "",
      base_zip: body.baseZip || body.base_zip || "",
      radius_miles: radius === "" || radius == null ? null : Number(radius),
      notes: String(body.notes || "").slice(0, 1000)
    };
    area.preferences = {
      ...(area.preferences || {}),
      accepts_nearby_jobs: Boolean(body.acceptsNearbyJobs ?? body.accepts_nearby_jobs),
      max_extra_travel_miles: body.maxExtraTravelMiles == null && body.max_extra_travel_miles == null
        ? (area.preferences?.max_extra_travel_miles || null)
        : Number((body.maxExtraTravelMiles ?? body.max_extra_travel_miles) || 0),
      service_areas_paused: Boolean(body.serviceAreasPaused ?? body.service_areas_paused)
    };
    res.json({ ok: true, ...saveProviderArea(area) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/service-areas/preferences", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const body = req.body || {};
    const area = currentProviderArea(req.user.id);
    const radius = body.radius_miles == null || body.radius_miles === "" ? null : Number(body.radius_miles);
    area.cities = listField(body.cities).map((city) => ({
      id: nanoid(10),
      city,
      state: DEFAULT_STATE,
      region_id: PRIMARY_REGION,
      radius_miles: radius,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    area.preferences = {
      accepts_nearby_jobs: Boolean(body.accepts_nearby_jobs),
      max_extra_travel_miles: body.max_extra_travel_miles == null ? area.preferences?.max_extra_travel_miles || null : Number(body.max_extra_travel_miles),
      service_areas_paused: Boolean(body.service_areas_paused)
    };
    if (body.zone_geojson) {
      area.zones = [{
        id: area.zones?.[0]?.id || nanoid(10),
        name: "Custom service zone",
        geojson: body.zone_geojson,
        enabled: true,
        created_at: area.zones?.[0]?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }];
    }
    res.json({ ok: true, ...saveProviderArea(area) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/provider/service-areas/cities", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const body = req.body || {};
    const area = currentProviderArea(req.user.id);
    const city = {
      id: nanoid(10),
      city: body.city || "",
      state: body.state || DEFAULT_STATE,
      region_id: body.region_id || PRIMARY_REGION,
      radius_miles: body.radius_miles == null ? null : Number(body.radius_miles),
      enabled: body.enabled == null ? true : Boolean(body.enabled),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    area.cities.push(city);
    saveProviderArea(area);
    res.status(201).json({ ok: true, city });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/service-areas/cities/:id", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    const city = area.cities.find((item) => item.id === req.params.id);
    if (!city) return res.status(404).json({ ok: false, error: "City not found" });
    Object.assign(city, req.body || {}, { updated_at: new Date().toISOString() });
    saveProviderArea(area);
    res.json({ ok: true, city });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/provider/service-areas/cities/:id", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    area.cities = area.cities.filter((item) => item.id !== req.params.id);
    saveProviderArea(area);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/provider/service-areas/zones", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    const zone = {
      id: nanoid(10),
      name: req.body?.name || "Custom service zone",
      geojson: req.body?.geojson || req.body?.zone_geojson || null,
      enabled: req.body?.enabled == null ? true : Boolean(req.body.enabled),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    area.zones.push(zone);
    saveProviderArea(area);
    res.status(201).json({ ok: true, zone });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/provider/service-areas/zones/:id", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    const zone = area.zones.find((item) => item.id === req.params.id);
    if (!zone) return res.status(404).json({ ok: false, error: "Zone not found" });
    Object.assign(zone, req.body || {}, { updated_at: new Date().toISOString() });
    saveProviderArea(area);
    res.json({ ok: true, zone });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/provider/service-areas/zones/:id", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    area.zones = area.zones.filter((item) => item.id !== req.params.id);
    saveProviderArea(area);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- JOBS (PostgreSQL-backed) -------------------- */

function mapJobRow(row) {
  const details = row.details || "";
  const detailValue = (label) => {
    const line = details.split(/\n/).find((item) => item.toLowerCase().startsWith(label.toLowerCase() + ":"));
    return line ? line.slice(line.indexOf(":") + 1).trim() : "";
  };
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
    details,
    photos: parseJsonArray(row.photos),
    beforePhotoUrls: parseJsonArray(row.before_photo_urls),
    afterPhotoUrls: parseJsonArray(row.after_photo_urls),
    scopeSnapshot: parseJsonObject(row.job_scope_snapshot || row.scope_snapshot),
    status: row.status || "open",
    customerName: row.customer_name || row.customer_full_name || row.full_name || "",
    customerEmail: row.customer_email || row.email || "",
    customerPhone: row.customer_phone || row.phone || "",
    gate_size_category: detailValue("Gate size"),
    gate_width_inches: Number(detailValue("Gate width inches") || 0) || null,
    mower_access: detailValue("Mower access"),
    yard_access_notes: detailValue("Yard access notes"),
    community_access_type: detailValue("Community access"),
    available_days_json: listField(detailValue("Available days")),
    time_preference: detailValue("Time preference"),
    schedule_flexibility: detailValue("Schedule flexibility"),
    grass_height_range: detailValue("Grass height"),
    service_frequency: detailValue("Frequency"),
    pets: detailValue("Pets"),
    pet_waste_level: detailValue("Pet waste"),
    obstacles_list: listField(detailValue("Obstacles")),
    postedAt: row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    paymentStatus: row.payment_status || "unpaid",
    paymentMethod: row.payment_method || null,
    estimateAtBooking: row.estimate_at_booking != null ? Number(row.estimate_at_booking) : null,
    pricingBreakdownJson: parseJsonArray(row.pricing_breakdown_json),
    stripeCheckoutSessionId: row.stripe_checkout_session_id || null,
    paidAt: row.paid_at || null,
    codVerificationStatus: row.cod_verification_status || "not_required",
    codVerificationSentAt: row.cod_verification_sent_at || null,
    codVerifiedAt: row.cod_verified_at || null,
    codVerificationProvider: row.cod_verification_provider || null,
    codVerificationMessageSid: row.cod_verification_message_sid || null,
    codVerificationAttempts: Number(row.cod_verification_attempts || 0),
    phoneVerifiedAt: row.phone_verified_at || null,
    phoneVerifiedProvider: row.phone_verified_provider || null,
    phoneVerifiedNumber: row.phone_verified_number || null,
    phoneVerificationPurpose: row.phone_verification_purpose || null,
    smsConsentAt: row.sms_consent_at || null,
    smsConsentText: row.sms_consent_text || null,
  };
}

function sanitizeCustomerName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Customer";
  const first = parts[0];
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1].charAt(0).toUpperCase()}.` : "";
  return [first, lastInitial].filter(Boolean).join(" ");
}

function sanitizeJobForPublic(job = {}) {
  return {
    id: job.id || "",
    title: job.title || "",
    customerName: sanitizeCustomerName(job.customerName || job.customer_name || job.name || ""),
    city: job.city || "",
    state: job.state || "",
    regionId: job.regionId || job.region_id || "",
    budget: Number(job.budget || job.estimate || 0),
    serviceType: job.serviceType || job.service_type || "mowing",
    preferredDate: job.preferredDate || job.preferred_date || null,
    status: job.status || "open",
    paymentStatus: job.paymentStatus || job.payment_status || "unpaid",
    paymentMethod: job.paymentMethod || job.payment_method || null,
    codVerificationStatus: job.codVerificationStatus || job.cod_verification_status || "not_required",
    postedAt: job.postedAt || job.createdAt || job.created_at || null
  };
}

function sanitizeJobForOwner(job = {}) {
  return {
    ...sanitizeJobForPublic(job),
    address: job.address || "",
    zip: job.zip || "",
    budget: Number(job.budget || 0),
    details: job.details || "",
    gate_size_category: job.gate_size_category || "",
    gate_width_inches: job.gate_width_inches || null,
    mower_access: job.mower_access || "",
    yard_access_notes: job.yard_access_notes || "",
    community_access_type: job.community_access_type || "",
    beforePhotoUrls: parseJsonArray(job.beforePhotoUrls || job.before_photo_urls),
    afterPhotoUrls: parseJsonArray(job.afterPhotoUrls || job.after_photo_urls),
    scopeSnapshot: parseJsonObject(job.scopeSnapshot || job.job_scope_snapshot || job.scope_snapshot),
    estimateAtBooking: job.estimateAtBooking != null ? Number(job.estimateAtBooking) : null,
    pricingBreakdownJson: parseJsonArray(job.pricingBreakdownJson || job.pricing_breakdown_json),
    stripeCheckoutSessionId: job.stripeCheckoutSessionId || null,
    paymentMethod: job.paymentMethod || job.payment_method || null,
    codVerificationSentAt: job.codVerificationSentAt || job.cod_verification_sent_at || null,
    codVerifiedAt: job.codVerifiedAt || job.cod_verified_at || null,
    codVerificationProvider: job.codVerificationProvider || job.cod_verification_provider || null,
    codVerificationMessageSid: job.codVerificationMessageSid || job.cod_verification_message_sid || null,
    codVerificationAttempts: Number(job.codVerificationAttempts || job.cod_verification_attempts || 0),
    phoneVerifiedAt: job.phoneVerifiedAt || job.phone_verified_at || null,
    phoneVerifiedProvider: job.phoneVerifiedProvider || job.phone_verified_provider || null,
    phoneVerifiedNumber: job.phoneVerifiedNumber || job.phone_verified_number || null,
    phoneVerificationPurpose: job.phoneVerificationPurpose || job.phone_verification_purpose || null,
    paidAt: job.paidAt || null,
    createdAt: job.createdAt || job.postedAt || null,
    updatedAt: job.updatedAt || null
  };
}

function sanitizeJobForProvider(job = {}) {
  return {
    ...sanitizeJobForOwner(job),
    providerUserId: job.providerUserId || job.provider_user_id || null,
    customerName: job.customerName || "",
    customerEmail: job.customerEmail || "",
    customerPhone: job.customerPhone || "",
    photos: Array.isArray(job.photos) ? job.photos : [],
    beforePhotoUrls: parseJsonArray(job.beforePhotoUrls || job.before_photo_urls),
    afterPhotoUrls: parseJsonArray(job.afterPhotoUrls || job.after_photo_urls),
  };
}

function hasScopeSnapshotMutation(body = {}) {
  return Object.keys(body || {}).some((key) => [
    "scopeSnapshot",
    "scope_snapshot",
    "jobScopeSnapshot",
    "job_scope_snapshot",
    "selectedMowableGeoJSON",
    "selectedMowableGeoJson",
    "mowableGeoJSON",
    "mowableGeoJson",
    "parcelGeoJSON",
    "parcelGeoJson"
  ].includes(key));
}

function rejectScopeSnapshotMutation(res) {
  return res.status(403).json({ ok: false, error: "Paid job scope snapshots are read-only." });
}

function buildJobDetails(body = {}) {
  const serviceFields = servicePayloadFields(body);
  return [
    body.details || "",
    ...mowableEstimateDetails(body),
    serviceFields.quote_type ? `Quote type: ${serviceFields.quote_type}` : "",
    serviceFields.scope_locked ? "Scope locked: standard mowing only" : "",
    serviceFields.selected_yard_areas.length ? `Yard areas: ${serviceFields.selected_yard_areas.join(", ")}` : "",
    serviceFields.grass_height_range ? `Grass height: ${serviceFields.grass_height_range}` : "",
    serviceFields.service_frequency ? `Frequency: ${serviceFields.service_frequency}` : "",
    serviceFields.gate_size_category ? `Gate size: ${serviceFields.gate_size_category}` : "",
    serviceFields.gate_width_inches ? `Gate width inches: ${serviceFields.gate_width_inches}` : "",
    serviceFields.mower_access ? `Mower access: ${serviceFields.mower_access}` : "",
    serviceFields.yard_access_notes ? `Yard access notes: ${serviceFields.yard_access_notes}` : "",
    serviceFields.community_access_type ? `Community access: ${serviceFields.community_access_type}` : "",
    serviceFields.community_access_instructions_encrypted ? "Community access instructions: private" : "",
    serviceFields.available_days_json.length ? `Available days: ${serviceFields.available_days_json.join(", ")}` : "",
    serviceFields.time_preference ? `Time preference: ${serviceFields.time_preference}` : "",
    serviceFields.schedule_flexibility ? `Schedule flexibility: ${serviceFields.schedule_flexibility}` : "",
    serviceFields.available_date_start ? `Available start: ${serviceFields.available_date_start}` : "",
    serviceFields.available_date_end ? `Available end: ${serviceFields.available_date_end}` : "",
    serviceFields.specific_service_date ? `Specific date: ${serviceFields.specific_service_date}` : "",
    serviceFields.pets ? `Pets: ${serviceFields.pets}` : "",
    serviceFields.pet_waste_level ? `Pet waste: ${serviceFields.pet_waste_level}` : "",
    serviceFields.obstacles_list.length ? `Obstacles: ${serviceFields.obstacles_list.join(", ")}` : "",
    serviceFields.included_tasks_json.length ? `Included: ${serviceFields.included_tasks_json.join(", ")}` : "",
    serviceFields.excluded_tasks_json.length ? `Excluded: ${serviceFields.excluded_tasks_json.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

function geoJsonField(body = {}, ...keys) {
  for (const key of keys) {
    const value = body[key];
    if (!value) continue;
    const parsed = typeof value === "string" ? parseJsonObject(value) : value;
    if (
      parsed &&
      typeof parsed === "object" &&
      ["FeatureCollection", "Feature", "Polygon", "MultiPolygon"].includes(parsed.type)
    ) {
      return parsed;
    }
  }
  return null;
}

function firstNonBlank(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function jobSnapshotAddress(body = {}) {
  const address = firstNonBlank(body.address, body.street, body.serviceAddress);
  const city = firstNonBlank(body.city, body.parcelCity);
  const state = firstNonBlank(body.state, body.parcelState, DEFAULT_STATE);
  const zip = firstNonBlank(body.zip, body.parcelZip);
  const full = firstNonBlank(body.full, body.addressLabel, body.parcelLabel, [address, city, state, zip].filter(Boolean).join(", "));
  return { address, city, state, zip, full };
}

function buildJobScopeSnapshot(body = {}, pricingBreakdown = null) {
  const serviceFields = servicePayloadFields(body);
  const finalAmount = Number(body.final_price || body.finalPrice || body.paidAmount || body.paymentAmount || body.budget || body.estimate || 0);
  const tipAmount = Number(body.tipAmount || body.tip_amount || body.gratuity || 0);
  const address = jobSnapshotAddress(body);
  const parcelLabel = firstNonBlank(body.parcelLabel, body.parcel_label, body.addressLabel, body.address_label, address.full);
  const parcelId = firstNonBlank(body.parcelId, body.parcel_id);
  const mapCenter = body.mapCenter || body.map_center || null;
  const mapBounds = body.mapBounds || body.map_bounds || null;
  const snapshot = {
    version: 1,
    immutable: true,
    source: "booking",
    parcelGeoJSON: geoJsonField(body, "parcelGeoJSON", "parcelGeoJson", "parcel_geojson"),
    selectedMowableGeoJSON: geoJsonField(body, "selectedMowableGeoJSON", "selectedMowableGeoJson", "mowableGeoJSON", "mowableGeoJson", "mowable_geojson"),
    excludedGeoJSON: geoJsonField(body, "excludedGeoJSON", "excludedGeoJson", "cutoutGeoJSON", "cutoutGeoJson", "cutout_geojson"),
    mowableAreaSqFt: Number(body.mowAreaSqft || body.mowableAreaSqFt || body.mowable_area_sqft || body.areaSqft || 0),
    mowableSqft: Number(body.mowAreaSqft || body.mowableAreaSqFt || body.mowable_area_sqft || body.areaSqft || 0),
    lotAreaSqFt: Number(body.lotAreaSqft || body.lotAreaSqFt || body.lot_area_sqft || body.parcelAreaSqft || 0),
    lotSqft: Number(body.lotAreaSqft || body.lotAreaSqFt || body.lot_area_sqft || body.parcelAreaSqft || 0),
    serviceType: body.serviceType || body.service_type || "mowing",
    estimateAmountShownAtBooking: finalAmount,
    finalAmount,
    paidAmount: Number(body.paidAmount || body.paymentAmount || 0) || finalAmount,
    tipAmount,
    pricingBreakdown: pricingBreakdown && typeof pricingBreakdown === "object" ? pricingBreakdown : null,
    address,
    addressLabel: address.full,
    parcelLabel,
    parcelId,
    access: {
      gateSize: serviceFields.gate_size_category,
      gateAccessType: serviceFields.gate_access_type,
      gateWidthInches: serviceFields.gate_width_inches,
      gateLocked: serviceFields.gate_locked,
      mowerAccess: serviceFields.mower_access,
      yardAccessNotes: serviceFields.yard_access_notes,
      communityAccessType: serviceFields.community_access_type,
      communityAccessPrivate: Boolean(serviceFields.community_access_instructions_encrypted)
    },
    serviceOptions: {
      quoteType: serviceFields.quote_type,
      scopeLocked: serviceFields.scope_locked,
      selectedYardAreas: serviceFields.selected_yard_areas,
      requestedTasks: serviceFields.requested_tasks,
      includedTasks: serviceFields.included_tasks_json,
      excludedTasks: serviceFields.excluded_tasks_json,
      grassHeight: serviceFields.grass_height_range,
      frequency: serviceFields.service_frequency,
      pets: serviceFields.pets,
      petWaste: serviceFields.pet_waste_level,
      obstacles: serviceFields.obstacles_list,
      availableDays: serviceFields.available_days_json,
      timePreference: serviceFields.time_preference,
      scheduleFlexibility: serviceFields.schedule_flexibility,
      availableDateStart: serviceFields.available_date_start,
      availableDateEnd: serviceFields.available_date_end,
      specificServiceDate: serviceFields.specific_service_date
    },
    smsConsent: body.sms_consent_at || body.smsConsentAt ? {
      at: body.sms_consent_at || body.smsConsentAt,
      text: body.sms_consent_text || body.smsConsentText || SMS_CONSENT_TEXT
    } : null,
    terrain: body.terrain && typeof body.terrain === "object" ? {
      difficultyScore:     body.terrain.difficultyScore,
      difficultyCategory:  body.terrain.difficultyCategory,
      elevationChangeFt:   body.terrain.elevationChangeFt,
      averageGradePercent: body.terrain.averageGradePercent,
      maxGradePercent:     body.terrain.maxGradePercent,
      source:              body.terrain.source,
      terrainGuardrail:    body.terrain.terrainGuardrail,
    } : null,
    customerNotes: serviceFields.customer_notes,
    notes: serviceFields.customer_notes,
    mapCenter,
    mapBounds,
    map: {
      center: mapCenter,
      bounds: mapBounds
    },
    createdAt: new Date().toISOString()
  };

  return Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== null && value !== undefined));
}

async function insertJobForUser(userId, body = {}, status = "open", options = {}) {
  await ensureJobsScopeSnapshotColumn();
  await ensurePaymentColumns();
  await ensureCodVerificationColumns();
  await ensureSmsConsentColumns();
  await ensureJobsCustomerEmailColumn();
  /* Compute pricing breakdown at insert time so it's snapshotted permanently */
  let pricingBreakdown = null;
  let estimateTotal = Number(body.budget || body.final_price || body.estimate || 0);
  const customerEmail = normalizeEmailForClaim(body.customerEmail || body.email || body.contactEmail || "");
  try {
    if (Number(body.mowAreaSqft || body.areaSqft || 0) > 0) {
      const settings = await loadSettingsFromDb();
      const result = estimateQuoteWithBreakdown(body, settings);
      pricingBreakdown = result.breakdown;
      if (result.estimate > 0) estimateTotal = result.estimate;
    }
  } catch (bErr) {
    console.warn('[Job] Could not compute pricing breakdown for snapshot:', bErr.message);
  }
  const scopeSnapshot = buildJobScopeSnapshot(body, pricingBreakdown);
  const insertPaymentStatus = String(options.paymentStatus || "unpaid").trim() || "unpaid";
  const insertPaymentMethod = options.paymentMethod ? String(options.paymentMethod).trim() : null;
  const smsConsentAt = body.sms_consent_at || body.smsConsentAt || null;
  const smsConsentText = body.sms_consent_text || body.smsConsentText || null;
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
      job_scope_snapshot,
      scope_snapshot,
      customer_email,
      status,
      payment_status,
      payment_method,
      estimate_at_booking,
      pricing_breakdown_json,
      sms_consent_at,
      sms_consent_text
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $15::jsonb, $16,
      $17, $18, $19, $20, $21::jsonb, $22, $23
    )
    RETURNING *
    `,
    [
      nanoid(10),
      userId,
      body.providerUserId || null,
      body.title || "",
      body.address || "",
      body.city || "",
      body.state || DEFAULT_STATE,
      body.zip || "",
      body.regionId || "",
      Number(body.budget || body.final_price || body.estimate || 0),
      body.serviceType || body.service_type || "mowing",
      body.preferredDate || null,
      buildJobDetails(body),
      JSON.stringify(Array.isArray(body.photos) ? body.photos : []),
      JSON.stringify(scopeSnapshot),
      customerEmail,
      status,
      insertPaymentStatus,
      insertPaymentMethod,
      estimateTotal > 0 ? estimateTotal : null,
      pricingBreakdown ? JSON.stringify(pricingBreakdown) : null,
      smsConsentAt,
      smsConsentText
    ]
  );

  return mapJobRow(result.rows[0]);
}

app.get("/api/jobs", requireAuth, async (req, res) => {
  try {
    await ensureJobsScopeSnapshotColumn();
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

    const jobs = result.rows.map(mapJobRow);

    res.json({ ok: true, jobs: req.user.role === "admin" ? jobs : jobs.map(sanitizeJobForPublic) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  const user = req.user;

  // === AUTHENTICATED FLOW ONLY ===

  try {
    const body = req.body || {};
    const phone = submittedPhone(body) || String(user?.phone || "").trim();
    if (!isValidLookingPhone(phone)) return rejectMissingPhone(res);
    const smsConsent = requireSmsConsent(res, body);
    if (!smsConsent) return;
    applySmsConsentSnapshot(body, smsConsent);
    body.phone = phone;
    body.customerPhone = phone;
    body.email = body.email || body.customerEmail || user.email || "";
    body.customerEmail = body.customerEmail || body.email || user.email || "";
    const job = await insertJobForUser(user.id, body, "open");
    await updateUserPhoneIfBlank(user.id, phone);

    res.status(201).json({
      ok: true,
      job
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Public alias: POST /api/leads — same as unauthenticated /api/jobs
app.post("/api/leads", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const phone = submittedPhone(body);
    if (!isValidLookingPhone(phone)) return rejectMissingPhone(res);
    const smsConsent = requireSmsConsent(res, body);
    if (!smsConsent) return;
    const lead = {
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      status: "new",
      customerName: body.customerName || body.name || "",
      customerPhone: phone,
      customerEmail: body.customerEmail || body.email || "",
      address: body.address || "",
      city: body.city || "",
      state: body.state || DEFAULT_STATE,
      zip: body.zip || "",
      regionId: body.regionId || PRIMARY_REGION,
      serviceType: body.serviceType || "mowing",
      preferredDate: body.preferredDate || null,
      notes: body.notes || body.details || "",
      lotAreaSqft: Number(body.lotAreaSqft || 0),
      mowAreaSqft: Number(body.mowAreaSqft || 0),
      ...mowableEstimateFields(body),
      ...servicePayloadFields(body),
      estimatedPrice: Number(body.estimatedPrice || body.estimate || body.budget || 0),
      estimatedPriceLow: body.estimated_price_low ? Number(body.estimated_price_low) : null,
      estimatedPriceHigh: body.estimated_price_high ? Number(body.estimated_price_high) : null,
      finalPrice: body.final_price ? Number(body.final_price) : null,
      suggestedBudget: Number(body.suggestedBudget || body.budget || 0),
      photos: listField(body.photos),
      aiSummaryJson: body.ai_summary_json || aiPhotoAnalysisPlaceholder(body),
      smsConsentAt: smsConsent.at,
      smsConsentText: smsConsent.text,
      sms_consent_at: smsConsent.at,
      sms_consent_text: smsConsent.text,
      sourceBrand: body.sourceBrand || SITE_BRAND
    };

    const leads = readLeads();
    leads.push(lead);
    writeLeads(leads);
    await updateUserPhoneIfBlank(req.user?.id, phone);

    res.status(201).json({ ok: true, lead, job: lead });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/bid-requests", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const phone = submittedPhone(body);
    if (!isValidLookingPhone(phone)) return rejectMissingPhone(res);
    const smsConsent = requireSmsConsent(res, body);
    if (!smsConsent) return;
    const photoUrls = listField(body.photos);
    const serviceTypes = listField(body.service_types || body.serviceTypes || body.requested_tasks);
    const bidRequest = {
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      related_quote_id: body.related_quote_id || body.relatedQuoteId || null,
      related_job_id: body.related_job_id || body.relatedJobId || null,
      customer_user_id: body.customer_user_id || null,
      customerName: body.customerName || body.name || "",
      customerPhone: phone,
      customerEmail: body.customerEmail || body.email || "",
      address: body.address || "",
      city: body.city || "",
      state: body.state || DEFAULT_STATE,
      zip: body.zip || "",
      service_types: serviceTypes.length ? serviceTypes : [body.serviceType || "other_outdoor_work"],
      requested_tasks: listField(body.requested_tasks || body.requestedTasks),
      notes: body.notes || "",
      preferredTiming: body.preferredTiming || body.preferred_timing || "flexible",
      status: "new",
      ai_summary_json: body.ai_summary_json || aiPhotoAnalysisPlaceholder(body),
      sms_consent_at: smsConsent.at,
      sms_consent_text: smsConsent.text,
      smsConsentAt: smsConsent.at,
      smsConsentText: smsConsent.text,
      provider_bid_amount: body.provider_bid_amount == null ? null : Number(body.provider_bid_amount),
      accepted_bid_id: body.accepted_bid_id || null,
      ...servicePayloadFields(body),
      photos: photoUrls
    };

    const bidRequests = readJsonArray(BID_REQUESTS_FILE);
    bidRequests.push(bidRequest);
    writeJsonArray(BID_REQUESTS_FILE, bidRequests);
    await updateUserPhoneIfBlank(req.user?.id, phone);

    if (photoUrls.length) {
      const photos = readJsonArray(JOB_PHOTOS_FILE);
      photoUrls.forEach((fileUrl) => {
        photos.push({
          id: nanoid(10),
          createdAt: new Date().toISOString(),
          quote_id: bidRequest.related_quote_id,
          job_id: bidRequest.related_job_id,
          bid_request_id: bidRequest.id,
          photo_type: body.photo_type || "customer_scope",
          file_url: fileUrl,
          ai_analysis_json: aiPhotoAnalysisPlaceholder({
            ...body,
            detected_services: bidRequest.service_types
          })
        });
      });
      writeJsonArray(JOB_PHOTOS_FILE, photos);
    }

    res.status(201).json({ ok: true, bidRequest });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/bid-requests", requireAuth, requireRole("admin"), (req, res) => {
  try {
    let bidRequests = readJsonArray(BID_REQUESTS_FILE);
    if (req.query.status) bidRequests = bidRequests.filter((item) => item.status === req.query.status);
    if (req.query.serviceType) {
      bidRequests = bidRequests.filter((item) => listField(item.service_types).includes(req.query.serviceType));
    }
    bidRequests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, bidRequests, total: bidRequests.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/job-photos", requireAuth, requireRole("admin"), (_req, res) => {
  try {
    const photos = readJsonArray(JOB_PHOTOS_FILE).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, photos, total: photos.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/jobs/:id/photos", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const urls = listField(body.photos || body.file_url || body.fileUrl);
    const photos = readJsonArray(JOB_PHOTOS_FILE);
    const created = urls.map((fileUrl) => ({
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      quote_id: body.quote_id || null,
      job_id: req.params.id,
      bid_request_id: null,
      photo_type: body.photo_type || "other",
      file_url: fileUrl,
      ai_analysis_json: aiPhotoAnalysisPlaceholder(body)
    }));
    photos.push(...created);
    writeJsonArray(JOB_PHOTOS_FILE, photos);
    res.status(201).json({ ok: true, photos: created });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/bid-requests/:id/photos", async (req, res) => {
  try {
    const body = req.body || {};
    const urls = listField(body.photos || body.file_url || body.fileUrl);
    const photos = readJsonArray(JOB_PHOTOS_FILE);
    const created = urls.map((fileUrl) => ({
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      quote_id: body.quote_id || null,
      job_id: body.job_id || null,
      bid_request_id: req.params.id,
      photo_type: body.photo_type || "other",
      file_url: fileUrl,
      ai_analysis_json: aiPhotoAnalysisPlaceholder(body)
    }));
    photos.push(...created);
    writeJsonArray(JOB_PHOTOS_FILE, photos);
    res.status(201).json({ ok: true, photos: created });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/jobs/:id/ai-photo-evaluate", requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, analysis: aiPhotoAnalysisPlaceholder(req.body || {}) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function providerCanHandleJob(providerArea, job) {
  const service = job.service_type || job.serviceType || "mowing";
  const services = providerArea.services_offered || [];
  const reasons = [];
  const excluded = [];

  if (providerArea.preferences?.service_areas_paused) excluded.push("Service areas paused");
  if (services.length && !services.includes(service)) excluded.push("Does not offer requested service");

  const cityMatch = (providerArea.cities || []).some((city) =>
    city.enabled !== false && String(city.city || "").toLowerCase() === String(job.city || "").toLowerCase()
  );
  if (cityMatch) reasons.push(`Serves ${job.city}`);

  if (!cityMatch && providerArea.zones?.some((zone) => zone.enabled !== false)) {
    reasons.push("Has custom polygon; location should be verified");
  }

  const gate = job.gate_size_category || "";
  if (["small_under_36", "standard_36", "wide_48", "not_sure"].includes(gate) && !providerArea.equipment?.has_small_gate_mower) {
    excluded.push("Gate/equipment mismatch");
  } else if (providerArea.equipment?.has_small_gate_mower) {
    reasons.push("Has small-gate mower");
  }

  return {
    eligible: excluded.length === 0 && (cityMatch || providerArea.preferences?.accepts_nearby_jobs || providerArea.zones?.length),
    reasons,
    excluded
  };
}

app.get("/api/admin/providers/:id/service-areas", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const area = readJsonArray(PROVIDER_SERVICE_AREAS_FILE).find((item) => item.provider_user_id === req.params.id || item.provider_profile_id === req.params.id);
    res.json({ ok: true, serviceAreas: area || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/jobs/:id/eligible-providers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const jobResult = await pgdb.query("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!jobResult.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
    const job = mapJobRow(jobResult.rows[0]);
    const providerAreas = readJsonArray(PROVIDER_SERVICE_AREAS_FILE);
    const providers = providerAreas.map((area) => {
      const match = providerCanHandleJob(area, job);
      return {
        provider_user_id: area.provider_user_id,
        provider_profile_id: area.provider_profile_id || null,
        eligible: match.eligible,
        matched_reasons: match.reasons,
        excluded_reasons: match.excluded,
        equipment: area.equipment,
        services_offered: area.services_offered,
        preferences: area.preferences
      };
    });
    res.json({ ok: true, job, eligibleProviders: providers.filter((p) => p.eligible), excludedProviders: providers.filter((p) => !p.eligible) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/jobs/:id/assign-provider", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const providerUserId = req.body?.provider_user_id || req.body?.providerUserId;
    const providerId = req.body?.provider_id || req.body?.providerId || null;
    if (!providerUserId && !providerId) return res.status(400).json({ ok: false, error: "provider_user_id or provider_id is required" });
    const provider = providerId
      ? await pgdb.query("SELECT id, user_id FROM provider_profiles WHERE id = $1 LIMIT 1", [providerId])
      : await pgdb.query("SELECT id, user_id FROM provider_profiles WHERE user_id = $1 LIMIT 1", [providerUserId]);
    if (!provider.rows.length) return res.status(404).json({ ok: false, error: "Provider not found" });
    const result = await pgdb.query(
      "UPDATE jobs SET provider_user_id = $1, status = 'assigned' WHERE id = $2 RETURNING *",
      [provider.rows[0].user_id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
    res.json({ ok: true, job: mapJobRow(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/jobs/:id/assign-provider", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const providerId = req.body?.provider_id || req.body?.providerId || "";
    const providerUserId = req.body?.provider_user_id || req.body?.providerUserId || "";
    if (!providerId && !providerUserId) {
      const result = await pgdb.query(
        "UPDATE jobs SET provider_user_id = NULL, status = 'open' WHERE id = $1 RETURNING *",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
      return res.json({ ok: true, job: mapJobRow(result.rows[0]) });
    }
    const provider = providerId
      ? await pgdb.query("SELECT id, user_id FROM provider_profiles WHERE id = $1 LIMIT 1", [providerId])
      : await pgdb.query("SELECT id, user_id FROM provider_profiles WHERE user_id = $1 LIMIT 1", [providerUserId]);
    if (!provider.rows.length) return res.status(404).json({ ok: false, error: "Provider not found" });
    const result = await pgdb.query(
      "UPDATE jobs SET provider_user_id = $1, status = CASE WHEN status IN ('completed','canceled','refunded') THEN status ELSE 'assigned' END WHERE id = $2 RETURNING *",
      [provider.rows[0].user_id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
    res.json({ ok: true, job: mapJobRow(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/jobs/:id/attach-user", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const userId = req.body?.user_id || req.body?.userId;
    if (!userId) return res.status(400).json({ ok: false, error: "user_id is required" });
    const user = await pgdb.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [userId]);
    if (!user.rows.length) return res.status(404).json({ ok: false, error: "User not found" });
    const result = await pgdb.query(
      "UPDATE jobs SET customer_user_id = $2 WHERE id = $1 RETURNING *",
      [req.params.id, userId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
    res.json({ ok: true, job: mapJobRow(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/bids", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const bid = {
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      bid_request_id: req.body?.bid_request_id || null,
      provider_user_id: req.body?.provider_user_id || null,
      amount: Number(req.body?.amount || 0),
      notes: req.body?.notes || "",
      status: "created"
    };
    const bids = readJsonArray(path.join(__dirname, "..", "data", "provider_bids.json"));
    bids.push(bid);
    writeJsonArray(path.join(__dirname, "..", "data", "provider_bids.json"), bids);
    res.status(201).json({ ok: true, bid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/jobs/:id/claim", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
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
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
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

function paymentForQuoteId(payments = [], quoteId = "") {
  return payments.find((payment) => String(payment.quote_id || "") === String(quoteId || "")) || null;
}

function adminQuoteFromRow(row = {}, payments = []) {
  const payment = paymentForQuoteId(payments, row.id);
  const userFullName = row.customer_full_name || [row.customer_first_name, row.customer_last_name].filter(Boolean).join(" ");
  const customerName = row.name || userFullName || payment?.customer?.name || "";
  const customerEmail = row.email || row.customer_email || payment?.customer?.email || "";
  const customerPhone = row.phone || row.customer_phone || payment?.customer?.phone || "";
  const serviceType = row.service_type || "mowing";
  const convertedJobId = row.converted_to_job_id || payment?.job_id || null;

  return {
    id: row.id,
    customerUserId: row.customer_user_id || null,
    customer: {
      id: row.customer_user_id || null,
      name: customerName,
      userName: userFullName || "",
      email: customerEmail,
      phone: customerPhone,
      firstName: row.customer_first_name || "",
      lastName: row.customer_last_name || ""
    },
    name: row.name || customerName,
    email: customerEmail,
    phone: customerPhone,
    address: row.address || "",
    city: row.city || "",
    state: row.state || "",
    zip: row.zip || "",
    serviceType,
    serviceId: serviceType,
    regionId: row.region_id || "",
    estimate: Number(row.estimate || 0),
    status: row.status || "new",
    createdAt: row.created_at,
    lotSqft: Number(row.lot_area_sqft || 0),
    mowableSqft: Number(row.mow_area_sqft || 0),
    lotAreaSqft: Number(row.lot_area_sqft || 0),
    mowAreaSqft: Number(row.mow_area_sqft || 0),
    lotSource: row.lot_source || "",
    propertyType: row.property_type || "",
    parcelId: row.parcel_id || "",
    notes: row.notes || "",
    scope: {
      fenced: Boolean(row.fenced),
      overgrown: Boolean(row.overgrown),
      obstacles: Boolean(row.obstacles),
      rushJob: Boolean(row.rush_job),
      limitedAccess: Boolean(row.limited_access),
      slopedTerrain: Boolean(row.sloped_terrain),
      denseVegetation: Boolean(row.dense_vegetation),
      gates: Boolean(row.gates)
    },
    payment: payment ? {
      id: payment.id || null,
      jobId: payment.job_id || null,
      quoteId: payment.quote_id || null,
      amount: payment.amount == null ? null : Number(payment.amount),
      status: payment.status || "",
      stripeCheckoutSessionId: payment.stripe_checkout_session_id || null,
      paidAt: payment.paid_at || null,
      createdAt: payment.created_at || null,
      updatedAt: payment.updated_at || null
    } : null,
    paymentId: payment?.id || null,
    paymentStatus: payment?.status || null,
    paymentAmount: payment?.amount == null ? null : Number(payment.amount),
    convertedToJobId: convertedJobId,
    jobId: convertedJobId,
    convertedAt: row.converted_at || null
  };
}

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

app.get("/api/admin/quotes", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await ensureUsersPhoneColumn();
    const result = await pgdb.query(
      `
      SELECT
        q.*,
        u.full_name AS customer_full_name,
        u.first_name AS customer_first_name,
        u.last_name AS customer_last_name,
        u.email AS customer_email,
        u.phone AS customer_phone
      FROM quotes q
      LEFT JOIN users u ON u.id = q.customer_user_id
      ORDER BY q.created_at DESC
      LIMIT 500
      `
    );
    const payments = readJsonArray(PAYMENTS_FILE);
    const quotes = result.rows.map((row) => adminQuoteFromRow(row, payments));
    res.json({ ok: true, source: "postgres:quotes", quotes, total: quotes.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Customer: their own quotes by user_id or email
app.get("/api/customer/quotes", requireAuth, async (req, res) => {
  try {
    const email = normalizeEmailForClaim(req.user.email || "");
    const result = await pgdb.query(
      `SELECT * FROM quotes
       WHERE customer_user_id = $1
          OR (
            customer_user_id IS NULL
            AND $2 <> ''
            AND LOWER(TRIM(email)) = $2
          )
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id, email]
    );
    res.json({ ok: true, quotes: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/quotes", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const phone = submittedPhone(body);
    if (!isValidLookingPhone(phone)) return rejectMissingPhone(res);
    const smsConsent = requireSmsConsent(res, body);
    if (!smsConsent) return;
    await ensureSmsConsentColumns();
    const settings = await loadSettingsFromDb();
    const estimate = estimateQuote(body, settings);
    const serviceFields = servicePayloadFields(body);
    const requestedStatus = String(body.status || "").trim();
    const status = requestedStatus === "manual_requested" ? "manual_requested" : "new";

    const quote = {
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      name: body.name || "",
      phone,
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
      fenced: isTrue(body.fenced),
      overgrown: isTrue(body.overgrown),
      obstacles: isTrue(body.obstacles),
      rushJob: isTrue(body.rushJob),
      limitedAccess: isTrue(body.limitedAccess),
      slopedTerrain: isTrue(body.slopedTerrain),
      denseVegetation: isTrue(body.denseVegetation),
      gates: isTrue(body.gates),
      parcelId: body.parcelId || "",
      notes: body.notes || "",
      ...serviceFields,
      estimated_price_low: serviceFields.estimated_price_low,
      estimated_price_high: serviceFields.estimated_price_high,
      final_price: estimate,
      estimate,
      status,
      sms_consent_at: smsConsent.at,
      sms_consent_text: smsConsent.text
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
        customer_user_id,
        sms_consent_at,
        sms_consent_text
       )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
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
        req.user?.id || null,
        quote.sms_consent_at,
        quote.sms_consent_text
      ]
    );
    await updateUserPhoneIfBlank(req.user?.id, phone);

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
    if (!isValidLookingPhone(quote.phone || "")) return rejectMissingPhone(res);
    await ensureSmsConsentColumns();

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
    await updateUserPhoneIfBlank(customerUserId, quote.phone);
    await ensureJobsCustomerEmailColumn();

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
        customer_email,
        sms_consent_at,
        sms_consent_text,
        status
      )
      VALUES (
        $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, $13, $14, $15, 'open'
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
        JSON.stringify([]),
        normalizeEmailForClaim(quote.email || ""),
        quote.sms_consent_at || null,
        quote.sms_consent_text || null
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
    await ensureJobsScopeSnapshotColumn();
    await ensureJobsCustomerEmailColumn();
    const email = normalizeEmailForClaim(req.user.email || "");
    const result = await pgdb.query(
      `
      SELECT *
      FROM jobs
      WHERE customer_user_id = $1
         OR (
           customer_user_id IS NULL
           AND $2 <> ''
           AND LOWER(TRIM(customer_email)) = $2
         )
      ORDER BY created_at DESC
      `,
      [req.user.id, email]
    );
    res.json({ ok: true, jobs: result.rows.map(mapJobRow).map(sanitizeJobForOwner) });
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
    res.json({ ok: true, jobs: result.rows.map(mapJobRow).map(sanitizeJobForPublic) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/jobs/:id", requireAuth, async (req, res) => {
  try {
    await ensureJobsScopeSnapshotColumn();
    const result = await pgdb.query("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });

    const row = result.rows[0];
    const isOwner = row.customer_user_id && String(row.customer_user_id) === String(req.user.id);
    const isAdmin = req.user.role === "admin";
    const isProvider = req.user.role === "provider" && (!row.provider_user_id || String(row.provider_user_id) === String(req.user.id));
    if (!isOwner && !isAdmin && !isProvider) {
      return res.status(403).json({ ok: false, error: "Not authorized for this job" });
    }

    res.json({ ok: true, job: mapJobRow(row) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

function canVerifyCodJob(req, row = {}) {
  if (row.customer_user_id) {
    return Boolean(req.user?.id && String(row.customer_user_id) === String(req.user.id));
  }
  if (!req.user?.id) return true;
  const jobEmail = normalizeEmailForClaim(row.customer_email || "");
  const userEmail = normalizeEmailForClaim(req.user?.email || req.body?.email || req.body?.customerEmail || "");
  return !jobEmail || (userEmail && jobEmail === userEmail);
}

app.post("/api/jobs/:id/verify-cod", optionalAuth, async (req, res) => {
  try {
    await ensureCodVerificationColumns();
    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: "A valid 6-digit verification code is required." });
    }

    const jobResult = await pgdb.query("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!jobResult.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
    const row = jobResult.rows[0];
    if (!isCodPaymentMethod(row.payment_method)) {
      return res.status(400).json({ ok: false, error: "COD verification only applies to cash/check-on-site jobs." });
    }
    if (!canVerifyCodJob(req, row)) {
      return res.status(403).json({ ok: false, error: "Not authorized for this job" });
    }
    if (row.cod_verification_status === "verified") {
      return res.status(409).json({ ok: false, error: "This cash/check-on-site request is already verified." });
    }
    if (String(row.cod_verification_provider || "").trim().toLowerCase() === "twilio_verify") {
      const payments = readJsonArray(PAYMENTS_FILE);
      const payment = paymentForJobId(payments, row.id);
      const verifyPhone = normalizePhoneForVerification(payment?.customer?.phone || row.customer_phone || req.user?.phone || "");
      if (!isE164Phone(verifyPhone)) {
        return res.status(400).json({ ok: false, error: "A valid phone number is required for verification." });
      }
      const verification = await checkPhoneVerification({
        phone: verifyPhone,
        code,
        purpose: "cod_verification",
        userId: req.user?.id || null,
        ip: requestIp(req)
      });
      if (!verification.ok || verification.status !== "approved") {
        if (verification.missing?.length) {
          return res.status(503).json({ ok: false, code: "PHONE_VERIFICATION_UNAVAILABLE", error: PHONE_VERIFICATION_UNAVAILABLE_MESSAGE });
        }
        return res.status(400).json({ ok: false, error: "We could not verify that code. Please try again." });
      }
      const updated = await pgdb.query(
        `
        UPDATE jobs
        SET cod_verification_status = 'verified',
            cod_verified_at = NOW(),
            cod_verification_code = NULL,
            status = 'open',
            phone_verified_at = NOW(),
            phone_verified_provider = $2,
            phone_verified_number = $3,
            phone_verification_purpose = 'cod_verification'
        WHERE id = $1
        RETURNING *
        `,
        [row.id, verification.provider || "twilio_verify", verifyPhone]
      );
      return res.json({
        ok: true,
        verified: true,
        provider: verification.provider || "twilio_verify",
        status: "approved",
        job: sanitizeJobForOwner(mapJobRow(updated.rows[0])),
        message: "Your request is confirmed. We’ll review the job details and contact you if anything needs adjustment."
      });
    }
    const payments = readJsonArray(PAYMENTS_FILE);
    const payment = paymentForJobId(payments, row.id);
    const verifiedPhone = normalizePhoneForVerification(payment?.customer?.phone || row.customer_phone || req.user?.phone || "");
    const fallbackProvider = row.cod_verification_provider || getSmsProvider();
    const fallbackCheckStartedAt = Date.now();
    logPhoneVerificationEvent("verification_check_attempt", {
      provider: fallbackProvider,
      phone: verifiedPhone,
      purpose: "cod_verification",
      status: "attempt",
      ip: requestIp(req),
      userId: req.user?.id || null,
      elapsedMs: 0
    });
    if (codVerificationIsExpired(row.cod_verification_sent_at)) {
      await pgdb.query("UPDATE jobs SET cod_verification_status = 'expired' WHERE id = $1", [row.id]).catch(() => {});
      logPhoneVerificationEvent("verification_check_failed", {
        provider: fallbackProvider,
        phone: verifiedPhone,
        purpose: "cod_verification",
        status: "expired",
        ip: requestIp(req),
        userId: req.user?.id || null,
        elapsedMs: Date.now() - fallbackCheckStartedAt
      }, "warn");
      return res.status(400).json({ ok: false, error: "Verification code expired. Please request a new code." });
    }
    if (String(row.cod_verification_code || "") !== code) {
      logPhoneVerificationEvent("verification_check_failed", {
        provider: fallbackProvider,
        phone: verifiedPhone,
        purpose: "cod_verification",
        status: "failed",
        ip: requestIp(req),
        userId: req.user?.id || null,
        elapsedMs: Date.now() - fallbackCheckStartedAt
      }, "warn");
      return res.status(400).json({ ok: false, error: "Verification code is incorrect." });
    }

    const updated = await pgdb.query(
      `
      UPDATE jobs
      SET cod_verification_status = 'verified',
          cod_verified_at = NOW(),
          cod_verification_code = NULL,
          status = 'open',
          phone_verified_at = NOW(),
          phone_verified_provider = COALESCE(cod_verification_provider, $2),
          phone_verified_number = $3,
          phone_verification_purpose = 'cod_verification'
      WHERE id = $1
      RETURNING *
      `,
      [row.id, row.cod_verification_provider || getSmsProvider(), verifiedPhone]
    );
    logPhoneVerificationEvent("verification_check_approved", {
      provider: fallbackProvider,
      phone: verifiedPhone,
      purpose: "cod_verification",
      status: "approved",
      ip: requestIp(req),
      userId: req.user?.id || null,
      elapsedMs: Date.now() - fallbackCheckStartedAt
    });
    res.json({
      ok: true,
      verified: true,
      job: sanitizeJobForOwner(mapJobRow(updated.rows[0])),
      message: "Your request is confirmed. We’ll review the job details and contact you if anything needs adjustment."
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/jobs/:id/resend-cod-code", optionalAuth, async (req, res) => {
  try {
    await ensureCodVerificationColumns();
    const jobResult = await pgdb.query("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!jobResult.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
    const row = jobResult.rows[0];
    if (!isCodPaymentMethod(row.payment_method)) {
      return res.status(400).json({ ok: false, error: "COD verification only applies to cash/check-on-site jobs." });
    }
    if (!canVerifyCodJob(req, row)) {
      return res.status(403).json({ ok: false, error: "Not authorized for this job" });
    }
    if (row.cod_verification_status === "verified") {
      return res.status(409).json({ ok: false, error: "This cash/check-on-site request is already verified." });
    }
    if (!row.sms_consent_at || row.sms_consent_text !== SMS_CONSENT_TEXT) {
      return res.status(400).json({ ok: false, error: SMS_CONSENT_REQUIRED_MESSAGE });
    }
    if (Number(row.cod_verification_attempts || 0) >= 5) {
      return res.status(429).json({ ok: false, error: "Maximum verification attempts reached." });
    }
    const lastSentMs = new Date(row.cod_verification_sent_at || 0).getTime();
    if (Number.isFinite(lastSentMs) && Date.now() - lastSentMs < 60 * 1000) {
      return res.status(429).json({ ok: false, error: "Please wait at least 60 seconds before requesting another code." });
    }

    const payments = readJsonArray(PAYMENTS_FILE);
    const payment = paymentForJobId(payments, row.id);
    const smsTo = toE164Phone(payment?.customer?.phone || req.user?.phone || "");
    if (!isE164Phone(smsTo)) {
      return res.status(400).json({ ok: false, error: "A valid E.164-capable phone number is required for cash/check-on-site verification." });
    }

    if (getPhoneVerifyProvider() === "twilio_verify") {
      const verification = await startPhoneVerification({
        phone: smsTo,
        purpose: "cod_verification",
        userId: req.user?.id || null,
        ip: requestIp(req)
      });
      if (!verification.ok) {
        return res.status(502).json({ ok: false, code: "PHONE_VERIFICATION_UNAVAILABLE", error: PHONE_VERIFICATION_UNAVAILABLE_MESSAGE });
      }
      const updated = await pgdb.query(
        `
        UPDATE jobs
        SET cod_verification_status = 'pending',
            cod_verification_code = NULL,
            cod_verification_sent_at = NOW(),
            cod_verification_provider = 'twilio_verify',
            cod_verification_message_sid = NULL,
            cod_verification_attempts = COALESCE(cod_verification_attempts, 0) + 1
        WHERE id = $1
        RETURNING *
        `,
        [row.id]
      );
      return res.json({
        ok: true,
        resent: true,
        verification_required: true,
        provider: "twilio_verify",
        status: verification.status || "pending",
        jobId: row.id,
        job: sanitizeJobForOwner(mapJobRow(updated.rows[0])),
        message: "Text code sent. Enter the 6-digit code below."
      });
    }

    const code = generateSixDigitCode();
    const smsProvider = getSmsProvider();
    const fallbackStartStartedAt = Date.now();
    logPhoneVerificationEvent("verification_start_requested", {
      provider: smsProvider,
      phone: smsTo,
      purpose: "cod_verification_resend",
      status: "requested",
      ip: requestIp(req),
      userId: req.user?.id || null,
      elapsedMs: 0
    });
    await pgdb.query(
      `
      UPDATE jobs
      SET cod_verification_status = 'pending',
          cod_verification_code = $2,
          cod_verification_sent_at = NOW(),
          cod_verification_provider = $3,
          cod_verification_attempts = COALESCE(cod_verification_attempts, 0) + 1
      WHERE id = $1
      `,
      [row.id, code, smsProvider]
    );

    let smsResponse;
    try {
      smsResponse = await sendSms(smsTo, codVerificationMessage(code), { jobId: row.id, purpose: "cod_verification_resend" });
      if (smsResponse?.skipped) {
        throw new Error("COD verification SMS is disabled.");
      }
    } catch (smsError) {
      await pgdb.query("UPDATE jobs SET cod_verification_status = 'send_failed' WHERE id = $1", [row.id]).catch(() => {});
      console.warn("[COD Verification] Resend failed", {
        jobId: row.id,
        to: maskPhone(smsTo),
        error: smsError.message
      });
      logPhoneVerificationEvent("verification_provider_error", {
        provider: smsProvider,
        phone: smsTo,
        purpose: "cod_verification_resend",
        status: "failed",
        ip: requestIp(req),
        userId: req.user?.id || null,
        elapsedMs: Date.now() - fallbackStartStartedAt
      }, "warn");
      return res.status(502).json({ ok: false, code: "PHONE_VERIFICATION_UNAVAILABLE", error: PHONE_VERIFICATION_UNAVAILABLE_MESSAGE });
    }

    const sid = smsResponse?.messageSid || smsResponse?.sid || smsResponse?.Sid || null;
    const updated = await pgdb.query(
      "UPDATE jobs SET cod_verification_provider = $2, cod_verification_message_sid = $3 WHERE id = $1 RETURNING *",
      [row.id, smsResponse?.provider || smsProvider, sid]
    );
    logPhoneVerificationEvent("verification_start_sent", {
      provider: smsResponse?.provider || smsProvider,
      phone: smsTo,
      purpose: "cod_verification_resend",
      status: "pending",
      ip: requestIp(req),
      userId: req.user?.id || null,
      elapsedMs: Date.now() - fallbackStartStartedAt
    });
    res.json({
      ok: true,
      resent: true,
      verification_required: true,
      jobId: row.id,
      job: sanitizeJobForOwner(mapJobRow(updated.rows[0])),
      message: "A new verification code was sent."
    });
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

// Customer (or admin) creates a Stripe Checkout session for a job
app.post("/api/jobs/:id/create-checkout-session", requireAuth, async (req, res) => {
  try {
    await ensurePaymentColumns();
    await ensureJobsCustomerEmailColumn();
    const jobResult = await pgdb.query("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!jobResult.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });

    const row = jobResult.rows[0];
    const isAdmin = req.user.role === "admin";
    const isOwner = row.customer_user_id && String(row.customer_user_id) === String(req.user.id);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const secretKey = stripeSecretKey();
    if (!secretKey) {
      return res.status(503).json({ ok: false, error: "Payment processing not configured" });
    }
    assertStripeTestMode(secretKey);

    const job = mapJobRow(row);
    const checkoutEmail = normalizeEmailForClaim(req.body?.customerEmail || req.body?.email || row.customer_email || req.user.email || "");
    const checkoutPhone = String(req.body?.customerPhone || req.body?.phone || row.customer_phone || req.user.phone || "").trim();
    const contactConflict = await checkAccountContactConflicts({
      email: checkoutEmail,
      phone: checkoutPhone,
      currentUserId: req.user.id
    });
    if (contactConflict) {
      return sendCheckoutAccountContactConflict(res, contactConflict, {
        email: checkoutEmail,
        phone: checkoutPhone
      });
    }

    const amountCents = Math.round(Number(row.estimate_at_booking || row.budget || 0) * 100);
    if (amountCents < 50) {
      return res.status(400).json({ ok: false, error: "Job has no valid price for checkout" });
    }
    if (!isAdmin) await attachCheckoutJobToUser(job.id, req.user, checkoutEmail);

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(amountCents));
    params.set("line_items[0][price_data][product_data][name]",
      job.title || `${job.serviceType} Service` || "Lawn Service");
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", checkoutReturnUrl("success", { job_id: job.id }));
    params.set("cancel_url", checkoutReturnUrl("cancel", { job_id: job.id }));
    params.set("metadata[job_id]", job.id);
    params.set("metadata[customer_user_id]", String(row.customer_user_id || (!isAdmin ? req.user.id : "")));
    params.set("metadata[customer_email]", checkoutEmail);
    if (checkoutEmail) params.set("customer_email", checkoutEmail);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const stripeSession = await stripeRes.json();
    if (!stripeRes.ok) {
      return res.status(502).json({ ok: false, error: stripeSession.error?.message || "Stripe checkout failed" });
    }

    await pgdb.query(
      "UPDATE jobs SET stripe_checkout_session_id = $1, customer_email = COALESCE(NULLIF(TRIM(customer_email), ''), $3), payment_status = 'checkout_pending', payment_method = COALESCE(payment_method, 'stripe') WHERE id = $2",
      [stripeSession.id, job.id, checkoutEmail]
    );

    res.json({ ok: true, url: stripeSession.url, sessionId: stripeSession.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- ADMIN LEADS (JSON-backed) -------------------- */

const VALID_LEAD_STATUSES = new Set(["new", "quoted", "bidding", "scheduled", "completed", "canceled"]);
const VALID_JOB_STATUSES = new Set(["payment_pending", "payment_failed", "cod_verification_pending", "paid", "open", "assigned", "scheduled", "in_progress", "completed", "canceled", "refunded"]);
const VALID_PAYMENT_STATUSES = new Set(["unpaid", "deposit_paid", "paid", "pending", "checkout_pending", "checkout_created", "onsite_pending", "failed", "refunded"]);
const VALID_USER_ROLES = new Set(["customer", "provider", "admin"]);

function paymentForJobId(payments = [], jobId = "") {
  return payments.find((payment) => String(payment.job_id || "") === String(jobId || "")) || null;
}

function adminJobFromRow(row = {}, payments = []) {
  const payment = paymentForJobId(payments, row.id);
  return {
    ...mapJobRow(row),
    customerUserId: row.customer_user_id || null,
    customerName: row.customer_name || "",
    customerEmail: row.customer_email || payment?.customer?.email || "",
    customerPhone: row.customer_phone || payment?.customer?.phone || "",
    customerAttached: Boolean(row.customer_user_id),
    providerId: row.provider_user_id || null,
    providerUserId: row.provider_user_id || row.provider_user_id_from_profile || null,
    providerName: row.provider_name || row.provider_owner_name || "",
    providerEmail: row.provider_email || "",
    paymentStatus: row.payment_status || payment?.status || "unpaid",
    paymentMethod: row.payment_method || payment?.payment_method || null,
    paymentAmount: payment?.amount || null,
    stripeCheckoutSessionId: row.stripe_checkout_session_id || payment?.stripe_checkout_session_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function loadAdminDbJobs({ status = "", paymentStatus = "", search = "", limit = 250 } = {}) {
  await ensureUsersPhoneColumn();
  await ensurePaymentColumns();
  await ensureCodVerificationColumns();
  await ensureJobPhotoColumns();
  await ensureJobsAdminEditableContactColumns();
  const where = [];
  const params = [];
  if (status && VALID_JOB_STATUSES.has(status)) {
    params.push(status);
    where.push(`j.status = $${params.length}`);
  }
  if (paymentStatus && VALID_PAYMENT_STATUSES.has(paymentStatus)) {
    params.push(paymentStatus);
    where.push(`j.payment_status = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(
      j.id ILIKE $${params.length}
      OR j.address ILIKE $${params.length}
      OR j.customer_name ILIKE $${params.length}
      OR j.customer_email ILIKE $${params.length}
      OR j.customer_phone ILIKE $${params.length}
      OR j.city ILIKE $${params.length}
      OR u.email ILIKE $${params.length}
      OR u.phone ILIKE $${params.length}
      OR u.full_name ILIKE $${params.length}
    )`);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 250, 500)));
  const result = await pgdb.query(
    `
    SELECT
      j.*,
      COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(j.customer_name), '')) AS customer_name,
      COALESCE(NULLIF(TRIM(u.email), ''), NULLIF(TRIM(j.customer_email), '')) AS customer_email,
      COALESCE(NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(j.customer_phone), '')) AS customer_phone,
      pp.id AS provider_id,
      pp.business_name AS provider_name,
      pp.user_id AS provider_user_id_from_profile,
      pu.full_name AS provider_owner_name,
      pu.email AS provider_email
    FROM jobs j
    LEFT JOIN users u ON u.id = j.customer_user_id
    LEFT JOIN provider_profiles pp ON pp.user_id = j.provider_user_id
    LEFT JOIN users pu ON pu.id = pp.user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY j.created_at DESC
    LIMIT $${params.length}
    `,
    params
  );
  const payments = readJsonArray(PAYMENTS_FILE);
  return result.rows.map((row) => adminJobFromRow(row, payments));
}

async function loadAdminDbJobById(jobId) {
  await ensureUsersPhoneColumn();
  await ensurePaymentColumns();
  await ensureCodVerificationColumns();
  await ensureJobPhotoColumns();
  await ensureJobsAdminEditableContactColumns();
  const result = await pgdb.query(
    `
    SELECT
      j.*,
      COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(j.customer_name), '')) AS customer_name,
      COALESCE(NULLIF(TRIM(u.email), ''), NULLIF(TRIM(j.customer_email), '')) AS customer_email,
      COALESCE(NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(j.customer_phone), '')) AS customer_phone,
      pp.id AS provider_id,
      pp.business_name AS provider_name,
      pp.user_id AS provider_user_id_from_profile,
      pu.full_name AS provider_owner_name,
      pu.email AS provider_email
    FROM jobs j
    LEFT JOIN users u ON u.id = j.customer_user_id
    LEFT JOIN provider_profiles pp ON pp.user_id = j.provider_user_id
    LEFT JOIN users pu ON pu.id = pp.user_id
    WHERE j.id = $1
    LIMIT 1
    `,
    [jobId]
  );
  if (!result.rows.length) return null;
  return adminJobFromRow(result.rows[0], readJsonArray(PAYMENTS_FILE));
}

function userNameFields(row = {}) {
  const split = splitFullName(row.full_name || "");
  const firstName = row.first_name || split.firstName || "";
  const lastName = row.last_name || split.lastName || "";
  return {
    firstName,
    lastName,
    fullName: composeFullName(firstName, lastName, row.full_name || "")
  };
}

function normalizeAdminSelectedIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

async function adminPaidCompletedJobBlocks(userIds) {
  const ids = normalizeAdminSelectedIds(userIds);
  if (!ids.length) return new Map();
  await ensurePaymentColumns();
  const result = await pgdb.query(
    `
    SELECT
      selected.user_id AS id,
      COUNT(DISTINCT j.id)::int AS job_count,
      ARRAY_AGG(DISTINCT j.id) AS job_ids
    FROM jobs j
    LEFT JOIN provider_profiles pp
      ON pp.user_id = j.provider_user_id
    JOIN unnest($1::text[]) AS selected(user_id)
      ON j.customer_user_id = selected.user_id
      OR j.provider_user_id = selected.user_id
      OR pp.user_id = selected.user_id
    WHERE COALESCE(j.payment_status, 'unpaid') = 'paid'
       OR j.status IN ('paid', 'completed')
       OR j.paid_at IS NOT NULL
    GROUP BY selected.user_id
    `,
    [ids]
  );
  return new Map(result.rows.map((row) => [String(row.id), {
    id: String(row.id),
    jobCount: Number(row.job_count || 0),
    jobIds: row.job_ids || []
  }]));
}

async function softDeleteAdminUser(userId, adminUser) {
  const result = await pgdb.query(
    `
    UPDATE users
    SET active = false,
        deleted_at = COALESCE(deleted_at, NOW()),
        deleted_by = $2
    WHERE id = $1
      AND deleted_at IS NULL
    RETURNING id, email, full_name, first_name, last_name, role, active, deleted_at, deleted_by
    `,
    [userId, String(adminUser?.id || adminUser?.email || "admin")]
  );

  if (result.rows.length) {
    await pgdb.query("UPDATE provider_profiles SET active = false WHERE user_id = $1", [userId]).catch(() => {});
    await pgdb.query("DELETE FROM sessions WHERE user_id = $1", [userId]).catch(() => {});
  }

  return result.rows[0] || null;
}

function normalizeJobPhotoUrls(value) {
  if (!Array.isArray(value)) return null;
  const urls = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    if (!url.startsWith("/uploads/")) return null;
    urls.push(url);
    seen.add(url);
  }
  return urls;
}

async function updateJobPhotoArrays(jobId, beforePhotoUrls, afterPhotoUrls, providerUserId = null) {
  await ensureJobPhotoColumns();
  const params = [
    jobId,
    JSON.stringify(beforePhotoUrls),
    JSON.stringify(afterPhotoUrls)
  ];
  const providerSql = providerUserId ? " AND provider_user_id = $4" : "";
  if (providerUserId) params.push(providerUserId);
  const result = await pgdb.query(
    `
    UPDATE jobs
    SET
      before_photo_urls = $2::jsonb,
      after_photo_urls = $3::jsonb
    WHERE id = $1${providerSql}
    RETURNING *
    `,
    params
  );
  return result.rows[0] || null;
}

app.get("/api/admin/jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const jobs = await loadAdminDbJobs({
      status: req.query.status || "",
      paymentStatus: req.query.paymentStatus || req.query.payment_status || "",
      search: req.query.search || "",
      limit: req.query.limit || 250
    });
    res.json({ ok: true, jobs, total: jobs.length, legacyLeads: readLeads().length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/jobs/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const jobs = await loadAdminDbJobs({ limit: 500 });
    const job = jobs.find((item) => String(item.id) === String(req.params.id));
    if (job) return res.json({ ok: true, job });

    const leads = readLeads();
    const lead = leads.find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });
    res.json({ ok: true, job: lead });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/jobs/:id/photos", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    const beforePhotoUrls = normalizeJobPhotoUrls(req.body?.beforePhotoUrls);
    const afterPhotoUrls = normalizeJobPhotoUrls(req.body?.afterPhotoUrls);
    if (!beforePhotoUrls || !afterPhotoUrls) {
      return res.status(400).json({ ok: false, error: "beforePhotoUrls and afterPhotoUrls must be arrays of /uploads/ URLs" });
    }
    const job = await updateJobPhotoArrays(req.params.id, beforePhotoUrls, afterPhotoUrls);
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
    const mapped = mapJobRow(job);
    res.json({
      ok: true,
      beforePhotoUrls: mapped.beforePhotoUrls,
      afterPhotoUrls: mapped.afterPhotoUrls,
      job: mapped
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/jobs/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    const { status } = req.body || {};
    const allValid = new Set([...VALID_LEAD_STATUSES, ...VALID_JOB_STATUSES]);
    if (!status || !allValid.has(status)) {
      return res.status(400).json({ ok: false, error: `Invalid status. Allowed: ${[...allValid].join(", ")}` });
    }

    // Try JSON leads first
    const leads = readLeads();
    const idx = leads.findIndex((l) => l.id === req.params.id);
    if (idx !== -1) {
      leads[idx].status = status;
      leads[idx].updatedAt = new Date().toISOString();
      writeLeads(leads);
      return res.json({ ok: true, job: leads[idx] });
    }

    // Try DB jobs
    try {
      const dbResult = await pgdb.query(
        "UPDATE jobs SET status = $2 WHERE id = $1 RETURNING *",
        [req.params.id, status]
      );
      if (dbResult.rows.length) {
        return res.json({ ok: true, job: mapJobRow(dbResult.rows[0]) });
      }
    } catch {}

    res.status(404).json({ ok: false, error: "Job not found" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin: manually override payment status on a DB job
app.patch("/api/admin/jobs/:id/payment", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    await ensurePaymentColumns();
    const { payment_status, payment_method, note } = req.body || {};
    const allowed = VALID_PAYMENT_STATUSES;
    if (!payment_status || !allowed.has(payment_status)) {
      return res.status(400).json({ ok: false, error: `payment_status must be one of: ${[...allowed].join(", ")}` });
    }

    const noteText = String(note || "").trim().slice(0, 500);
    const params = [req.params.id, payment_status];
    let detailsSql = "";
    const methodText = String(payment_method || "").trim().slice(0, 80);
    if (methodText) {
      detailsSql += `, payment_method = $${params.length + 1}`;
      params.push(methodText);
    }
    if (noteText) {
      detailsSql += `, details = CONCAT(COALESCE(details, ''), CASE WHEN COALESCE(details, '') = '' THEN '' ELSE CHR(10) END, $${params.length + 1})`;
      params.push(`Admin payment note: ${noteText}`);
    }
    if (payment_status === "paid") {
      detailsSql += ", paid_at = COALESCE(paid_at, NOW())";
    }

    const result = await pgdb.query(
      `UPDATE jobs SET payment_status = $2${detailsSql} WHERE id = $1 RETURNING *`,
      params
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }
    res.json({ ok: true, job: mapJobRow(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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

    const totalJobs = await pgdb.query(
      "SELECT COUNT(*) FROM jobs"
    );

    const completedJobs = await pgdb.query(
      "SELECT COUNT(*) FROM jobs WHERE status = 'completed'"
    );

    const latestJobs = await pgdb.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 8");

    await ensureUsersPhoneColumn();
    await ensurePaymentColumns();
    const orphanJobs = await pgdb.query("SELECT COUNT(*) FROM jobs WHERE customer_user_id IS NULL");
    const jobsMissingContact = await pgdb.query(`
      SELECT COUNT(*) FROM jobs j
      LEFT JOIN users u ON u.id = j.customer_user_id
      WHERE COALESCE(TRIM(u.email), '') = '' OR COALESCE(TRIM(u.phone), '') = ''
    `);
    const paidJobsNotAttached = await pgdb.query(`
      SELECT COUNT(*) FROM jobs
      WHERE customer_user_id IS NULL
        AND (payment_status = 'paid' OR status = 'paid' OR paid_at IS NOT NULL)
    `);
    const unpaidCompletedJobs = await pgdb.query(`
      SELECT COUNT(*) FROM jobs
      WHERE status = 'completed'
        AND COALESCE(payment_status, 'unpaid') <> 'paid'
    `);

    const byRegion = {};
    for (const row of quotesByRegion.rows) {
      byRegion[row.region_id || "unassigned"] = Number(row.count);
    }

    res.json({
      ok: true,
      metrics: {
        totalQuotes: Number(quoteCount.rows[0].count),
        totalJobs: Number(totalJobs.rows[0].count),
        openJobs: Number(openJobs.rows[0].count),
        completedJobs: Number(completedJobs.rows[0].count),
        providers: Number(providerCount.rows[0].count),
        revenuePipeline: Number(revenueResult.rows[0].total)
      },
      alerts: {
        orphanJobs: Number(orphanJobs.rows[0].count),
        jobsMissingContact: Number(jobsMissingContact.rows[0].count),
        paidJobsNotAttached: Number(paidJobsNotAttached.rows[0].count),
        unpaidCompletedJobs: Number(unpaidCompletedJobs.rows[0].count)
      },
      quoteVolumeByRegion: byRegion,
      latestQuotes: latestQuotes.rows,
      latestJobs: latestJobs.rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/orphans", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await ensureUsersPhoneColumn();
    await ensurePaymentColumns();
    const jobs = await loadAdminDbJobs({ limit: 500 });
    const users = await pgdb.query(`
      SELECT id, email, phone, full_name, first_name, last_name, role, COALESCE(active, true) AS active
      FROM users
      ORDER BY created_at DESC
    `);
    const byEmail = new Map();
    const byPhone = new Map();
    users.rows.forEach((user) => {
      const email = String(user.email || "").toLowerCase().trim();
      const phone = phoneDigits(user.phone || "");
      if (email) byEmail.set(email, user);
      if (phone) byPhone.set(phone, user);
    });
    const orphanJobs = jobs
      .filter((job) => !job.customerUserId)
      .map((job) => {
        const email = String(job.customerEmail || "").toLowerCase().trim();
        const phone = phoneDigits(job.customerPhone || "");
        const matches = [byEmail.get(email), byPhone.get(phone)]
          .filter(Boolean)
          .filter((user, idx, arr) => arr.findIndex((item) => item.id === user.id) === idx)
          .map((user) => ({ ...userNameFields(user), id: user.id, email: user.email, phone: user.phone, role: user.role, active: user.active !== false }));
        return { ...job, suggestedUsers: matches };
      });
    const missingContactJobs = jobs.filter((job) => !String(job.customerEmail || "").trim() || !String(job.customerPhone || "").trim());
    const paidJobsNotAttached = jobs.filter((job) => !job.customerUserId && (job.paymentStatus === "paid" || job.status === "paid" || job.paidAt));
    const unpaidCompletedJobs = jobs.filter((job) => job.status === "completed" && job.paymentStatus !== "paid");
    res.json({
      ok: true,
      alerts: {
        orphanJobs: orphanJobs.length,
        jobsMissingContact: missingContactJobs.length,
        paidJobsNotAttached: paidJobsNotAttached.length,
        unpaidCompletedJobs: unpaidCompletedJobs.length
      },
      orphanJobs,
      missingContactJobs,
      paidJobsNotAttached,
      unpaidCompletedJobs
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/system", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const db = await pgdb.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM jobs) AS jobs,
        (SELECT COUNT(*)::int FROM provider_profiles) AS providers,
        NOW() AS db_time
    `);
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobs = await loadAdminDbJobs({ limit: 500 });
    const jobIds = new Set(jobs.map((job) => String(job.id)));
    const stripeSessionMismatches = payments
      .filter((payment) => payment.job_id && !jobIds.has(String(payment.job_id)))
      .map((payment) => ({
        id: payment.id,
        job_id: payment.job_id,
        stripe_checkout_session_id: payment.stripe_checkout_session_id,
        status: payment.status,
        amount: payment.amount
      }));
    res.json({
      ok: true,
      db: db.rows[0],
      files: {
        payments: payments.length,
        leads: readLeads().length,
        bidRequests: readJsonArray(BID_REQUESTS_FILE).length
      },
      stripeSessionMismatches
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- PAYMENT SESSION LOOKUP -------------------- */

app.get("/api/payments/session/:sessionId", async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const payments = readJsonArray(PAYMENTS_FILE);
    const payment = payments.find((p) => p.stripe_checkout_session_id === sessionId);
    if (!payment) {
      return res.status(404).json({ ok: false, error: "Payment session not found" });
    }
    if (payment.status === "paid" && !payment.account_setup) {
      const accountSetup = await ensurePaidPaymentAccount(payment, {});
      if (accountSetup) {
        payment.account_setup = accountSetup;
        writeJsonArray(PAYMENTS_FILE, payments);
      }
    }
    let jobDetails = null;
    if (payment.job_id) {
      try {
        const jobResult = await pgdb.query("SELECT * FROM jobs WHERE id = $1", [payment.job_id]);
        if (jobResult.rows.length) {
          const j = mapJobRow(jobResult.rows[0]);
          jobDetails = {
            id: j.id,
            status: j.status,
            serviceType: j.serviceType,
            address: j.address,
            city: j.city,
            state: j.state,
            zip: j.zip,
            budget: j.budget,
            preferredDate: j.preferredDate,
            details: j.details,
            gate_size_category: j.gate_size_category,
            mower_access: j.mower_access,
            yard_access_notes: j.yard_access_notes,
            grass_height_range: j.grass_height_range,
            service_frequency: j.service_frequency,
            pets: j.pets,
            obstacles_list: j.obstacles_list,
            available_days_json: j.available_days_json,
          };
        }
      } catch {}
    }
    res.json({
      ok: true,
      session: {
        id: payment.id,
        job_id: payment.job_id,
        stripe_checkout_session_id: payment.stripe_checkout_session_id,
        amount: payment.amount,
        currency: payment.currency || "usd",
        status: payment.status,
        paid_at: payment.paid_at || payment.updated_at,
        customer: {
          name: payment.customer?.name || "",
          email: payment.customer?.email || "",
          phone: payment.customer?.phone || ""
        },
        accountSetup: payment.account_setup
          ? {
              token: payment.account_setup.token || "",
              url: payment.account_setup.url || "",
              email: payment.account_setup.email || payment.customer?.email || "",
              createdUser: Boolean(payment.account_setup.createdUser),
              existingUser: Boolean(payment.account_setup.existingUser),
              expiresAt: payment.account_setup.expiresAt || ""
            }
          : null,
        service: payment.service || null,
        job: jobDetails
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- ADMIN PAID/COMPLETED JOBS -------------------- */

app.get("/api/admin/paid-jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pgdb.query(
      `SELECT * FROM jobs WHERE status IN ('paid','open','assigned','scheduled','in_progress') ORDER BY created_at DESC`
    );
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobs = result.rows.map((row) => {
      const j = mapJobRow(row);
      const payment = payments.find((p) => p.job_id === j.id);
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: j.paymentStatus || payment?.status || null, paidAt: j.paidAt || payment?.paid_at || null };
    });
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/completed-jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pgdb.query(
      `SELECT * FROM jobs WHERE status IN ('completed','canceled','refunded') ORDER BY created_at DESC`
    );
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobs = result.rows.map((row) => {
      const j = mapJobRow(row);
      const payment = payments.find((p) => p.job_id === j.id);
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: j.paymentStatus || payment?.status || null, paidAt: j.paidAt || payment?.paid_at || null };
    });
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ==================== ADMIN MANAGEMENT ==================== */

// Ensure active columns exist on users and provider_profiles (idempotent)
let adminActiveColumnsEnsured = false;
async function ensureAdminActiveColumns() {
  if (adminActiveColumnsEnsured) return;
  try {
    await ensureUsersPhoneColumn();
    await pgdb.query("ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true");
    adminActiveColumnsEnsured = true;
  } catch (err) {
    console.warn("[Admin] Could not ensure active columns:", err.message);
  }
}

// GET /api/admin/db-jobs — all DB jobs for management view
app.get("/api/admin/db-jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const jobs = await loadAdminDbJobs({
      status: req.query.status || "",
      paymentStatus: req.query.paymentStatus || req.query.payment_status || "",
      search: req.query.search || "",
      limit: req.query.limit || 250
    });
    res.json({ ok: true, jobs, total: jobs.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/admin/jobs/:id — admin-safe details/status update
app.patch("/api/admin/jobs/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    const body = req.body || {};
    const allowedFields = new Set([
      "status",
      "payment_status",
      "customerName",
      "customer_name",
      "customerEmail",
      "customer_email",
      "customerPhone",
      "customer_phone",
      "serviceAddress",
      "service_address",
      "address",
      "city",
      "state",
      "zip",
      "notes",
      "details"
    ]);
    const invalidFields = Object.keys(body).filter((key) => !allowedFields.has(key));
    if (invalidFields.length) {
      return res.status(400).json({ ok: false, error: `Invalid field(s): ${invalidFields.join(", ")}` });
    }

    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const hasPaymentStatus = Object.prototype.hasOwnProperty.call(body, "payment_status");
    const hasCustomerName = Object.prototype.hasOwnProperty.call(body, "customerName") || Object.prototype.hasOwnProperty.call(body, "customer_name");
    const hasCustomerEmail = Object.prototype.hasOwnProperty.call(body, "customerEmail") || Object.prototype.hasOwnProperty.call(body, "customer_email");
    const hasCustomerPhone = Object.prototype.hasOwnProperty.call(body, "customerPhone") || Object.prototype.hasOwnProperty.call(body, "customer_phone");
    const hasAddress = Object.prototype.hasOwnProperty.call(body, "address")
      || Object.prototype.hasOwnProperty.call(body, "serviceAddress")
      || Object.prototype.hasOwnProperty.call(body, "service_address");
    const hasCity = Object.prototype.hasOwnProperty.call(body, "city");
    const hasState = Object.prototype.hasOwnProperty.call(body, "state");
    const hasZip = Object.prototype.hasOwnProperty.call(body, "zip");
    const hasDetails = Object.prototype.hasOwnProperty.call(body, "details") || Object.prototype.hasOwnProperty.call(body, "notes");

    if (![
      hasStatus,
      hasPaymentStatus,
      hasCustomerName,
      hasCustomerEmail,
      hasCustomerPhone,
      hasAddress,
      hasCity,
      hasState,
      hasZip,
      hasDetails
    ].some(Boolean)) {
      return res.status(400).json({ ok: false, error: "Provide at least one editable job field" });
    }

    const allValid = new Set([...VALID_LEAD_STATUSES, ...VALID_JOB_STATUSES]);
    const paymentValid = VALID_PAYMENT_STATUSES;
    const status = hasStatus ? String(body.status || "").trim() : "";
    const payment_status = hasPaymentStatus ? String(body.payment_status || "").trim() : "";

    if (hasStatus && (!status || !allValid.has(status))) {
      return res.status(400).json({ ok: false, error: `Invalid status: ${status}` });
    }
    if (hasPaymentStatus && (!payment_status || !paymentValid.has(payment_status))) {
      return res.status(400).json({ ok: false, error: `Invalid payment_status: ${payment_status}` });
    }

    const detailsOnlyForLegacyLead = ![
      hasCustomerName,
      hasCustomerEmail,
      hasCustomerPhone,
      hasAddress,
      hasCity,
      hasState,
      hasZip,
      hasDetails
    ].some(Boolean);
    if (detailsOnlyForLegacyLead) {
      const leads = readLeads();
      const idx = leads.findIndex((l) => l.id === req.params.id);
      if (idx !== -1) {
        if (status) leads[idx].status = status;
        if (payment_status) leads[idx].payment_status = payment_status;
        leads[idx].updatedAt = new Date().toISOString();
        writeLeads(leads);
        return res.json({ ok: true, job: leads[idx] });
      }
    }

    const existing = await pgdb.query("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!existing.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }
    const existingJob = existing.rows[0];

    await ensurePaymentColumns();
    await ensureJobsAdminEditableContactColumns();

    const customerName = hasCustomerName
      ? String(body.customerName ?? body.customer_name ?? "").trim()
      : "";
    const customerEmail = hasCustomerEmail
      ? normalizeAccountEmail(body.customerEmail ?? body.customer_email ?? "")
      : "";
    const rawCustomerPhone = hasCustomerPhone
      ? body.customerPhone ?? body.customer_phone ?? ""
      : "";
    const customerPhone = hasCustomerPhone
      ? normalizeAccountPhone(rawCustomerPhone) || String(rawCustomerPhone || "").trim()
      : "";

    if (hasCustomerEmail || hasCustomerPhone) {
      const conflict = await findAccountContactConflict({
        email: hasCustomerEmail ? customerEmail : "",
        phone: hasCustomerPhone ? customerPhone : "",
        excludeUserId: existingJob.customer_user_id || null
      });
      if (conflict) return sendAdminAccountContactConflict(res, conflict);
    }

    if (existingJob.customer_user_id && (hasCustomerName || hasCustomerEmail || hasCustomerPhone)) {
      const userUpdates = [];
      const userParams = [existingJob.customer_user_id];
      if (hasCustomerName) {
        const splitName = splitFullName(customerName);
        userUpdates.push(`full_name = $${userParams.length + 1}`);
        userParams.push(customerName);
        userUpdates.push(`first_name = $${userParams.length + 1}`);
        userParams.push(splitName.firstName);
        userUpdates.push(`last_name = $${userParams.length + 1}`);
        userParams.push(splitName.lastName);
      }
      if (hasCustomerEmail) {
        userUpdates.push(`email = $${userParams.length + 1}`);
        userParams.push(customerEmail);
      }
      if (hasCustomerPhone) {
        userUpdates.push(`phone = $${userParams.length + 1}`);
        userParams.push(customerPhone);
      }
      await pgdb.query(
        `UPDATE users SET ${userUpdates.join(", ")} WHERE id = $1 AND deleted_at IS NULL`,
        userParams
      );
    }

    const sets = [];
    const params = [req.params.id];
    if (hasStatus && status) { sets.push(`status = $${params.length + 1}`); params.push(status); }
    if (hasPaymentStatus && payment_status) {
      sets.push(`payment_status = $${params.length + 1}`);
      params.push(payment_status);
      if (payment_status === "paid") sets.push("paid_at = COALESCE(paid_at, NOW())");
    }
    if (hasCustomerName) { sets.push(`customer_name = $${params.length + 1}`); params.push(customerName); }
    if (hasCustomerEmail) { sets.push(`customer_email = $${params.length + 1}`); params.push(customerEmail); }
    if (hasCustomerPhone) { sets.push(`customer_phone = $${params.length + 1}`); params.push(customerPhone); }
    if (hasAddress) {
      sets.push(`address = $${params.length + 1}`);
      params.push(String(body.address ?? body.serviceAddress ?? body.service_address ?? "").trim());
    }
    if (hasCity) { sets.push(`city = $${params.length + 1}`); params.push(String(body.city || "").trim()); }
    if (hasState) { sets.push(`state = $${params.length + 1}`); params.push(String(body.state || "").trim().toUpperCase().slice(0, 2)); }
    if (hasZip) { sets.push(`zip = $${params.length + 1}`); params.push(String(body.zip || "").trim()); }
    if (hasDetails) { sets.push(`details = $${params.length + 1}`); params.push(String(body.details ?? body.notes ?? "").trim()); }

    const result = await pgdb.query(
      `UPDATE jobs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }
    const job = await loadAdminDbJobById(req.params.id);
    res.json({ ok: true, job: job || mapJobRow(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ ok: false, field: "email", error: "That email or phone is already used by another account." });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/admin/jobs/:id/assign — assign or unassign a provider by profile id
app.patch("/api/admin/jobs/:id/assign", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { provider_id } = req.body || {};
    if (provider_id) {
      const check = await pgdb.query("SELECT id, user_id FROM provider_profiles WHERE id = $1 LIMIT 1", [provider_id]);
      if (!check.rows.length) return res.status(404).json({ ok: false, error: "Provider not found" });
      const result = await pgdb.query(
        "UPDATE jobs SET provider_user_id = $1, status = 'assigned' WHERE id = $2 RETURNING *",
        [check.rows[0].user_id, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
      return res.json({ ok: true, job: mapJobRow(result.rows[0]) });
    } else {
      const result = await pgdb.query(
        "UPDATE jobs SET provider_user_id = NULL, status = 'pending' WHERE id = $1 RETURNING *",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ ok: false, error: "Job not found" });
      return res.json({ ok: true, job: mapJobRow(result.rows[0]) });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/admin/jobs/:id
app.delete("/api/admin/jobs/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id;

    // Try JSON leads first
    const leads = readLeads();
    const idx = leads.findIndex((l) => l.id === id);
    if (idx !== -1) {
      const [deleted] = leads.splice(idx, 1);
      writeLeads(leads);
      return res.json({ ok: true, deleted: deleted.id });
    }

    // Try DB job
    const result = await pgdb.query("DELETE FROM jobs WHERE id = $1 RETURNING id", [id]);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }
    res.json({ ok: true, deleted: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/jobs/delete-selected — delete only explicitly selected jobs
app.post("/api/admin/jobs/delete-selected", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { ids, confirm } = req.body || {};
    if (confirm !== "DELETE_SELECTED_JOBS") {
      return res.status(400).json({ ok: false, error: 'Send confirm:"DELETE_SELECTED_JOBS" to delete selected jobs' });
    }

    const selectedIds = normalizeAdminSelectedIds(ids);
    if (!selectedIds.length) {
      return res.status(400).json({ ok: false, error: "ids must be a non-empty array" });
    }

    let deletedCount = 0;
    const selected = new Set(selectedIds);
    const leads = readLeads();
    const keptLeads = leads.filter((lead) => {
      if (selected.has(String(lead.id))) {
        deletedCount += 1;
        return false;
      }
      return true;
    });
    if (keptLeads.length !== leads.length) writeLeads(keptLeads);

    const dbResult = await pgdb.query("DELETE FROM jobs WHERE id = ANY($1::text[]) RETURNING id", [selectedIds]);
    deletedCount += dbResult.rows.length;

    res.json({ ok: true, deletedCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/jobs/cleanup — delete test/orphan jobs (requires confirm:"DELETE")
app.post("/api/admin/jobs/cleanup", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { confirm, deleteAll } = req.body || {};
    if (confirm !== "DELETE") {
      return res.status(400).json({ ok: false, error: 'Send { "confirm": "DELETE" } to confirm cleanup' });
    }

    let deletedLeads = 0;
    let deletedDb = 0;

    if (deleteAll) {
      const leads = readLeads();
      deletedLeads = leads.length;
      writeLeads([]);
      const dbResult = await pgdb.query("DELETE FROM jobs RETURNING id");
      deletedDb = dbResult.rows.length;
    } else {
      // Remove only jobs that look like test entries (no real customer name, or "test" in email)
      const leads = readLeads();
      const kept = leads.filter((l) => {
        const name = (l.customerName || "").toLowerCase();
        const email = (l.customerEmail || "").toLowerCase();
        return !(name.includes("test") || email.includes("test") || email.includes("dev") || !l.customerName);
      });
      deletedLeads = leads.length - kept.length;
      writeLeads(kept);

      const dbResult = await pgdb.query(`
        DELETE FROM jobs
        WHERE customer_user_id IS NULL
           OR EXISTS (
             SELECT 1 FROM users u
             WHERE u.id = jobs.customer_user_id
               AND (u.email ILIKE '%test%' OR u.email ILIKE '%dev%')
           )
        RETURNING id
      `);
      deletedDb = dbResult.rows.length;
    }

    res.json({ ok: true, deletedLeads, deletedDb, total: deletedLeads + deletedDb });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ── ADMIN USERS MANAGEMENT ── */

app.get("/api/admin/users", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureAdminActiveColumns();
    const where = [];
    const params = [];
    const role = String(req.query.role || "").trim();
    const active = String(req.query.active || "").trim();
    const search = String(req.query.search || "").trim();
    if (role && VALID_USER_ROLES.has(role)) {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }
    if (active === "true" || active === "false") {
      params.push(active === "true");
      where.push(`COALESCE(u.active, true) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        u.email ILIKE $${params.length}
        OR u.phone ILIKE $${params.length}
        OR u.full_name ILIKE $${params.length}
        OR u.first_name ILIKE $${params.length}
        OR u.last_name ILIKE $${params.length}
      )`);
    }
    const result = await pgdb.query(`
      SELECT
        u.id, u.email, u.full_name, u.first_name, u.last_name, u.phone, u.role, u.created_at,
        u.deleted_at, u.deleted_by,
        COALESCE(u.active, true) AS active,
        COUNT(j.id)::int AS job_count
      FROM users u
      LEFT JOIN jobs j ON j.customer_user_id = u.id
      WHERE u.deleted_at IS NULL
        ${where.length ? `AND ${where.join(" AND ")}` : ""}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 500
    `, params);
    const users = result.rows.map((row) => ({ ...row, ...userNameFields(row), active: row.active !== false }));
    res.json({ ok: true, users, total: users.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureAdminActiveColumns();
    const result = await pgdb.query(
      `
      SELECT
        u.id, u.email, u.full_name, u.first_name, u.last_name, u.phone, u.role, u.created_at,
        u.deleted_at, u.deleted_by,
        COALESCE(u.active, true) AS active,
        COUNT(j.id)::int AS job_count
      FROM users u
      LEFT JOIN jobs j ON j.customer_user_id = u.id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      GROUP BY u.id
      LIMIT 1
      `,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "User not found" });
    const user = { ...result.rows[0], ...userNameFields(result.rows[0]), active: result.rows[0].active !== false };
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  let normalizedEmail = "";
  let normalizedPhone = "";
  try {
    await ensureAdminActiveColumns();
    const body = req.body || {};
    const allowedFields = new Set([
      "name",
      "fullName",
      "full_name",
      "firstName",
      "first_name",
      "lastName",
      "last_name",
      "email",
      "phone",
      "role",
      "active"
    ]);
    const invalidFields = Object.keys(body).filter((key) => !allowedFields.has(key));
    if (invalidFields.length) {
      return res.status(400).json({ ok: false, error: `Invalid field(s): ${invalidFields.join(", ")}` });
    }
    const existing = await pgdb.query("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: "User not found" });

    const explicitName = body.name ?? body.fullName ?? body.full_name;
    const splitName = explicitName == null ? null : splitFullName(explicitName);
    const firstName = body.first_name ?? body.firstName ?? splitName?.firstName ?? existing.rows[0].first_name ?? "";
    const lastName = body.last_name ?? body.lastName ?? splitName?.lastName ?? existing.rows[0].last_name ?? "";
    const fullName = explicitName == null
      ? composeFullName(firstName, lastName, existing.rows[0].full_name)
      : composeFullName(firstName, lastName, explicitName);
    const role = body.role == null ? existing.rows[0].role : String(body.role || "").trim();
    const active = body.active == null ? existing.rows[0].active !== false : Boolean(body.active);
    const rawPhone = body.phone ?? existing.rows[0].phone ?? "";
    normalizedEmail = normalizeAccountEmail(body.email ?? existing.rows[0].email ?? "");
    normalizedPhone = normalizeAccountPhone(rawPhone) || String(rawPhone || "").trim();
    if (!VALID_USER_ROLES.has(role)) return res.status(400).json({ ok: false, error: "Invalid role" });
    if (String(req.user.id) === String(req.params.id) && (role !== "admin" || active === false)) {
      return res.status(400).json({ ok: false, error: "Admins cannot demote or deactivate their own current session user" });
    }
    const conflict = await findAccountContactConflict({
      email: normalizedEmail,
      phone: normalizedPhone,
      excludeUserId: req.params.id
    });
    if (conflict) return sendAdminAccountContactConflict(res, conflict);

    const result = await pgdb.query(
      `
      UPDATE users
      SET
        first_name = $2,
        last_name = $3,
        full_name = $4,
        email = $5,
        phone = $6,
        role = $7,
        active = $8
      WHERE id = $1
      RETURNING id, email, full_name, first_name, last_name, phone, role, active, created_at
      `,
      [
        req.params.id,
        String(firstName || "").trim(),
        String(lastName || "").trim(),
        fullName,
        normalizedEmail,
        normalizedPhone,
        role,
        active
      ]
    );
    await ensureJobsAdminEditableContactColumns();
    await pgdb.query(
      `
      UPDATE jobs
      SET
        customer_name = $2,
        customer_email = $3,
        customer_phone = $4
      WHERE customer_user_id = $1
      `,
      [req.params.id, fullName, normalizedEmail, normalizedPhone]
    ).catch((error) => console.warn("[Admin] Could not sync edited user contact to jobs:", error.message));
    res.json({ ok: true, user: { ...result.rows[0], ...userNameFields(result.rows[0]) } });
  } catch (err) {
    if (err.code === "23505") {
      const conflict = await findAccountContactConflict({
        email: normalizedEmail,
        phone: normalizedPhone,
        excludeUserId: req.params.id
      });
      if (conflict) return sendAdminAccountContactConflict(res, conflict);
      return res.status(409).json({ ok: false, field: "email", error: "That email or phone is already used by another account." });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureAdminActiveColumns();
    const userId = req.params.id;

    if (String(req.user.id) === String(userId)) {
      return res.status(400).json({ ok: false, error: "Admins cannot delete their own current session user" });
    }

    const existing = await pgdb.query(
      "SELECT id, email, full_name, first_name, last_name, role FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [userId]
    );
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: "User not found" });

    const refs = await pgdb.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE j.customer_user_id = $1)::int AS customer_job_count,
        COUNT(*) FILTER (WHERE j.provider_user_id = $1)::int AS provider_user_job_count,
        COUNT(*) FILTER (WHERE pp.user_id IS NOT NULL)::int AS provider_profile_job_count
      FROM jobs j
      LEFT JOIN provider_profiles pp ON pp.user_id = j.provider_user_id AND pp.user_id = $1
      `,
      [userId]
    );
    const relatedJobs = refs.rows[0] || {};

    const blockedJobs = await adminPaidCompletedJobBlocks([userId]);
    const blocked = blockedJobs.get(String(userId));
    if (blocked) {
      return res.status(409).json({
        ok: false,
        error: "User has paid or completed jobs and cannot be deleted.",
        blocked: blocked.jobIds,
        blockedCount: blocked.jobCount
      });
    }

    const result = await softDeleteAdminUser(userId, req.user);

    res.json({
      ok: true,
      mode: "deactivated",
      user: result ? { ...result, ...userNameFields(result) } : null,
      relatedJobs
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/users/delete-selected", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureAdminActiveColumns();
    const { ids, confirm } = req.body || {};
    if (confirm !== "DELETE_SELECTED_USERS") {
      return res.status(400).json({ ok: false, error: 'Send confirm:"DELETE_SELECTED_USERS" to delete selected users' });
    }

    const selectedIds = normalizeAdminSelectedIds(ids);
    if (!selectedIds.length) {
      return res.status(400).json({ ok: false, error: "ids must be a non-empty array" });
    }

    const blocked = [];
    const currentAdminId = String(req.user.id || "");
    const paidCompletedBlocks = await adminPaidCompletedJobBlocks(selectedIds);
    selectedIds.forEach((id) => {
      if (currentAdminId && String(id) === currentAdminId) {
        blocked.push({ id, reason: "current_admin", message: "Admins cannot delete their own current session user." });
      } else if (paidCompletedBlocks.has(String(id))) {
        const item = paidCompletedBlocks.get(String(id));
        blocked.push({
          id,
          reason: "paid_or_completed_jobs",
          message: "User has paid or completed jobs and cannot be deleted.",
          jobCount: item.jobCount,
          jobIds: item.jobIds
        });
      }
    });

    const blockedIds = new Set(blocked.map((item) => String(item.id)));
    const safeIds = selectedIds.filter((id) => !blockedIds.has(String(id)));
    let deletedCount = 0;
    if (safeIds.length) {
      const result = await pgdb.query(
        `
        UPDATE users
        SET active = false,
            deleted_at = COALESCE(deleted_at, NOW()),
            deleted_by = $2
        WHERE id = ANY($1::text[])
          AND deleted_at IS NULL
        RETURNING id
        `,
        [safeIds, String(req.user.id || req.user.email || "admin")]
      );
      deletedCount = result.rows.length;
      await pgdb.query("UPDATE provider_profiles SET active = false WHERE user_id = ANY($1::text[])", [safeIds]).catch(() => {});
      await pgdb.query("DELETE FROM sessions WHERE user_id = ANY($1::text[])", [safeIds]).catch(() => {});
    }

    res.json({
      ok: true,
      deletedCount,
      blockedCount: blocked.length,
      blocked
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/users/:id/jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await pgdb.query("SELECT * FROM jobs WHERE customer_user_id = $1 ORDER BY created_at DESC", [req.params.id]);
    const payments = readJsonArray(PAYMENTS_FILE);
    res.json({ ok: true, jobs: result.rows.map((row) => adminJobFromRow(row, payments)), total: result.rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/users/:id/attach-matching-jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: "confirm:true is required before attaching matching orphan jobs" });
    }
    await ensureUsersPhoneColumn();
    const userResult = await pgdb.query("SELECT id, email, phone FROM users WHERE id = $1 LIMIT 1", [req.params.id]);
    if (!userResult.rows.length) return res.status(404).json({ ok: false, error: "User not found" });
    const user = userResult.rows[0];
    const email = String(user.email || "").toLowerCase().trim();
    const phone = phoneDigits(user.phone || "");
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobIds = payments
      .filter((payment) => {
        const paymentEmail = String(payment.customer?.email || "").toLowerCase().trim();
        const paymentPhone = phoneDigits(payment.customer?.phone || "");
        return payment.job_id && ((email && paymentEmail === email) || (phone && paymentPhone === phone));
      })
      .map((payment) => payment.job_id);
    if (!jobIds.length) return res.json({ ok: true, attached: 0, jobIds: [] });
    const result = await pgdb.query(
      "UPDATE jobs SET customer_user_id = $1 WHERE customer_user_id IS NULL AND id = ANY($2::text[]) RETURNING id",
      [req.params.id, jobIds]
    );
    res.json({ ok: true, attached: result.rows.length, jobIds: result.rows.map((row) => row.id) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ── ADMIN PROVIDERS MANAGEMENT ── */

app.get("/api/admin/providers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureAdminActiveColumns();
    const search = String(req.query.search || "").trim();
    const active = String(req.query.active || "").trim();
    const where = [];
    const params = [];
    if (active === "true" || active === "false") {
      params.push(active === "true");
      where.push(`COALESCE(pp.active, true) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        pp.business_name ILIKE $${params.length}
        OR pp.phone ILIKE $${params.length}
        OR u.email ILIKE $${params.length}
        OR u.phone ILIKE $${params.length}
        OR u.full_name ILIKE $${params.length}
      )`);
    }
    const result = await pgdb.query(`
      SELECT
        pp.id, pp.user_id, pp.business_name, pp.phone,
        u.email, u.phone AS user_phone, u.full_name AS owner_name, u.first_name, u.last_name,
        COALESCE(pp.active, true) AS active,
        pp.created_at,
        COUNT(j.id)::int AS job_count,
        COUNT(j.id) FILTER (WHERE j.status IN ('assigned','scheduled','in_progress','paid','open'))::int AS open_job_count,
        COUNT(j.id) FILTER (WHERE j.status = 'completed')::int AS completed_job_count
      FROM provider_profiles pp
      JOIN users u ON u.id = pp.user_id
      LEFT JOIN jobs j ON j.provider_user_id = pp.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY pp.id, u.email, u.phone, u.full_name, u.first_name, u.last_name
      ORDER BY pp.created_at DESC
      LIMIT 500
    `, params);
    const providers = result.rows.map((row) => ({ ...row, ...userNameFields(row), phone: row.phone || row.user_phone || "" }));
    res.json({ ok: true, providers, total: providers.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/providers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureAdminActiveColumns();
    const { active } = req.body || {};
    if (active === undefined) {
      return res.status(400).json({ ok: false, error: 'Provide { "active": true } or { "active": false }' });
    }

    const result = await pgdb.query(
      "UPDATE provider_profiles SET active = $2 WHERE id = $1 RETURNING id, business_name, active",
      [req.params.id, Boolean(active)]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Provider not found" });
    }
    res.json({ ok: true, provider: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/providers/:id/jobs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const provider = await pgdb.query("SELECT id, user_id FROM provider_profiles WHERE id = $1 OR user_id = $1 LIMIT 1", [req.params.id]);
    if (!provider.rows.length) return res.status(404).json({ ok: false, error: "Provider not found" });
    const result = await pgdb.query(
      "SELECT * FROM jobs WHERE provider_user_id = $1 ORDER BY created_at DESC",
      [provider.rows[0].user_id]
    );
    const payments = readJsonArray(PAYMENTS_FILE);
    res.json({ ok: true, jobs: result.rows.map((row) => adminJobFromRow(row, payments)), total: result.rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ==================== END ADMIN MANAGEMENT ==================== */

/* -------------------- CUSTOMER BOOKINGS / RECEIPTS -------------------- */

app.get("/api/customer/bookings", requireAuth, async (req, res) => {
  try {
    const result = await pgdb.query(
      "SELECT * FROM jobs WHERE customer_user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobs = result.rows.map((row) => {
      const j = mapJobRow(row);
      const payment = payments.find((p) => p.job_id === j.id);
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: j.paymentStatus || payment?.status || null, paidAt: j.paidAt || payment?.paid_at || null };
    });
    res.json({ ok: true, jobs: jobs.map(sanitizeJobForOwner) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/customer/receipts", requireAuth, async (req, res) => {
  try {
    const dbResult = await pgdb.query(
      "SELECT id FROM jobs WHERE customer_user_id = $1",
      [req.user.id]
    );
    const myJobIds = new Set(dbResult.rows.map((r) => r.id));
    const allPayments = readJsonArray(PAYMENTS_FILE);
    const receipts = allPayments.filter((p) => {
      if (p.job_id && myJobIds.has(p.job_id)) return true;
      const email = req.user.email || "";
      if (email && p.customer?.email && p.customer.email.toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    res.json({ ok: true, receipts });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- PROVIDER PAID JOBS -------------------- */

const PROVIDER_ACTIVE_JOB_STATUSES = ["assigned", "claimed", "scheduled", "in_progress"];
const PROVIDER_UPCOMING_JOB_STATUSES = ["assigned", "scheduled"];
const PROVIDER_COMPLETED_JOB_STATUSES = ["completed"];
const PROVIDER_CANCELED_JOB_STATUSES = ["canceled", "cancelled", "refunded"];

function providerJobStatusFilter(filter) {
  const value = String(filter || "active").toLowerCase();
  if (value === "upcoming") return PROVIDER_UPCOMING_JOB_STATUSES;
  if (value === "completed") return PROVIDER_COMPLETED_JOB_STATUSES;
  if (value === "canceled" || value === "cancelled") return PROVIDER_CANCELED_JOB_STATUSES;
  if (value === "all" || value === "history") return null;
  return PROVIDER_ACTIVE_JOB_STATUSES;
}

async function providerJobsQuery(req, filter = "active") {
  await ensureJobsScopeSnapshotColumn();
  await ensureJobPhotoColumns();
  await ensureUsersPhoneColumn();
  const statuses = providerJobStatusFilter(filter);
  const params = [];
  const where = [];

  if (req.user.role !== "admin") {
    params.push(req.user.id);
    where.push(`j.provider_user_id = $${params.length}`);
  }

  if (statuses) {
    params.push(statuses);
    where.push(`j.status = ANY($${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await pgdb.query(
    `
    SELECT
      j.*,
      u.full_name AS customer_full_name,
      u.email AS customer_email,
      u.phone AS customer_phone
    FROM jobs j
    LEFT JOIN users u ON u.id = j.customer_user_id
    ${whereSql}
    ORDER BY
      CASE WHEN j.preferred_date IS NULL THEN 1 ELSE 0 END,
      j.preferred_date ASC,
      j.created_at DESC
    `,
    params
  );
  return result.rows.map(mapJobRow);
}

app.get("/api/provider/overview", requireAuth, providerAccessMiddleware, async (req, res) => {
  try {
    const jobs = await providerJobsQuery(req, "all");
    const active = jobs.filter((job) => PROVIDER_ACTIVE_JOB_STATUSES.includes(job.status));
    const upcoming = jobs.filter((job) => PROVIDER_UPCOMING_JOB_STATUSES.includes(job.status));
    const completed = jobs.filter((job) => PROVIDER_COMPLETED_JOB_STATUSES.includes(job.status));
    const canceled = jobs.filter((job) => PROVIDER_CANCELED_JOB_STATUSES.includes(job.status));
    const pipeline = active.reduce((sum, job) => sum + Number(job.budget || 0), 0);
    res.json({
      ok: true,
      metrics: {
        openAssignedJobs: active.length,
        upcomingJobs: upcoming.length,
        completedJobs: completed.length,
        canceledJobs: canceled.length,
        estimatedRevenuePipeline: pipeline
      },
      recentJobs: jobs.slice(0, 6).map(sanitizeJobForProvider)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/provider/jobs", requireAuth, providerAccessMiddleware, async (req, res) => {
  try {
    const jobs = await providerJobsQuery(req, req.query.filter || "active");
    res.json({ ok: true, jobs: jobs.map(sanitizeJobForProvider) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/provider/paid-jobs", requireAuth, providerAccessMiddleware, async (req, res) => {
  try {
    const result = req.user.role === "admin"
      ? await pgdb.query(
        `SELECT * FROM jobs WHERE status IN ('paid','open') ORDER BY created_at DESC`
      )
      : await pgdb.query(
        `SELECT * FROM jobs WHERE status IN ('paid','open') AND (provider_user_id IS NULL OR provider_user_id = $1) ORDER BY created_at DESC`,
        [req.user.id]
      );
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobs = result.rows.map((row) => {
      const j = mapJobRow(row);
      const payment = payments.find((p) => p.job_id === j.id);
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: j.paymentStatus || payment?.status || null, paidAt: j.paidAt || payment?.paid_at || null };
    });
    res.json({ ok: true, jobs: jobs.map(sanitizeJobForProvider) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/provider/jobs/:id/photos", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    const beforePhotoUrls = normalizeJobPhotoUrls(req.body?.beforePhotoUrls);
    const afterPhotoUrls = normalizeJobPhotoUrls(req.body?.afterPhotoUrls);
    if (!beforePhotoUrls || !afterPhotoUrls) {
      return res.status(400).json({ ok: false, error: "beforePhotoUrls and afterPhotoUrls must be arrays of /uploads/ URLs" });
    }
    const job = await updateJobPhotoArrays(req.params.id, beforePhotoUrls, afterPhotoUrls, req.user.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found or not assigned to you" });
    }
    const mapped = sanitizeJobForProvider(mapJobRow(job));
    res.json({
      ok: true,
      beforePhotoUrls: mapped.beforePhotoUrls,
      afterPhotoUrls: mapped.afterPhotoUrls,
      job: mapped
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/provider/jobs/:id/payment", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    await ensurePaymentColumns();
    const { payment_status } = req.body || {};
    if (payment_status !== "paid") {
      return res.status(400).json({ ok: false, error: "Providers can only mark onsite payment as paid." });
    }
    const result = await pgdb.query(
      `
      UPDATE jobs
      SET payment_status = 'paid',
          paid_at = COALESCE(paid_at, NOW())
      WHERE id = $1
        AND provider_user_id = $2
        AND COALESCE(payment_status, 'unpaid') = 'onsite_pending'
      RETURNING *
      `,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Onsite job not found or not assigned to you" });
    }
    res.json({ ok: true, job: sanitizeJobForProvider(mapJobRow(result.rows[0])) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/provider/jobs/:id/status", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    if (hasScopeSnapshotMutation(req.body)) return rejectScopeSnapshotMutation(res);
    const { status, reason } = req.body || {};
    const normalizedStatus = status === "cancelled" ? "canceled" : status;
    const allowed = new Set(["assigned", "scheduled", "in_progress", "completed", "canceled", "issue_reported"]);
    if (!normalizedStatus || !allowed.has(normalizedStatus)) {
      return res.status(400).json({ ok: false, error: `Providers can set: ${[...allowed].join(", ")}` });
    }
    const reasonText = String(reason || "").trim();
    const detailsSql = reasonText
      ? ", details = CONCAT(COALESCE(details, ''), CASE WHEN COALESCE(details, '') = '' THEN '' ELSE CHR(10) END, $4)"
      : "";
    const params = reasonText
      ? [req.params.id, normalizedStatus, req.user.id, `Provider note: ${reasonText.slice(0, 500)}`]
      : [req.params.id, normalizedStatus, req.user.id];
    const result = await pgdb.query(
      `UPDATE jobs SET status = $2${detailsSql} WHERE id = $1 AND provider_user_id = $3 RETURNING *`,
      params
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found or not assigned to you" });
    }
    res.json({ ok: true, job: sanitizeJobForProvider(mapJobRow(result.rows[0])) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- PARTIAL COMPOSITION -------------------- */

const PARTIALS_DIR = path.join(__dirname, "..", "public", "partials");
const INDEX_HTML_PATH = path.join(__dirname, "..", "public", "index.html");

const partialCache = new Map();

function loadPartial(name) {
  if (partialCache.has(name)) return partialCache.get(name);
  const filePath = path.join(PARTIALS_DIR, `${name}.html`);
  const content = readFileSync(filePath, "utf8");
  partialCache.set(name, content);
  return content;
}

function composeHtml() {
  let html = readFileSync(INDEX_HTML_PATH, "utf8");
  html = html.replace(/<!--\s*PARTIAL:(\S+?)\s*-->/g, (_match, name) => {
    try {
      return loadPartial(name);
    } catch {
      console.warn(`[Partials] Could not load partial: ${name}`);
      return "";
    }
  });
  return html;
}

/* -------------------- SPA FALLBACK -------------------- */

app.get("*", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(composeHtml());
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on http://0.0.0.0:${PORT}`);
  ensurePricingSchema().catch((err) => console.warn('[Startup] pricing schema ensure failed:', err.message));
  ensureJobsScopeSnapshotColumn().catch((err) => console.warn('[Startup] scope_snapshot column ensure failed:', err.message));
  ensureJobPhotoColumns().catch((err) => console.warn('[Startup] job photo columns ensure failed:', err.message));
  ensurePaymentColumns().catch((err) => console.warn('[Startup] payment columns ensure failed:', err.message));
  ensureCodVerificationColumns().catch((err) => console.warn('[Startup] COD verification columns ensure failed:', err.message));
  ensureAdminActiveColumns().catch((err) => console.warn('[Startup] admin active columns ensure failed:', err.message));
  ensureUniqueAccountContactIndexes().catch((err) => console.warn('[Startup] account contact unique index ensure failed:', err.message));
});
