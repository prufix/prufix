'use strict';

/**
 * /waitlist storage (contract §9.23). Stores only email / profile / ts.
 * No IP, no User-Agent, no filenames -- server.js must not pass any of
 * those in here.
 */

const fs = require('node:fs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * WAITLIST_SINK (contract §9.23):
 *   unset / 'stderr'  -> one stderr line, "waitlist <profile>" -- never the email
 *   'file:<path>'     -> JSONL append of {email, profile, ts}
 * Anything else falls back to the stderr behaviour rather than silently
 * dropping the signup.
 */
function recordSignup({ email, profile }) {
  const sink = process.env.WAITLIST_SINK || 'stderr';
  const ts = new Date().toISOString();

  if (sink.startsWith('file:')) {
    const filePath = sink.slice('file:'.length);
    fs.appendFileSync(filePath, `${JSON.stringify({ email, profile, ts })}\n`, 'utf8');
    return;
  }

  process.stderr.write(`waitlist ${profile || '(none)'}\n`);
}

module.exports = { validateEmail, sanitizeProfile, recordSignup };
