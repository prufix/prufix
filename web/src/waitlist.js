'use strict';

/**
 * /waitlist storage (contract §9.23). Stores only email / profile / ts.
 * No IP, no User-Agent, no filenames -- server.js must not pass any of
 * those in here.
 */

const fs = require('node:fs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const POST_TIMEOUT_MS = 10_000;

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
 *
 * A Google Apps Script /exec endpoint answers with a 302 to
 * script.googleusercontent.com; fetch follows it, and doPost has already run
 * by then, so the redirect is not an error.
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

/**
 * WAITLIST_SINK (contract §9.23):
 *   unset / 'stderr'  -> one stderr line, "waitlist <profile>" -- never the email
 *   'file:<path>'     -> JSONL append of {email, profile, ts}
 *   'https://...'     -> POST {email, profile, ts} as JSON (loopback http too)
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

  if (isAllowedSinkUrl(sink)) {
    await postSignup(sink, { email, profile, ts });
    return;
  }

  process.stderr.write(`waitlist ${profile || '(none)'}\n`);
}

module.exports = { validateEmail, sanitizeProfile, recordSignup, isAllowedSinkUrl };
