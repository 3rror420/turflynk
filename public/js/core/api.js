// Generic fetch helper and API error formatter.
// Extracted from app.js — Phase 2 modular refactor. Loads before app.js.
// No map, auth-gate, Stripe, admin, provider, or jobs logic.

function quoteFlowDebugEnabled() {
  try {
    return Boolean(window.DEBUG_QUOTE_FLOW)
      || localStorage.getItem('DEBUG_QUOTE_FLOW') === '1'
      || localStorage.getItem('DEBUG_QUOTE_FLOW') === 'true';
  } catch {
    return false;
  }
}

function quoteFlowShouldTraceApi(path) {
  if (!quoteFlowDebugEnabled()) return false;
  const step = document.body?.dataset?.quoteFlowStep || window.state?.quoteFlowStep || '';
  if (step && step !== 'property' && step !== 'start' && step !== 'parcel') return false;
  return /\/api\/(parcel\/lookup|checkout|auth|customer|jobs)|\/api\/ai\/detect-mowable/.test(String(path || ''));
}

async function api(path, options = {}) {
  const token = localStorage.getItem('turflynk.authToken') || '';
  const { timeoutMs, headers = {}, ...fetchOptions } = options;
  const traceApi = quoteFlowShouldTraceApi(path);
  const traceLabel = traceApi ? `[QuoteFlow] api ${String(path).split('?')[0]}` : '';
  let response = null;
  let timeoutId = null;
  const startedAt = traceApi ? performance.now() : 0;
  const controller = timeoutMs && !fetchOptions.signal ? new AbortController() : null;

  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;
  }

  if (traceApi) {
    console.time(traceLabel);
    console.log('[QuoteFlow] api:start', {
      path,
      method: fetchOptions.method || 'GET',
      step: document.body?.dataset?.quoteFlowStep || window.state?.quoteFlowStep || '',
    });
  }

  try {
    response = await fetch(path, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text || '{}');
      } catch {}
      const error = new Error(payload?.error || text || `Request failed: ${response.status}`);
      error.status = response.status;
      error.data = payload;
      error.field = payload?.field || '';
      throw error;
    }

    return response.json();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (traceApi) {
      console.log('[QuoteFlow] api:end', {
        path,
        status: response?.status || 0,
        ms: Math.round(performance.now() - startedAt),
      });
      console.timeEnd(traceLabel);
    }
  }
}

function prettyApiError(error) {
  if (error?.data?.error || error?.data?.detail) return error.data.error || error.data.detail;
  try {
    const parsed = JSON.parse(error.message || '{}');
    return parsed.error || parsed.detail || error.message;
  } catch {
    return error.message || 'Something went wrong';
  }
}
