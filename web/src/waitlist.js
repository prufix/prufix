'use strict';

/**
 * /waitlist storage (contract §9.23). Stores only email / profile / ts.
 * No IP, no User-Agent, no filenames -- server.js must not pass any of
 * those in here.
 */

const fs = require('node:fs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const POST_TIMEOUT_MS = 10_000;

// Overridable for tests, the same convention action/src/runner.js uses for
// EINVOICE_ENGINE: there is no way to reach the real metadata server or the
// real Sheets API from a unit test, and mocking global fetch would hide the
// request shape that is the whole point of the test.
//
// Read per call, not once at require() time: a test sets these after the
// module is already loaded, and a module-level constant would quietly keep
// pointing at the real metadata server.
const metadataUrl = () => process.env.EINVOICE_METADATA_URL
  || 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const sheetsApi = () => process.env.EINVOICE_SHEETS_API || 'https://sheets.googleapis.com';

function validateEmail(email) {
  return typeof email === 'string' && email.trim().length > 0 && email.length <= 254 && EMAIL_RE.test(email.trim());
}

/** The "which profile are you struggling with" field is free descriptive
 * text from a <select>, not gated to the 5 profile ids -- trimmed and
 * length-capped only. */
function sanitizeProfile(profile) {
  return typeof profile === 'string' ? profile.trim().slice(0, 80) : '';
}

/**
 * A signup is an email address, so it only leaves this process over TLS.
 * Plain http is allowed for loopback alone, which is what the tests use --
 * anywhere else it would put the address on the wire in the clear.
 */
function isAllowedSinkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1');
}

/**
 * POST the signup as JSON. Rejects on anything but a 2xx so the caller can
 * tell the visitor to try again: losing a signup silently is worse than
 * showing an error, because nobody ever finds out it happened.
 */
async function postSignup(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // The status only -- never the body, and never the email address: this
    // string reaches the logs, and the logs are not a place for either.
    throw new Error(`waitlist sink returned HTTP ${res.status}`);
  }
}

// -- Google Sheets sink -----------------------------------------------------

/**
 * `sheets:<spreadsheetId>` or `sheets:<spreadsheetId>#<tab>`.
 * The id is the long segment of the sheet's URL; the tab defaults to
 * `signups`. Anything malformed returns null and falls through to stderr.
 */
function parseSheetsSink(sink) {
  if (!sink.startsWith('sheets:')) return null;
  const rest = sink.slice('sheets:'.length);
  const hash = rest.indexOf('#');
  const spreadsheetId = (hash === -1 ? rest : rest.slice(0, hash)).trim();
  const tab = (hash === -1 ? '' : rest.slice(hash + 1)).trim() || 'signups';
  if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) return null;
  return { spreadsheetId, tab };
}

let tokenCache = null;

/**
 * Cloud Run hands the service account's access token out through the metadata
 * server, so there is no key file to create, ship or rotate -- which is the
 * reason this sink is preferred over an Apps Script webhook with a shared
 * secret in its query string.
 *
 * Cached until 60s before expiry: a token lasts an hour and a signup is rare,
 * so nearly every request would otherwise pay for a fetch it did not need.
 */
async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.token;

  const res = await fetch(metadataUrl(), {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`metadata server returned HTTP ${res.status}`);

  const body = await res.json();
  if (!body.access_token) throw new Error('metadata server returned no access_token');

  const ttl = Number(body.expires_in) || 0;
  tokenCache = { token: body.access_token, expiresAt: now + Math.max(0, ttl - 60) * 1000 };
  return tokenCache.token;
}

/** Exposed so a test can start from a clean cache. */
function resetTokenCache() {
  tokenCache = null;
}

/**
 * Append one row: ts, email, profile -- the same three fields the file: sink
 * writes, in a fixed order, so the sheet's columns never depend on which
 * signup arrived first.
 */
async function appendToSheet({ spreadsheetId, tab }, { email, profile, ts }) {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${tab}!A:C`);
  const url = `${sheetsApi()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append`
    + '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [[ts, email, profile]] }),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // 403 here almost always means the sheet was never shared with the Cloud
    // Run service account. Say so -- without the address, and without the
    // response body, which echoes the request.
    throw new Error(`sheets append returned HTTP ${res.status}`);
  }
}

/**
 * WAITLIST_SINK (contract §9.23):
 *   unset / 'stderr'       -> one stderr line, "waitlist <profile>" -- never the email
 *   'file:<path>'          -> JSONL append of {email, profile, ts}
 *   'sheets:<id>[#<tab>]'  -> append [ts, email, profile] to a Google Sheet
 *   'https://...'          -> POST {email, profile, ts} as JSON (loopback http too)
 * Anything else falls back to the stderr behaviour rather than silently
 * dropping the signup.
 */
async function recordSignup({ email, profile }) {
  const sink = process.env.WAITLIST_SINK || 'stderr';
  const ts = new Date().toISOString();

  if (sink.startsWith('file:')) {
    const filePath = sink.slice('file:'.length);
    fs.appendFileSync(filePath, `${JSON.stringify({ email, profile, ts })}\n`, 'utf8');
    return;
  }

  const sheet = parseSheetsSink(sink);
  if (sheet) {
    await appendToSheet(sheet, { email, profile, ts });
    return;
  }

  if (isAllowedSinkUrl(sink)) {
    await postSignup(sink, { email, profile, ts });
    return;
  }

  process.stderr.write(`waitlist ${profile || '(none)'}\n`);
}

module.exports = {
  validateEmail,
  sanitizeProfile,
  recordSignup,
  isAllowedSinkUrl,
  parseSheetsSink,
  resetTokenCache,
};
