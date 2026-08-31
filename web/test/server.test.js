'use strict';

// HTTP-level integration tests. Routes that don't need the validation
// engine (400/413/405/404, the home page, the waitlist form) are tested
// against the real server. The couple of tests that need a successful
// validation run point EINVOICE_ENGINE at test/stubs/validate.sh (see
// test/engine.test.js for why) plus STUB_SVRL_FIXTURE for the SVRL content,
// rather than the built Docker image, which is not available here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../src/server');

const STUB = path.join(__dirname, 'stubs', 'validate.sh').replace(/\\/g, '/');
const FIX_DIR = path.join(__dirname, '..', '..', 'formatter', 'test', 'fixtures');
const BRCO13_XML = fs.readFileSync(path.join(FIX_DIR, 'ubl-brco13.xml'), 'utf8');

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET / serves the validator page', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Prufix/);
  assert.match(html, /ec-dropzone/);
  assert.match(html, /peppol-bis-3\.0\.21/);
});

test('GET /healthz', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /waitlist serves the signup form', async () => {
  const res = await fetch(`${base}/waitlist`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Join the waitlist/);
});

test('POST /waitlist: invalid email -> 400, no signup recorded', async () => {
  const res = await fetch(`${base}/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=not-an-email&profile=en16931',
  });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /valid email/);
});

test('POST /waitlist: valid email -> 200, stderr sink gets one line without the email', async () => {
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  let res;
  try {
    res = await fetch(`${base}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=' + encodeURIComponent('dev@example.com') + '&profile=xrechnung-3.0.2',
    });
  } finally {
    process.stderr.write = origWrite;
  }
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /on the list/);
  const waitlistLine = lines.find((l) => l.startsWith('waitlist '));
  assert.ok(waitlistLine, 'expected a "waitlist <profile>" stderr line');
  assert.ok(!waitlistLine.includes('dev@example.com'));
});

test('POST /api/validate: missing profile -> 400', async () => {
  const res = await fetch(`${base}/api/validate`, { method: 'POST', body: '<Invoice/>' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /profile/);
});

test('POST /api/validate: unknown profile -> 400', async () => {
  const res = await fetch(`${base}/api/validate?profile=peppol-bis-3.0.20`, { method: 'POST', body: '<Invoice/>' });
  assert.equal(res.status, 400);
});

test('GET /api/validate -> 405', async () => {
  const res = await fetch(`${base}/api/validate?profile=en16931`);
  assert.equal(res.status, 405);
});

test('POST /api/validate: body over 10 MB -> 413', async () => {
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
  const res = await fetch(`${base}/api/validate?profile=en16931`, { method: 'POST', body: big });
  assert.equal(res.status, 413);
}, { timeout: 30000 });

test('GET /nonexistent -> styled 404, not a crash', async () => {
  const res = await fetch(`${base}/this-page-does-not-exist`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /Page not found/);
});

// This test relies on public/rules/BR-CO-13.html already existing (it is
// [D2]'s generated output, not something this test suite writes -- test/
// must never write into app/web/public/, which is [D2]'s directory). If
// [D2]'s output has not been generated yet, this test is skipped rather
// than failing the suite over a missing fixture that isn't ours to create.
test('static serving: extensionless path falls back to <path>.html (matches report.json docUrl shape)', async (t) => {
  const publicDir = path.join(__dirname, '..', 'public');
  const existing = path.join(publicDir, 'rules', 'BR-CO-13.html');
  if (!fs.existsSync(existing)) {
    t.skip('public/rules/BR-CO-13.html not generated yet (owned by [D2])');
    return;
  }
  const res = await fetch(`${base}/rules/BR-CO-13`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /BR-CO-13/);
});

test('static serving: extensionless path with no matching file -> 404 (not a directory-walk crash)', async () => {
  const res = await fetch(`${base}/definitely-not-a-real-rule-id`);
  assert.equal(res.status, 404);
});

test('POST /api/validate: end-to-end success via stub engine (JSON)', async () => {
  const prevEngine = process.env.EINVOICE_ENGINE;
  const prevFixture = process.env.STUB_SVRL_FIXTURE;
  process.env.EINVOICE_ENGINE = `bash ${STUB}`;
  process.env.STUB_SVRL_FIXTURE = path.join(FIX_DIR, 'ubl-brco13.svrl');
  let res;
  try {
    res = await fetch(`${base}/api/validate?profile=en16931`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: BRCO13_XML,
    });
  } finally {
    if (prevEngine === undefined) delete process.env.EINVOICE_ENGINE; else process.env.EINVOICE_ENGINE = prevEngine;
    if (prevFixture === undefined) delete process.env.STUB_SVRL_FIXTURE; else process.env.STUB_SVRL_FIXTURE = prevFixture;
  }
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const report = await res.json();
  assert.equal(report.files[0].findings[0].id, 'BR-CO-13');
  assert.equal(report.files[0].findings[0].enriched, true);
});

test('POST /api/validate: Accept: text/plain renders the text report', async () => {
  const prevEngine = process.env.EINVOICE_ENGINE;
  const prevFixture = process.env.STUB_SVRL_FIXTURE;
  process.env.EINVOICE_ENGINE = `bash ${STUB}`;
  process.env.STUB_SVRL_FIXTURE = path.join(FIX_DIR, 'ubl-brco13.svrl');
  let res;
  try {
    res = await fetch(`${base}/api/validate?profile=en16931`, {
      method: 'POST',
      headers: { Accept: 'text/plain' },
      body: BRCO13_XML,
    });
  } finally {
    if (prevEngine === undefined) delete process.env.EINVOICE_ENGINE; else process.env.EINVOICE_ENGINE = prevEngine;
    if (prevFixture === undefined) delete process.env.STUB_SVRL_FIXTURE; else process.env.STUB_SVRL_FIXTURE = prevFixture;
  }
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  assert.match(text, /BR-CO-13/);
  assert.doesNotMatch(text, /^\{/); // not JSON
});

test('POST /api/validate: no Accept header (curl default) returns JSON', async () => {
  const prevEngine = process.env.EINVOICE_ENGINE;
  const prevFixture = process.env.STUB_SVRL_FIXTURE;
  process.env.EINVOICE_ENGINE = `bash ${STUB}`;
  process.env.STUB_SVRL_FIXTURE = path.join(FIX_DIR, 'ubl-brco13.svrl');
  let res;
  try {
    res = await fetch(`${base}/api/validate?profile=en16931`, { method: 'POST', body: BRCO13_XML });
  } finally {
    if (prevEngine === undefined) delete process.env.EINVOICE_ENGINE; else process.env.EINVOICE_ENGINE = prevEngine;
    if (prevFixture === undefined) delete process.env.STUB_SVRL_FIXTURE; else process.env.STUB_SVRL_FIXTURE = prevFixture;
  }
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('POST /api/validate: engine-rejected input (TRIGGER-BADINPUT) -> 422 with a classified message', async () => {
  const prevEngine = process.env.EINVOICE_ENGINE;
  process.env.EINVOICE_ENGINE = `bash ${STUB}`;
  let res;
  try {
    res = await fetch(`${base}/api/validate?profile=en16931`, { method: 'POST', body: 'TRIGGER-BADINPUT garbage' });
  } finally {
    if (prevEngine === undefined) delete process.env.EINVOICE_ENGINE; else process.env.EINVOICE_ENGINE = prevEngine;
  }
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'The document is not well-formed XML.');
});

test('POST /api/validate: contract §3.1/§9.28 -- report is built from --out-source, not the raw uploaded body', async () => {
  // Stands in for a facturx PDF upload: the request body is not XML at all,
  // but the stub "engine" (simulating successful PDF extraction) writes the
  // real invoice XML to --out-source. If the server ever regressed to
  // handing the raw body to buildReport, this would 502, not 200.
  const prevEngine = process.env.EINVOICE_ENGINE;
  const prevSvrlFixture = process.env.STUB_SVRL_FIXTURE;
  const prevSourceFixture = process.env.STUB_SOURCE_FIXTURE;
  process.env.EINVOICE_ENGINE = `bash ${STUB}`;
  process.env.STUB_SVRL_FIXTURE = path.join(FIX_DIR, 'ubl-brco13.svrl');
  process.env.STUB_SOURCE_FIXTURE = path.join(FIX_DIR, 'ubl-brco13.xml');
  let res;
  try {
    res = await fetch(`${base}/api/validate?profile=facturx`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: Buffer.from('%PDF-1.7 pretend-this-is-binary-pdf-bytes-not-xml'),
    });
  } finally {
    if (prevEngine === undefined) delete process.env.EINVOICE_ENGINE; else process.env.EINVOICE_ENGINE = prevEngine;
    if (prevSvrlFixture === undefined) delete process.env.STUB_SVRL_FIXTURE; else process.env.STUB_SVRL_FIXTURE = prevSvrlFixture;
    if (prevSourceFixture === undefined) delete process.env.STUB_SOURCE_FIXTURE; else process.env.STUB_SOURCE_FIXTURE = prevSourceFixture;
  }
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.files[0].documentType, 'ubl-invoice');
  assert.equal(report.files[0].findings[0].id, 'BR-CO-13');
});

test('POST /api/validate: engine tool failure (TRIGGER-TOOLFAIL) -> 502', async () => {
  const prevEngine = process.env.EINVOICE_ENGINE;
  process.env.EINVOICE_ENGINE = `bash ${STUB}`;
  let res;
  try {
    res = await fetch(`${base}/api/validate?profile=en16931`, { method: 'POST', body: 'TRIGGER-TOOLFAIL garbage' });
  } finally {
    if (prevEngine === undefined) delete process.env.EINVOICE_ENGINE; else process.env.EINVOICE_ENGINE = prevEngine;
  }
  assert.equal(res.status, 502);
});
