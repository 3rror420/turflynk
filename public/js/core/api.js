// Generic fetch helper and API error formatter.
// Extracted from app.js — Phase 2 modular refactor. Loads before app.js.
// No map, auth-gate, Stripe, admin, provider, or jobs logic.

async function api(path, options = {}) {
  const token = localStorage.getItem('turflynk.authToken') || '';

  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

function prettyApiError(error) {
  try {
    const parsed = JSON.parse(error.message || '{}');
    return parsed.error || parsed.detail || error.message;
  } catch {
    return error.message || 'Something went wrong';
  }
}
