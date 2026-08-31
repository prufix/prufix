'use strict';

// Exercises the real child-process wrapper (src/engine.js) against a stub
// engine script, via the same EINVOICE_ENGINE override convention
// app/action/src/runner.js uses. This is the one place that actually spawns
// a process, so it is the closest thing to an end-to-end test available
// without the built Docker image (see also test/server.test.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runEngine } = require('../src/engine');

const STUB = path.join(__dirname, 'stubs', 'validate.sh');
const PREV_ENGINE = process.env.EINVOICE_ENGINE;

test.before(() => {
  process.env.EINVOICE_ENGINE = `bash ${STUB.replace(/\\/g, '/')}`;
});
test.after(() => {
  if (PREV_ENGINE === undefined) delete process.env.EINVOICE_ENGINE;
  else process.env.EINVOICE_ENGINE = PREV_ENGINE;
});

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-engine-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('runEngine: success writes the svrl and out-source files, returns status 0', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'in.xml');
    const svrl = path.join(dir, 'out.svrl');
    const outSource = path.join(dir, 'out.source.xml');
    fs.writeFileSync(input, '<Invoice/>');
    const { status, stderr } = runEngine(input, 'en16931', svrl, outSource);
    assert.equal(status, 0);
    assert.ok(fs.existsSync(svrl));
    assert.ok(fs.readFileSync(svrl, 'utf8').includes('schematron-output'));
    assert.ok(stderr.includes('validating with profile en16931'));
    // contract §3.1/§9.28: --out-source is always written, unconditionally
    assert.ok(fs.existsSync(outSource));
    assert.equal(fs.readFileSync(outSource, 'utf8'), '<Invoice/>');
  });
});

test('runEngine: without --out-source the stub fails tool-side (missing mandatory arg) -> status 3', () => {
  // Guards against a regression where runEngine stops passing --out-source:
  // the stub script (mirroring what a strict real engine should do) treats
  // a missing --out-source as a tool-side failure, exit 3.
  withTmp((dir) => {
    const input = path.join(dir, 'in.xml');
    const svrl = path.join(dir, 'out.svrl');
    fs.writeFileSync(input, '<Invoice/>');
    const cmd = process.env.EINVOICE_ENGINE.split(/\s+/);
    const res = spawnSync(cmd[0], [...cmd.slice(1), '--profile', 'en16931', '--input', input, '--out-svrl', svrl], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 3);
    assert.ok(res.stderr.includes('--out-source is mandatory'));
  });
});

test('runEngine: stub-badinput profile -> status 2, stderr captured (not svrl, not out-source)', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'in.xml');
    const svrl = path.join(dir, 'out.svrl');
    const outSource = path.join(dir, 'out.source.xml');
    fs.writeFileSync(input, 'not xml');
    const { status, stderr } = runEngine(input, 'stub-badinput', svrl, outSource);
    assert.equal(status, 2);
    assert.ok(stderr.includes('not well-formed XML'));
    assert.ok(!fs.existsSync(svrl));
    assert.ok(!fs.existsSync(outSource));
  });
});

test('runEngine: stub-toolfail profile -> status 3', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'in.xml');
    const svrl = path.join(dir, 'out.svrl');
    const outSource = path.join(dir, 'out.source.xml');
    fs.writeFileSync(input, '<Invoice/>');
    const { status, stderr } = runEngine(input, 'stub-toolfail', svrl, outSource);
    assert.equal(status, 3);
    assert.ok(stderr.includes('simulated tool failure'));
  });
});

test('runEngine: --out-source can diverge from --input (simulates PDF/facturx extraction)', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'in.pdf');
    const svrl = path.join(dir, 'out.svrl');
    const outSource = path.join(dir, 'out.source.xml');
    fs.writeFileSync(input, '%PDF-1.7 pretend-binary-not-xml');
    const fixture = path.join(dir, 'extracted.xml');
    fs.writeFileSync(fixture, '<Invoice><cbc:ID xmlns:cbc="x">EXTRACTED</cbc:ID></Invoice>');
    const prevFixture = process.env.STUB_SOURCE_FIXTURE;
    process.env.STUB_SOURCE_FIXTURE = fixture;
    let result;
    try {
      result = runEngine(input, 'facturx', svrl, outSource);
    } finally {
      if (prevFixture === undefined) delete process.env.STUB_SOURCE_FIXTURE;
      else process.env.STUB_SOURCE_FIXTURE = prevFixture;
    }
    assert.equal(result.status, 0);
    const written = fs.readFileSync(outSource, 'utf8');
    assert.match(written, /EXTRACTED/);
    assert.doesNotMatch(written, /pretend-binary-not-xml/);
  });
});
