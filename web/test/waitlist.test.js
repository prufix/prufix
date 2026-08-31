'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const http = require('node:http');

const { validateEmail, sanitizeProfile, recordSignup, isAllowedSinkUrl } = require('../src/waitlist');

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

test('recordSignup: default sink (unset WAITLIST_SINK) writes one stderr line without the email', async () => {
  const prev = process.env.WAITLIST_SINK;
  delete process.env.WAITLIST_SINK;
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    await recordSignup({ email: 'someone@example.com', profile: 'xrechnung-3.0.2' });
  } finally {
    process.stderr.write = origWrite;
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'waitlist xrechnung-3.0.2\n');
  assert.ok(!lines[0].includes('someone@example.com'), 'stderr line must never contain the email (contract §9.23)');
  assert.ok(!lines[0].includes('@'), 'sanity: no @ at all in the stderr line');
});

test('recordSignup: WAITLIST_SINK=stderr explicit -> same behaviour as unset', async () => {
  const prev = process.env.WAITLIST_SINK;
  process.env.WAITLIST_SINK = 'stderr';
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    await recordSignup({ email: 'x@example.com', profile: 'facturx' });
  } finally {
    process.stderr.write = origWrite;
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
  }
  assert.equal(lines[0], 'waitlist facturx\n');
});

test('recordSignup: WAITLIST_SINK=file:<path> appends a JSONL record with only email/profile/ts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-waitlist-test-'));
  const file = path.join(dir, 'waitlist.jsonl');
  const prev = process.env.WAITLIST_SINK;
  process.env.WAITLIST_SINK = `file:${file}`;
  try {
    await recordSignup({ email: 'a@example.com', profile: 'en16931' });
    await recordSignup({ email: 'b@example.com', profile: 'auto' });
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

// -- https sink (contract §9.23) --------------------------------------------

test('isAllowedSinkUrl: https anywhere, http only on loopback', () => {
  assert.equal(isAllowedSinkUrl('https://script.google.com/macros/s/AKfy/exec'), true);
  assert.equal(isAllowedSinkUrl('http://127.0.0.1:9/collect'), true);
  assert.equal(isAllowedSinkUrl('http://localhost:9/collect'), true);
  // An email address must not travel in the clear to anywhere but loopback.
  assert.equal(isAllowedSinkUrl('http://script.google.com/exec'), false);
  assert.equal(isAllowedSinkUrl('ftp://example.com/x'), false);
  assert.equal(isAllowedSinkUrl('stderr'), false);
  assert.equal(isAllowedSinkUrl('file:/tmp/x.jsonl'), false);
  assert.equal(isAllowedSinkUrl('not a url'), false);
});

/** A one-shot sink that records what it was sent and answers with `status`. */
function sinkServer(status = 200) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ method: req.method, contentType: req.headers['content-type'], body });
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(status === 200 ? 'ok' : 'no');
    });
  });
  return { server, received };
}

async function withSink(status, fn) {
  const { server, received } = sinkServer(status);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/collect`;
  const prev = process.env.WAITLIST_SINK;
  process.env.WAITLIST_SINK = url;
  try {
    return await fn(received);
  } finally {
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('recordSignup: url sink POSTs JSON with exactly email/profile/ts', async () => {
  await withSink(200, async (received) => {
    await recordSignup({ email: 'maria@example-gmbh.de', profile: 'XRechnung 3.0.2' });
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.match(received[0].contentType, /application\/json/);
    const rec = JSON.parse(received[0].body);
    assert.deepEqual(Object.keys(rec).sort(), ['email', 'profile', 'ts']);
    assert.equal(rec.email, 'maria@example-gmbh.de');
    assert.equal(rec.profile, 'XRechnung 3.0.2');
    assert.ok(!Number.isNaN(Date.parse(rec.ts)));
  });
});

test('recordSignup: url sink answering non-2xx rejects, so the visitor is told to retry', async () => {
  await withSink(500, async (received) => {
    await assert.rejects(
      () => recordSignup({ email: 'jan@example.nl', profile: 'auto' }),
      (err) => {
        assert.match(err.message, /HTTP 500/);
        // The failure text goes to the logs; the address must not go with it.
        assert.ok(!err.message.includes('jan@example.nl'), 'error message must not carry the email');
        return true;
      },
    );
    assert.equal(received.length, 1);
  });
});

test('recordSignup: an unrecognised WAITLIST_SINK falls back to stderr, never silently drops', async () => {
  const prev = process.env.WAITLIST_SINK;
  process.env.WAITLIST_SINK = 'sqs://queue/that/does/not/exist';
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    await recordSignup({ email: 'dropped@example.com', profile: 'en16931' });
  } finally {
    process.stderr.write = origWrite;
    if (prev === undefined) delete process.env.WAITLIST_SINK; else process.env.WAITLIST_SINK = prev;
  }
  assert.equal(lines[0], 'waitlist en16931\n');
  assert.ok(!lines[0].includes('dropped@example.com'));
});
