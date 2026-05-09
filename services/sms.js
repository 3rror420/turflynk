import fetch from "node-fetch";

const E164_PHONE_RE = /^\+[1-9]\d{7,14}$/;

function boolEnv(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function normalizeProvider(value) {
  return String(value || "signalwire").trim().toLowerCase() || "signalwire";
}

export function isE164Phone(value) {
  return E164_PHONE_RE.test(String(value || "").trim());
}

export function maskPhone(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  if (!last4) return "***";
  const countryPrefix = text.startsWith("+") && digits.length > 10
    ? `+${digits.slice(0, digits.length - 10)}`
    : (digits.length === 11 && digits.startsWith("1") ? "+1" : "");
  return `${countryPrefix}******${last4}`;
}

export function getSmsProvider() {
  return normalizeProvider(process.env.SMS_PROVIDER);
}

function smsConfig() {
  return {
    enabled: boolEnv(process.env.SMS_COD_VERIFICATION_ENABLED),
    provider: getSmsProvider(),
    spaceUrl: String(process.env.SIGNALWIRE_SPACE_URL || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    projectId: String(process.env.SIGNALWIRE_PROJECT_ID || "").trim(),
    apiToken: String(process.env.SIGNALWIRE_API_TOKEN || "").trim(),
    fromNumber: String(process.env.SIGNALWIRE_FROM_NUMBER || "").trim(),
    twilioAccountSid: String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    twilioAuthToken: String(process.env.TWILIO_AUTH_TOKEN || "").trim(),
    twilioMessagingServiceSid: String(process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim(),
    twilioFromNumber: String(process.env.TWILIO_FROM_NUMBER || "").trim()
  };
}

function parseJsonBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function providerError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function validateSignalWireConfig(config) {
  const missing = [];
  if (!config.spaceUrl) missing.push("SIGNALWIRE_SPACE_URL");
  if (!config.projectId) missing.push("SIGNALWIRE_PROJECT_ID");
  if (!config.apiToken) missing.push("SIGNALWIRE_API_TOKEN");
  if (!isE164Phone(config.fromNumber)) missing.push("SIGNALWIRE_FROM_NUMBER");
  return missing;
}

function validateTwilioConfig(config) {
  const missing = [];
  if (!config.twilioAccountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilioAuthToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilioMessagingServiceSid && !isE164Phone(config.twilioFromNumber)) {
    missing.push("TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
  }
  return missing;
}

export function validateSmsConfig() {
  const config = smsConfig();
  if (!config.enabled) return { ok: true, skipped: true, reason: "sms_cod_verification_disabled" };

  if (config.provider === "twilio") {
    const missing = validateTwilioConfig(config);
    if (missing.length) {
      console.warn(`[SMS] Twilio SMS is not configured: missing ${missing.join(", ")}`);
      return { ok: false, provider: "twilio", missing };
    }
    console.info("[SMS] Twilio SMS configured", {
      provider: "twilio",
      usingMessagingServiceSid: Boolean(config.twilioMessagingServiceSid)
    });
    return { ok: true, provider: "twilio" };
  }

  if (config.provider === "signalwire") {
    const missing = validateSignalWireConfig(config);
    if (missing.length) {
      console.warn(`[SMS] SignalWire SMS is not configured: missing ${missing.join(", ")}`);
      return { ok: false, provider: "signalwire", missing };
    }
    return { ok: true, provider: "signalwire" };
  }

  console.warn("[SMS] SMS_PROVIDER must be signalwire or twilio for COD verification SMS.");
  return { ok: false, provider: config.provider, reason: "unsupported_sms_provider" };
}

export async function sendSms(to, body, meta = {}) {
  const config = smsConfig();
  const safeMeta = {
    jobId: meta.jobId || meta.job_id || "",
    purpose: meta.purpose || "cod_verification"
  };

  if (!config.enabled) {
    console.info("[SMS] COD verification SMS disabled; no message sent.", safeMeta);
    return { skipped: true, reason: "sms_cod_verification_disabled" };
  }

  const toNumber = String(to || "").trim();
  if (!isE164Phone(toNumber)) {
    throw new Error("SMS recipient phone must be E.164 format.");
  }

  if (config.provider === "twilio") {
    return sendTwilioSms(config, toNumber, body, safeMeta);
  }

  if (config.provider === "signalwire") {
    return sendSignalWireSms(config, toNumber, body, safeMeta);
  }

  throw providerError("SMS_PROVIDER must be signalwire or twilio for COD verification SMS.", {
    provider: config.provider
  });
}

async function sendSignalWireSms(config, toNumber, body, safeMeta) {
  const missing = validateSignalWireConfig(config);
  if (missing.length) {
    throw providerError(`SignalWire SMS is not configured: missing ${missing.join(", ")}`, {
      provider: "signalwire",
      missing
    });
  }

  const params = new URLSearchParams();
  params.set("From", config.fromNumber);
  params.set("To", toNumber);
  params.set("Body", String(body || ""));

  const url = `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(config.projectId)}/Messages.json`;
  const auth = Buffer.from(`${config.projectId}:${config.apiToken}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const responseText = await response.text();
  const json = parseJsonBody(responseText);

  if (!response.ok) {
    const message = json?.message || json?.error_message || json?.error || `SignalWire SMS failed with ${response.status}`;
    console.warn("[SMS] SignalWire send failed", {
      ...safeMeta,
      to: maskPhone(toNumber),
      status: response.status,
      error: message
    });
    throw providerError(message, {
      provider: "signalwire",
      statusCode: response.status,
      code: json?.code || json?.error_code || null
    });
  }

  console.info("[SMS] SignalWire message sent", {
    ...safeMeta,
    to: maskPhone(toNumber),
    sid: json.sid || json.Sid || "",
    status: json.status || json.Status || ""
  });

  return json;
}

async function sendTwilioSms(config, toNumber, body, safeMeta) {
  const missing = validateTwilioConfig(config);
  if (missing.length) {
    throw providerError(`Twilio SMS is not configured: missing ${missing.join(", ")}`, {
      provider: "twilio",
      missing
    });
  }

  const params = new URLSearchParams();
  if (config.twilioMessagingServiceSid) {
    params.set("MessagingServiceSid", config.twilioMessagingServiceSid);
  } else {
    params.set("From", config.twilioFromNumber);
  }
  params.set("To", toNumber);
  params.set("Body", String(body || ""));

  console.info("[SMS] Twilio send mode", {
    ...safeMeta,
    provider: "twilio",
    to: maskPhone(toNumber),
    usingMessagingServiceSid: Boolean(config.twilioMessagingServiceSid)
  });

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`;
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const responseText = await response.text();
  const json = parseJsonBody(responseText);

  if (!response.ok) {
    const twilioCode = json?.code || json?.error_code || null;
    const twilioMessage = json?.message || json?.error_message || json?.error || `Twilio SMS failed with ${response.status}`;
    const message = twilioCode ? `Twilio SMS failed (${twilioCode}): ${twilioMessage}` : twilioMessage;
    console.warn("[SMS] Twilio send failed", {
      ...safeMeta,
      provider: "twilio",
      to: maskPhone(toNumber),
      status: response.status,
      code: twilioCode,
      error: twilioMessage
    });
    throw providerError(message, {
      provider: "twilio",
      statusCode: response.status,
      code: twilioCode,
      raw: json
    });
  }

  console.info("[SMS] Twilio message sent", {
    ...safeMeta,
    provider: "twilio",
    to: maskPhone(toNumber),
    sid: json.sid || "",
    status: json.status || ""
  });

  return {
    ok: true,
    provider: "twilio",
    messageSid: json.sid,
    status: json.status,
    raw: json
  };
}
