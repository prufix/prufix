'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateEmail, sanitizeProfile, recordSignup } = require('../src/waitlist');

test('validateEmail: basic accept/reject', () => {
  assert.equal(validateEmail('dev@example.com'), true);
  assert.equal(validateEmail('dev+tag@example.co.uk'), true);
  assert.equal(validateEmail(''), false);
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(validateEmail('missing@domain'), false);
  assert.equal(validateEmail(undefined), false);
  assert.equal(validateEmail('a'.repeat(260) + '@example.com'), false);
});

test('sanitizeProfile: trims and caps length, non-strings become empty', () => {
  assert.equal(sanitizeProfile('  peppol-bis-3.0.21  '), 'peppol-bis-3.0.21');
  assert.equal(sanitizeProfile('x'.repeat(200)).length, 80);
  assert.equal(sanitizeProfile(undefined), '');
  assert.equal(sanitizeProfile(null), '');
});

test('recordSignup: default sink (unset WAITLIST_SINK) writes one stderr line without the email', () => {
  const prev = process.env.WAITLIST_SINK;
  delete process.env.WAITLIST_SINK;
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    recordSignup({ email: 'someone@example.com', profile: 'xrechnung-3.0.2' });
  } finally {
    process.stderr.write = origWrite;
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'waitlist xrechnung-3.0.2\n');
  assert.ok(!lines[0].includes('someone@example.com'), 'stderr line must never contain the email (contract §9.23)');
  assert.ok(!lines[0].includes('@'), 'sanity: no @ at all in the stderr line');
});

test('recordSignup: WAITLIST_SINK=stderr explicit -> same behaviour as unset', () => {
  const prev = process.env.WAITLIST_SINK;
  process.env.WAITLIST_SINK = 'stderr';
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    recordSignup({ email: 'x@example.com', profile: 'facturx' });
  } finally {
    process.stderr.write = origWrite;
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
  }
  assert.equal(lines[0], 'waitlist facturx\n');
});

test('recordSignup: WAITLIST_SINK=file:<path> appends a JSONL record with only email/profile/ts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-waitlist-test-'));
  const file = path.join(dir, 'waitlist.jsonl');
  const prev = process.env.WAITLIST_SINK;
  process.env.WAITLIST_SINK = `file:${file}`;
  try {
    recordSignup({ email: 'a@example.com', profile: 'en16931' });
    recordSignup({ email: 'b@example.com', profile: 'auto' });
  } finally {
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const rec = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(rec).sort(), ['email', 'profile', 'ts']);
  assert.equal(rec.email, 'a@example.com');
  assert.equal(rec.profile, 'en16931');
  assert.ok(!Number.isNaN(Date.parse(rec.ts)));
  fs.rmSync(dir, { recursive: true, force: true });
});
