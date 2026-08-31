'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const http = require('node:http');

const { validateEmail, sanitizeProfile, recordSignup, isAllowedSinkUrl, parseSheetsSink, resetTokenCache } = require('../src/waitlist');

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

// -- Google Sheets sink (contract §9.23) ------------------------------------

test('parseSheetsSink: id and optional tab, malformed ids rejected', () => {
  const id = '15XfGWjq6sGSqWBqZC7W7d1JWmzZL-Azt6wPafAlWk6g';
  assert.deepEqual(parseSheetsSink(`sheets:${id}`), { spreadsheetId: id, tab: 'signups' });
  assert.deepEqual(parseSheetsSink(`sheets:${id}#leads`), { spreadsheetId: id, tab: 'leads' });
  // Empty tab after the # is the default, not an empty sheet name.
  assert.deepEqual(parseSheetsSink(`sheets:${id}#`), { spreadsheetId: id, tab: 'signups' });
  assert.equal(parseSheetsSink('sheets:'), null);
  assert.equal(parseSheetsSink('sheets:too-short'), null);
  // A whole URL pasted in by mistake must not be read as an id.
  assert.equal(parseSheetsSink(`sheets:https://docs.google.com/spreadsheets/d/${id}/edit`), null);
  assert.equal(parseSheetsSink('stderr'), null);
  assert.equal(parseSheetsSink('https://example.com/x'), null);
});

/** Stands in for the metadata server and the Sheets API on one loopback port. */
function googleStub({ tokenStatus = 200, appendStatus = 200 } = {}) {
  const seen = { tokenCalls: 0, appends: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url.startsWith('/token')) {
        seen.tokenCalls += 1;
        seen.metadataFlavor = req.headers['metadata-flavor'];
        res.writeHead(tokenStatus, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }));
      }
      seen.appends.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(appendStatus, { 'content-type': 'application/json' });
      return res.end('{}');
    });
  });
  return { server, seen };
}

async function withGoogle(opts, spreadsheetSink, fn) {
  const { server, seen } = googleStub(opts);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const prev = { sink: process.env.WAITLIST_SINK, md: process.env.EINVOICE_METADATA_URL, api: process.env.EINVOICE_SHEETS_API };
  process.env.WAITLIST_SINK = spreadsheetSink;
  process.env.EINVOICE_METADATA_URL = `${base}/token`;
  process.env.EINVOICE_SHEETS_API = base;
  resetTokenCache();
  try {
    return await fn(seen);
  } finally {
    for (const [k, v] of [['WAITLIST_SINK', prev.sink], ['EINVOICE_METADATA_URL', prev.md], ['EINVOICE_SHEETS_API', prev.api]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    resetTokenCache();
    await new Promise((resolve) => server.close(resolve));
  }
}

const SHEET_ID = '15XfGWjq6sGSqWBqZC7W7d1JWmzZL-Azt6wPafAlWk6g';

test('recordSignup: sheets sink appends [ts, email, profile] with a metadata-server token', async () => {
  await withGoogle({}, `sheets:${SHEET_ID}`, async (seen) => {
    await recordSignup({ email: 'maria@example-gmbh.de', profile: 'XRechnung 3.0.2' });

    assert.equal(seen.tokenCalls, 1);
    assert.equal(seen.metadataFlavor, 'Google', 'metadata server refuses requests without this header');

    assert.equal(seen.appends.length, 1);
    const call = seen.appends[0];
    assert.match(call.url, new RegExp(`/v4/spreadsheets/${SHEET_ID}/values/`));
    assert.match(call.url, /signups!A%3AC:append/);
    assert.match(call.url, /valueInputOption=RAW/);
    assert.match(call.url, /insertDataOption=INSERT_ROWS/);
    assert.equal(call.auth, 'Bearer test-token');

    const sent = JSON.parse(call.body);
    assert.equal(sent.values.length, 1);
    const [ts, email, profile] = sent.values[0];
    assert.ok(!Number.isNaN(Date.parse(ts)));
    assert.equal(email, 'maria@example-gmbh.de');
    assert.equal(profile, 'XRechnung 3.0.2');
  });
});

test('recordSignup: sheets sink caches the token across signups', async () => {
  await withGoogle({}, `sheets:${SHEET_ID}`, async (seen) => {
    await recordSignup({ email: 'a@example.com', profile: 'en16931' });
    await recordSignup({ email: 'b@example.com', profile: 'auto' });
    assert.equal(seen.appends.length, 2);
    assert.equal(seen.tokenCalls, 1, 'a one-hour token must not be re-fetched per signup');
  });
});

test('recordSignup: sheets sink rejects on 403 (sheet not shared) without leaking the email', async () => {
  await withGoogle({ appendStatus: 403 }, `sheets:${SHEET_ID}`, async () => {
    await assert.rejects(
      () => recordSignup({ email: 'jan@example.nl', profile: 'auto' }),
      (err) => {
        assert.match(err.message, /sheets append returned HTTP 403/);
        assert.ok(!err.message.includes('jan@example.nl'));
        return true;
      },
    );
  });
});

test('recordSignup: a custom tab name reaches the range', async () => {
  await withGoogle({}, `sheets:${SHEET_ID}#leads`, async (seen) => {
    await recordSignup({ email: 'c@example.com', profile: 'facturx' });
    assert.match(seen.appends[0].url, /leads!A%3AC:append/);
  });
});
