import dotenv from "dotenv";
import express from "express";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import { nanoid } from "nanoid";
import fetch from "node-fetch";
import uploadRoutes from "../routes/upload.js";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "fs";

// Load deployment config from the project root even when PM2 starts from another cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

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
  "https://mownwa.com/api/auth/facebook/callback";
const EXPECTED_FACEBOOK_CALLBACK_URL = "https://mownwa.com/api/auth/facebook/callback";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://mownwa.com").replace(/\/+$/, "");
const FACEBOOK_DATA_DELETION_BASE_URL = "https://mownwa.com";
const SESSION_COOKIE_NAME = "turflynk_session";
const OAUTH_STATE_COOKIE_NAME = "turflynk_oauth_state";

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

let localSettings = { services: [], regions: [] };
try {
  localSettings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
} catch {
  console.warn("Could not load data/settings.json — using empty defaults");
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
  return String(value ?? "")
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
      profileFields: ["id", "name", "email", "picture.type(large)"],
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
        callbackURL: FACEBOOK_CALLBACK_URL,
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
  limit: "10mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
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

function mowableFallback(mode = "placeholder") {
  return {
    ok: true,
    featureCollection: emptyFeatureCollection(),
    areaSqft: 0,
    mode
  };
}

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

function normalizeMowableResponse(payload = {}) {
  if (payload.ok !== true) return null;

  if (isFeatureCollection(payload.featureCollection)) {
    return {
      ok: true,
      featureCollection: payload.featureCollection,
      areaSqft: Number(payload.areaSqft || payload.mowableAreaSqFt || 0),
      mode: payload.mode || payload.diagnostics?.mode || "ai"
    };
  }

  if (Array.isArray(payload.polygons)) {
    return {
      ok: true,
      featureCollection: {
        type: "FeatureCollection",
        features: payload.polygons
          .filter((geometry) => geometry && typeof geometry === "object")
          .map((geometry) => ({
            type: "Feature",
            properties: { source: "vision_service" },
            geometry
          }))
      },
      areaSqft: Number(payload.areaSqft || payload.mowableAreaSqFt || 0),
      mode: payload.mode || payload.diagnostics?.mode || "ai"
    };
  }

  return null;
}

app.post("/api/ai/detect-mowable", async (req, res) => {
  const body = req.body || {};
  const visionServiceUrl = (process.env.VISION_SERVICE_URL || "").replace(/\/+$/, "");

  if (!visionServiceUrl) {
    return res.json(mowableFallback("placeholder"));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(`${visionServiceUrl}/detect-mowable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parcelGeoJson: body.parcelGeoJson,
        center: body.center,
        zoom: body.zoom,
        source: body.source
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      return res.json(mowableFallback("ai-unavailable"));
    }

    const payload = await upstream.json().catch(() => null);
    const normalized = normalizeMowableResponse(payload);

    if (!normalized) {
      return res.json(mowableFallback("ai-unavailable"));
    }

    return res.json(normalized);
  } catch (err) {
    console.warn("AI mowable detection unavailable:", err.message);
    return res.json(mowableFallback("ai-unavailable"));
  } finally {
    clearTimeout(timeout);
  }
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
    phone: user.phone || "",
    role: user.role,
    avatarUrl: user.avatar_url || user.avatarUrl || "",
    createdAt: user.created_at || user.createdAt || null
  };
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

let usersPhoneColumnEnsured = false;
async function ensureUsersPhoneColumn() {
  if (usersPhoneColumnEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT");
    usersPhoneColumnEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure users.phone column:", error.message);
    return false;
  }
}

let jobsScopeSnapshotColumnEnsured = false;
async function ensureJobsScopeSnapshotColumn() {
  if (jobsScopeSnapshotColumnEnsured) return true;
  try {
    await pgdb.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scope_snapshot JSONB");
    jobsScopeSnapshotColumnEnsured = true;
    return true;
  } catch (error) {
    console.warn("Could not ensure jobs.scope_snapshot column:", error.message);
    return false;
  }
}

async function updateUserPhoneIfBlank(userId, phone) {
  const trimmed = String(phone || "").trim();
  if (!userId || !trimmed || !isValidLookingPhone(trimmed)) return false;
  if (!(await ensureUsersPhoneColumn())) return false;
  try {
    const result = await pgdb.query(
      `
      UPDATE users
      SET phone = $2
      WHERE id = $1
        AND COALESCE(TRIM(phone), '') = ''
      RETURNING phone
      `,
      [userId, trimmed]
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
  const normalized = String(email || "").toLowerCase().trim();
  if (!normalized) return null;
  const result = await pgdb.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [normalized]);
  return result.rows[0] || null;
}

async function findOrCreateCustomerUser({ email, fullName } = {}) {
  const normalized = String(email || "").toLowerCase().trim();
  if (!normalized) return { user: null, created: false };

  const existing = await findUserByEmail(normalized);
  if (existing) return { user: existing, created: false };

  try {
    const result = await pgdb.query(
      `
      INSERT INTO users (id, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'customer')
      RETURNING *
      `,
      [nanoid(10), normalized, hashPassword(nanoid(40)), fullName || ""]
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

function safeQuoteReturnPath(returnTo = "") {
  const fallback = "/?auth=success&view=quote";
  const raw = String(returnTo || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, APP_BASE_URL);
    if (parsed.origin !== new URL(APP_BASE_URL).origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

function appRedirectUrl(returnTo = "") {
  return new URL(safeQuoteReturnPath(returnTo), APP_BASE_URL).toString();
}

function authErrorRedirect(provider, reason = "auth_failed") {
  const url = new URL("/?auth=error&view=quote", APP_BASE_URL);
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
  return ["manual", "request", "estimate", "start"].includes(step) ? step : "request";
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
  expectedPassportCallbackURL: EXPECTED_FACEBOOK_CALLBACK_URL,
  passportCallbackMatchesExpected: FACEBOOK_CALLBACK_URL === EXPECTED_FACEBOOK_CALLBACK_URL,
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

    const userResult = await client.query(
      `
      INSERT INTO users (id, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'customer')
      ON CONFLICT (email) DO UPDATE SET
        full_name = CASE
          WHEN COALESCE(users.full_name, '') = '' THEN EXCLUDED.full_name
          ELSE users.full_name
        END
      RETURNING *
      `,
      [nanoid(10), normalizedEmail, hashPassword(nanoid(40)), fullName || ""]
    );

    const user = userResult.rows[0];
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

    const dbServices = servicesResult.rows.map((s) => ({
      id: s.id,
      name: s.name || "",
      label: s.name || "",
      baseFee: Number(s.base_fee || 0),
      ratePer1000Sqft: Number(s.rate_per_1000_sqft || 0),
      minimumPrice: Number(s.minimum_price || 0),
      active: Boolean(s.active),
      sortOrder: Number(s.sort_order || 0)
    }));

    const dbRegions = regionsResult.rows.map((r) => ({
      id: r.id,
      name: r.name || "",
      label: r.name || "",
      state: r.state || DEFAULT_STATE,
      marketMultiplier: Number(r.market_multiplier || 1),
      travelFee: Number(r.travel_fee || 0),
      minimumJob: Number(r.minimum_job || 0),
      active: Boolean(r.active),
      sortOrder: Number(r.sort_order || 0)
    }));

    return {
      appName: row.app_name || APP_NAME,
      defaultState: row.default_state || DEFAULT_STATE,
      parcelMode: row.parcel_mode || "arkansas-live-plus-manual-fallback",
      mapsMode: row.maps_mode || "google-address + arkansas-gis-parcel + manual-adjust",
      minimumCutPrice: Number(row.minimum_cut_price || 38),
      complexityRules: row.complexity_rules || defaultSettings.complexityRules,
      services: dbServices.length ? dbServices : (localSettings.services || []),
      regions: dbRegions.length ? dbRegions : (localSettings.regions || [])
    };
  } catch (err) {
    console.warn("DB unavailable, using local settings.json fallback:", err.message);
    return {
      ...defaultSettings,
      services: localSettings.services || [],
      regions: localSettings.regions || []
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

function estimateQuote(payload, settings) {
  const service = findService(settings, payload.serviceType) || settings.services[0];
  const region = findRegion(settings, payload.regionId);
  const rules = settings.complexityRules || {};
  const mowAreaSqft = Number(payload.mowAreaSqft || 0);
  console.log('[TurfLynk Area Trace] F. estimateQuote | mowAreaSqft=' + mowAreaSqft + ' lotAreaSqft=' + Number(payload.lotAreaSqft || 0) + ' serviceType=' + (payload.serviceType || '') + ' regionId=' + (payload.regionId || '') + ' source=payload');
  if (mowAreaSqft <= 0) return 0;

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
    const _body = req.body || {};
    console.log('[TurfLynk Area Trace] F. /api/estimate received | mowAreaSqft=' + Number(_body.mowAreaSqft || 0) + ' lotAreaSqft=' + Number(_body.lotAreaSqft || 0) + ' serviceType=' + (_body.serviceType || '') + ' source=request.body');
    const settings = await loadSettingsFromDb();
    const estimate = estimateQuote(_body, settings);
    console.log('[TurfLynk Area Trace] F. /api/estimate result | estimate=' + estimate + ' mowAreaSqft=' + Number(_body.mowAreaSqft || 0));
    res.json({ ok: true, estimate });
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

function normalizeInstantCheckoutPayload(payload = {}, calculatedEstimate = 0) {
  const name = payload.name || payload.customerName || "";
  const phone = submittedPhone(payload);
  const email = payload.email || payload.customerEmail || "";
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

    const settings = await loadSettingsFromDb();
    const calculatedEstimate = estimateQuote(jobPayload, settings);
    const amount = Math.round(Number(calculatedEstimate || 0) * 100);
    if (amount <= 0) {
      return res.status(400).json({ ok: false, error: "Checkout amount is required" });
    }
    const checkoutJobPayload = normalizeInstantCheckoutPayload(jobPayload, calculatedEstimate);

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
      const job = await insertJobForUser(req.user?.id || null, checkoutJobPayload, "open");
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
      await updateUserPhoneIfBlank(req.user?.id, checkoutJobPayload.phone);
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

    const job = await insertJobForUser(req.user?.id || null, checkoutJobPayload, "payment_pending");
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
    params.set("success_url", checkoutReturnUrl("success", { session_id: "{CHECKOUT_SESSION_ID}" }));
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
    await updateUserPhoneIfBlank(req.user?.id, checkoutJobPayload.phone);

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

app.post("/api/payments/create-checkout-session", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const paymentPhone = submittedPhone(body) || req.user?.phone || "";
    if (!isValidLookingPhone(paymentPhone)) return rejectMissingPhone(res);
    const amount = Math.round(Number(body.amount || body.final_price || body.estimate || 0) * 100);
    if (amount <= 0) return res.status(400).json({ ok: false, error: "Checkout amount is required" });

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
          email: body.email || body.customerEmail || req.user.email || "",
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
    params.set("success_url", checkoutReturnUrl("success", { session_id: "{CHECKOUT_SESSION_ID}" }));
    params.set("cancel_url", checkoutReturnUrl("cancel"));
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(amount));
    params.set("line_items[0][price_data][product_data][name]", body.description || "TurfLynk service payment");
    params.set("metadata[job_id]", body.job_id || "");
    params.set("metadata[bid_request_id]", body.bid_request_id || "");
    params.set("metadata[customer_phone]", paymentPhone);

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
        email: body.email || body.customerEmail || req.user.email || "",
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
  const { user, created } = await findOrCreateCustomerUser({ email, fullName });
  if (!user) return null;
  await updateUserPhoneIfBlank(user.id, customer.phone || metadata.customer_phone || session.customer_details?.phone || "");

  if (payment.job_id) {
    await pgdb.query(
      "UPDATE jobs SET customer_user_id = COALESCE(customer_user_id, $2) WHERE id = $1",
      [payment.job_id, user.id]
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
    await pgdb.query(
      `
      UPDATE jobs
      SET
        status = 'open',
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
      [payment.job_id, session.id || ""]
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
    await linkPasswordProvider(result.rows[0]);

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

    await linkPasswordProvider(user);
    const token = await createSessionForUser(user.id);
    setSessionCookie(req, res, token);
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

    writeJsonArray(
      ACCOUNT_SETUP_TOKENS_FILE,
      rows.filter((item) => item.token !== token)
    );

    await linkPasswordProvider(user);
    const sessionToken = await createSessionForUser(user.id);
    setSessionCookie(req, res, sessionToken);

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
  if (req.session) {
    req.session.facebookLoginSource = source;
    req.session.facebookLoginStep = step;
  }
  console.info(`[Facebook Login] source=${source} route=/api/auth/facebook`);
  console.info("[Facebook OAuth][Passport] start", {
    source,
    step,
    appIdLoaded: Boolean(FACEBOOK_APP_ID),
    appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
    callbackURL: FACEBOOK_CALLBACK_URL,
    callbackMatchesExpected: FACEBOOK_CALLBACK_URL === EXPECTED_FACEBOOK_CALLBACK_URL
  });
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.warn("[Facebook OAuth][Passport] start failed: provider_unconfigured", {
      source,
      step,
      appIdLoaded: Boolean(FACEBOOK_APP_ID),
      appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
      callbackURL: FACEBOOK_CALLBACK_URL
    });
    return res.redirect("/auth-failed.html");
  }
  return passport.authenticate("facebook", { scope: ["email"] })(req, res, next);
});

app.get("/api/auth/facebook/callback", (req, res, next) => {
  const source = safeFacebookLoginSource(req.session?.facebookLoginSource);
  const step = safeFacebookLoginStep(req.session?.facebookLoginStep);
  console.info("[Facebook OAuth][Passport] callback received", {
    source,
    step,
    callbackURL: FACEBOOK_CALLBACK_URL,
    callbackMatchesExpected: FACEBOOK_CALLBACK_URL === EXPECTED_FACEBOOK_CALLBACK_URL,
    query: safeOAuthQuery(req.query)
  });
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.warn("[Facebook OAuth][Passport] callback failed: provider_unconfigured", {
      source,
      step,
      appIdLoaded: Boolean(FACEBOOK_APP_ID),
      appSecretLoaded: Boolean(FACEBOOK_APP_SECRET),
      callbackURL: FACEBOOK_CALLBACK_URL,
      query: safeOAuthQuery(req.query)
    });
    return res.redirect("/auth-failed.html");
  }

  return passport.authenticate("facebook", { session: true }, (error, user, info) => {
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
        callbackURL: FACEBOOK_CALLBACK_URL
      });
      return res.redirect("/auth-failed.html");
    }

    return req.logIn(user, (loginError) => {
      if (loginError) {
        console.warn("[Facebook OAuth][Passport] session login failed", {
          errorMessage: loginError.message,
          userPresent: Boolean(user),
          emailPresent: Boolean(user.email),
          verifyCallbackRan: Boolean(req.facebookVerifyCallbackRan),
          profilePresent: Boolean(req.facebookProfilePresent),
          source,
          step,
          callbackURL: FACEBOOK_CALLBACK_URL
        });
        return res.redirect("/auth-failed.html");
      }

      console.info("[Facebook OAuth][Passport] callback succeeded", {
        userPresent: true,
        emailPresent: Boolean(user.email),
        verifyCallbackRan: Boolean(req.facebookVerifyCallbackRan),
        profilePresent: Boolean(req.facebookProfilePresent),
        provider: user.provider || "facebook",
        source,
        step,
        callbackURL: FACEBOOK_CALLBACK_URL
      });
      const returnStep = source === "checkout" ? step : "request";
      delete req.session.facebookLoginSource;
      delete req.session.facebookLoginStep;
      return res.redirect(appRedirectUrl(`/?auth=success&view=quote&step=${encodeURIComponent(returnStep)}`));
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

app.get("/api/provider/profile", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    res.json({ ok: true, profile: { user: sanitizeUser(req.user), ...area } });
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

app.get("/api/provider/service-areas", requireAuth, requireRole("provider"), (req, res) => {
  try {
    const area = currentProviderArea(req.user.id);
    res.json({ ok: true, ...area });
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
    scopeSnapshot: parseJsonObject(row.scope_snapshot),
    status: row.status || "open",
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
    postedAt: row.created_at
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
    scopeSnapshot: parseJsonObject(job.scopeSnapshot || job.scope_snapshot)
  };
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

function buildJobScopeSnapshot(body = {}) {
  const serviceFields = servicePayloadFields(body);
  const finalAmount = Number(body.final_price || body.finalPrice || body.paidAmount || body.paymentAmount || body.budget || body.estimate || 0);
  const tipAmount = Number(body.tipAmount || body.tip_amount || body.gratuity || 0);
  const snapshot = {
    parcelGeoJSON: geoJsonField(body, "parcelGeoJSON", "parcelGeoJson", "parcel_geojson"),
    selectedMowableGeoJSON: geoJsonField(body, "selectedMowableGeoJSON", "selectedMowableGeoJson", "mowableGeoJSON", "mowableGeoJson", "mowable_geojson"),
    excludedGeoJSON: geoJsonField(body, "excludedGeoJSON", "excludedGeoJson", "cutoutGeoJSON", "cutoutGeoJson", "cutout_geojson"),
    mowableAreaSqFt: Number(body.mowAreaSqft || body.mowableAreaSqFt || body.mowable_area_sqft || body.areaSqft || 0),
    lotAreaSqFt: Number(body.lotAreaSqft || body.lotAreaSqFt || body.lot_area_sqft || body.parcelAreaSqft || 0),
    serviceType: body.serviceType || body.service_type || "mowing",
    finalAmount,
    paidAmount: Number(body.paidAmount || body.paymentAmount || 0) || finalAmount,
    tipAmount,
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
    customerNotes: serviceFields.customer_notes,
    map: {
      center: body.mapCenter || body.map_center || null,
      bounds: body.mapBounds || body.map_bounds || null
    },
    createdAt: new Date().toISOString()
  };

  return Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== null && value !== undefined));
}

async function insertJobForUser(userId, body = {}, status = "open") {
  await ensureJobsScopeSnapshotColumn();
  const scopeSnapshot = buildJobScopeSnapshot(body);
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
      scope_snapshot,
      status
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
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
      status
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
    const phone = submittedPhone(body);
    if (!isValidLookingPhone(phone)) return rejectMissingPhone(res);
    body.phone = phone;
    body.customerPhone = phone;
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
    if (!providerUserId) return res.status(400).json({ ok: false, error: "provider_user_id is required" });
    const result = await pgdb.query(
      "UPDATE jobs SET provider_user_id = $1, status = 'assigned' WHERE id = $2 RETURNING *",
      [providerUserId, req.params.id]
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

app.post("/api/quotes", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const phone = submittedPhone(body);
    if (!isValidLookingPhone(phone)) return rejectMissingPhone(res);
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
      ...serviceFields,
      estimated_price_low: serviceFields.estimated_price_low,
      estimated_price_high: serviceFields.estimated_price_high,
      final_price: estimate,
      estimate,
      status
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
        req.user?.id || null
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
    await ensureJobsScopeSnapshotColumn();
    const result = await pgdb.query(
      "SELECT * FROM jobs WHERE customer_user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
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

/* -------------------- ADMIN LEADS (JSON-backed) -------------------- */

const VALID_LEAD_STATUSES = new Set(["new", "quoted", "bidding", "scheduled", "completed", "canceled"]);
const VALID_JOB_STATUSES = new Set(["payment_pending", "payment_failed", "paid", "open", "assigned", "scheduled", "in_progress", "completed", "canceled", "refunded"]);

app.get("/api/admin/jobs", requireAuth, requireRole("admin"), (req, res) => {
  try {
    let leads = readLeads();

    if (req.query.status && VALID_LEAD_STATUSES.has(req.query.status)) {
      leads = leads.filter((l) => l.status === req.query.status);
    }
    if (req.query.regionId) {
      leads = leads.filter((l) => l.regionId === req.query.regionId);
    }
    if (req.query.serviceType) {
      leads = leads.filter((l) => l.serviceType === req.query.serviceType);
    }

    leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ ok: true, jobs: leads, total: leads.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/jobs/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const leads = readLeads();
    const lead = leads.find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });
    res.json({ ok: true, job: lead });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/admin/jobs/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
  try {
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
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: payment?.status || null, paidAt: payment?.paid_at || null };
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
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: payment?.status || null, paidAt: payment?.paid_at || null };
    });
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: payment?.status || null, paidAt: payment?.paid_at || null };
    });
    res.json({ ok: true, jobs: jobs.map(sanitizeJobForPublic) });
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

app.get("/api/provider/paid-jobs", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const result = await pgdb.query(
      `SELECT * FROM jobs WHERE status IN ('paid','open') AND (provider_user_id IS NULL OR provider_user_id = $1) ORDER BY created_at DESC`,
      [req.user.id]
    );
    const payments = readJsonArray(PAYMENTS_FILE);
    const jobs = result.rows.map((row) => {
      const j = mapJobRow(row);
      const payment = payments.find((p) => p.job_id === j.id);
      return { ...j, paymentAmount: payment?.amount || null, paymentStatus: payment?.status || null, paidAt: payment?.paid_at || null };
    });
    res.json({ ok: true, jobs: jobs.map(sanitizeJobForPublic) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/provider/jobs/:id/status", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = new Set(["in_progress", "completed", "issue_reported"]);
    if (!status || !allowed.has(status)) {
      return res.status(400).json({ ok: false, error: `Providers can set: ${[...allowed].join(", ")}` });
    }
    const result = await pgdb.query(
      "UPDATE jobs SET status = $2 WHERE id = $1 AND provider_user_id = $3 RETURNING *",
      [req.params.id, status, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Job not found or not assigned to you" });
    }
    res.json({ ok: true, job: mapJobRow(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------- SPA FALLBACK -------------------- */

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on http://0.0.0.0:${PORT}`);
  ensureJobsScopeSnapshotColumn().catch((err) => console.warn('[Startup] scope_snapshot column ensure failed:', err.message));
});
