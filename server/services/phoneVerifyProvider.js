import crypto from "crypto";
import twilio from "twilio";
import { sendSms, isE164Phone, maskPhone, getSmsProvider } from "../../services/sms.js";

const E164_PHONE_RE = /^\+[1-9]\d{7,14}$/;
const LOCAL_CODE_TTL_MS = 15 * 60 * 1000;
const LOCAL_RESEND_WINDOW_MS = 60 * 1000;
const LOCAL_MAX_SENDS = 5;
const LOCAL_MAX_CHECKS = 8;
const localVerifications = new Map();

function normalizeProvider(value) {
  const provider = String(value || "current").trim().toLowerCase();
  return provider || "current";
}

export function getPhoneVerifyProvider() {
  return normalizeProvider(process.env.PHONE_VERIFY_PROVIDER || process.env.PHONE_VERIFICATION_PROVIDER || "current");
}

export function normalizePhoneForVerification(value) {
  const text = String(value || "").trim();
  if (E164_PHONE_RE.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15 && text.startsWith("+")) return `+${digits}`;
  return text;
}

function safePurpose(value) {
  return String(value || "phone_verification").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || "phone_verification";
}

function localKey({ phone, purpose, userId }) {
  return [
    normalizePhoneForVerification(phone),
    safePurpose(purpose),
    userId ? String(userId) : "guest"
  ].join("|");
}

function providerError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function validateTwilioVerifyConfig() {
  const missing = [];
  if (!String(process.env.TWILIO_ACCOUNT_SID || "").trim()) missing.push("TWILIO_ACCOUNT_SID");
  if (!String(process.env.TWILIO_AUTH_TOKEN || "").trim()) missing.push("TWILIO_AUTH_TOKEN");
  if (!String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim()) missing.push("TWILIO_VERIFY_SERVICE_SID");
  return missing;
}

function boolEnv(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function safeLogValue(value, fallback = "") {
  return String(value || fallback || "")
    .trim()
    .replace(/[^\w.:@/-]/g, "_")
    .slice(0, 120) || String(fallback || "");
}

function safeElapsedMs(startedAt) {
  const elapsedMs = Date.now() - Number(startedAt || Date.now());
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : 0;
}

export function logPhoneVerificationEvent(event, meta = {}, level = "info") {
  const safeMeta = {
    provider: safeLogValue(meta.provider || getPhoneVerifyProvider(), "unknown"),
    purpose: safePurpose(meta.purpose),
    maskedPhone: maskPhone(meta.phone || meta.maskedPhone || ""),
    status: safeLogValue(meta.status || "unknown", "unknown"),
    ip: safeLogValue(meta.ip || "", ""),
    userId: safeLogValue(meta.userId || "", ""),
    elapsedMs: Number.isFinite(Number(meta.elapsedMs)) ? Math.max(0, Math.round(Number(meta.elapsedMs))) : 0
  };
  const line = [
    "[PhoneVerify]",
    `provider=${safeMeta.provider}`,
    `status=${safeMeta.status}`,
    `phone=${safeMeta.maskedPhone}`,
    `event=${safeLogValue(event, "unknown")}`,
    `purpose=${safeMeta.purpose}`,
    `ip=${safeMeta.ip || "-"}`,
    `userId=${safeMeta.userId || "-"}`,
    `elapsedMs=${safeMeta.elapsedMs}`
  ].join(" ");
  const logger = level === "warn" ? console.warn : console.info;
  logger(line, safeMeta);
}

function validateCurrentSmsConfig() {
  const smsProvider = getSmsProvider();
  if (!boolEnv(process.env.SMS_COD_VERIFICATION_ENABLED)) {
    return { provider: smsProvider, configured: false };
  }
  if (smsProvider === "twilio") {
    return {
      provider: "twilio",
      configured: Boolean(
        String(process.env.TWILIO_ACCOUNT_SID || "").trim()
        && String(process.env.TWILIO_AUTH_TOKEN || "").trim()
        && (
          String(process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim()
          || isE164Phone(String(process.env.TWILIO_FROM_NUMBER || "").trim())
        )
      )
    };
  }
  if (smsProvider === "signalwire") {
    return {
      provider: "signalwire",
      configured: Boolean(
        String(process.env.SIGNALWIRE_SPACE_URL || "").trim()
        && String(process.env.SIGNALWIRE_PROJECT_ID || "").trim()
        && String(process.env.SIGNALWIRE_API_TOKEN || "").trim()
        && isE164Phone(String(process.env.SIGNALWIRE_FROM_NUMBER || "").trim())
      )
    };
  }
  return { provider: smsProvider, configured: false };
}

export function getPhoneVerificationHealth() {
  const provider = getPhoneVerifyProvider();
  if (provider === "twilio_verify") {
    const missing = validateTwilioVerifyConfig();
    return {
      ok: true,
      provider: "twilio_verify",
      configured: missing.length === 0,
      verifyServiceConfigured: Boolean(String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim())
    };
  }
  const current = validateCurrentSmsConfig();
  return {
    ok: true,
    provider: current.provider || provider,
    configured: current.configured,
    verifyServiceConfigured: false
  };
}

function twilioVerifyClient() {
  const missing = validateTwilioVerifyConfig();
  if (missing.length) {
    throw providerError(`Twilio Verify is not configured: missing ${missing.join(", ")}`, {
      provider: "twilio_verify",
      missing
    });
  }
  return twilio(
    String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    String(process.env.TWILIO_AUTH_TOKEN || "").trim()
  );
}

function localVerificationMessage(code) {
  return `MowNWA: Your phone verification code is ${code}. Enter this code to continue.`;
}

async function startTwilioVerify({ phone }) {
  const normalizedPhone = normalizePhoneForVerification(phone);
  if (!isE164Phone(normalizedPhone)) {
    return { ok: false, provider: "twilio_verify", error: "A valid phone number is required." };
  }

  try {
    const client = twilioVerifyClient();
    const verification = await client.verify.v2
      .services(String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim())
      .verifications
      .create({ to: normalizedPhone, channel: "sms" });
    return {
      ok: true,
      provider: "twilio_verify",
      status: verification.status || "pending",
      to: normalizedPhone
    };
  } catch (error) {
    return {
      ok: false,
      provider: "twilio_verify",
      error: error.message || "Could not start phone verification.",
      missing: error.missing || undefined
    };
  }
}

async function checkTwilioVerify({ phone, code }) {
  const normalizedPhone = normalizePhoneForVerification(phone);
  const sanitizedCode = String(code || "").replace(/\D/g, "");
  if (!isE164Phone(normalizedPhone)) {
    return { ok: false, provider: "twilio_verify", error: "A valid phone number is required." };
  }
  if (!/^\d{4,10}$/.test(sanitizedCode)) {
    return { ok: false, provider: "twilio_verify", error: "A valid verification code is required." };
  }

  try {
    const client = twilioVerifyClient();
    const check = await client.verify.v2
      .services(String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim())
      .verificationChecks
      .create({ to: normalizedPhone, code: sanitizedCode });
    if (check.status === "approved") {
      return {
        ok: true,
        provider: "twilio_verify",
        status: "approved",
        to: normalizedPhone
      };
    }
    return {
      ok: false,
      provider: "twilio_verify",
      status: check.status || "pending",
      error: "Verification code was not approved."
    };
  } catch (error) {
    return {
      ok: false,
      provider: "twilio_verify",
      error: error.message || "Could not check phone verification.",
      missing: error.missing || undefined
    };
  }
}

async function startCurrentVerification({ phone, purpose, userId }) {
  const normalizedPhone = normalizePhoneForVerification(phone);
  if (!isE164Phone(normalizedPhone)) {
    return { ok: false, provider: getSmsProvider(), error: "A valid phone number is required." };
  }

  const key = localKey({ phone: normalizedPhone, purpose, userId });
  const now = Date.now();
  const current = localVerifications.get(key);
  if (current && now - current.lastSentAt < LOCAL_RESEND_WINDOW_MS) {
    return {
      ok: false,
      provider: current.provider || getSmsProvider(),
      status: "rate_limited",
      error: "Please wait before requesting another code."
    };
  }
  if (current && Number(current.sendCount || 0) >= LOCAL_MAX_SENDS) {
    return {
      ok: false,
      provider: current.provider || getSmsProvider(),
      status: "rate_limited",
      error: "Maximum verification sends reached."
    };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const provider = getSmsProvider();
  localVerifications.set(key, {
    code,
    provider,
    phone: normalizedPhone,
    purpose: safePurpose(purpose),
    userId: userId ? String(userId) : "",
    createdAt: now,
    lastSentAt: now,
    expiresAt: now + LOCAL_CODE_TTL_MS,
    sendCount: Number(current?.sendCount || 0) + 1,
    checkCount: 0
  });

  try {
    const smsResponse = await sendSms(normalizedPhone, localVerificationMessage(code), {
      purpose: safePurpose(purpose)
    });
    if (smsResponse?.skipped) throw new Error("Phone verification SMS is disabled.");
    return {
      ok: true,
      provider: smsResponse?.provider || provider,
      status: "pending",
      to: normalizedPhone
    };
  } catch (error) {
    localVerifications.delete(key);
    console.warn("[Phone Verification] SMS send failed", {
      provider,
      to: maskPhone(normalizedPhone),
      purpose: safePurpose(purpose),
      error: error.message
    });
    return {
      ok: false,
      provider,
      error: error.message || "Could not send phone verification code."
    };
  }
}

async function checkCurrentVerification({ phone, code, purpose, userId }) {
  const normalizedPhone = normalizePhoneForVerification(phone);
  const sanitizedCode = String(code || "").replace(/\D/g, "");
  if (!isE164Phone(normalizedPhone)) {
    return { ok: false, provider: getSmsProvider(), error: "A valid phone number is required." };
  }
  if (!/^\d{6}$/.test(sanitizedCode)) {
    return { ok: false, provider: getSmsProvider(), error: "A valid verification code is required." };
  }

  const key = localKey({ phone: normalizedPhone, purpose, userId });
  const current = localVerifications.get(key);
  if (!current) {
    return { ok: false, provider: getSmsProvider(), status: "not_found", error: "Verification code not found." };
  }
  if (Date.now() > Number(current.expiresAt || 0)) {
    localVerifications.delete(key);
    return { ok: false, provider: current.provider, status: "expired", error: "Verification code expired." };
  }
  current.checkCount = Number(current.checkCount || 0) + 1;
  if (current.checkCount > LOCAL_MAX_CHECKS) {
    localVerifications.delete(key);
    return { ok: false, provider: current.provider, status: "rate_limited", error: "Maximum verification attempts reached." };
  }
  if (String(current.code || "") !== sanitizedCode) {
    localVerifications.set(key, current);
    return { ok: false, provider: current.provider, status: "pending", error: "Verification code was not approved." };
  }

  localVerifications.delete(key);
  return {
    ok: true,
    provider: current.provider || getSmsProvider(),
    status: "approved",
    to: normalizedPhone
  };
}

export async function startPhoneVerification({ phone, purpose, userId, ip } = {}) {
  const provider = getPhoneVerifyProvider();
  const startedAt = Date.now();
  logPhoneVerificationEvent("verification_start_requested", {
    provider,
    phone,
    purpose,
    userId,
    ip,
    status: "requested",
    elapsedMs: 0
  });
  try {
    const result = provider === "twilio_verify"
      ? await startTwilioVerify({ phone, purpose, userId })
      : await startCurrentVerification({ phone, purpose, userId });
    logPhoneVerificationEvent(result.ok ? "verification_start_sent" : "verification_provider_error", {
      provider: result.provider || provider,
      phone: result.to || phone,
      purpose,
      userId,
      ip,
      status: result.status || (result.ok ? "pending" : "failed"),
      elapsedMs: safeElapsedMs(startedAt)
    }, result.ok ? "info" : "warn");
    return result;
  } catch (error) {
    logPhoneVerificationEvent("verification_provider_error", {
      provider,
      phone,
      purpose,
      userId,
      ip,
      status: "exception",
      elapsedMs: safeElapsedMs(startedAt)
    }, "warn");
    throw error;
  }
}

export async function checkPhoneVerification({ phone, code, purpose, userId, ip } = {}) {
  const provider = getPhoneVerifyProvider();
  const startedAt = Date.now();
  logPhoneVerificationEvent("verification_check_attempt", {
    provider,
    phone,
    purpose,
    userId,
    ip,
    status: "attempt",
    elapsedMs: 0
  });
  try {
    const result = provider === "twilio_verify"
      ? await checkTwilioVerify({ phone, code, purpose, userId })
      : await checkCurrentVerification({ phone, code, purpose, userId });
    const isProviderError = !result.ok && (result.missing?.length || !result.status);
    const event = isProviderError
      ? "verification_provider_error"
      : (result.ok && result.status === "approved" ? "verification_check_approved" : "verification_check_failed");
    logPhoneVerificationEvent(event, {
      provider: result.provider || provider,
      phone: result.to || phone,
      purpose,
      userId,
      ip,
      status: result.status || (result.ok ? "approved" : "failed"),
      elapsedMs: safeElapsedMs(startedAt)
    }, result.ok && result.status === "approved" ? "info" : "warn");
    return result;
  } catch (error) {
    logPhoneVerificationEvent("verification_provider_error", {
      provider,
      phone,
      purpose,
      userId,
      ip,
      status: "exception",
      elapsedMs: safeElapsedMs(startedAt)
    }, "warn");
    throw error;
  }
}
