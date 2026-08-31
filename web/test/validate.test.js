'use strict';

// Pipeline tests for src/validate.js. Uses an injected `engineRunner` so the
// engine + formatter wiring can be exercised without the built Docker image
// (contract §9.18: engine stays boundary 1, formatter is in-process).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateDocument, ValidationError, isProfileValid, classifyInputError, PROFILES } = require('../src/validate');

const FIX_DIR = path.join(__dirname, '..', '..', 'formatter', 'test', 'fixtures');
const BRCO13_SVRL = fs.readFileSync(path.join(FIX_DIR, 'ubl-brco13.svrl'), 'utf8');
const BRCO13_XML = fs.readFileSync(path.join(FIX_DIR, 'ubl-brco13.xml'), 'utf8');
const EMPTY_SVRL = fs.readFileSync(path.join(FIX_DIR, 'empty.svrl'), 'utf8');
const MALFORMED_SVRL = fs.readFileSync(path.join(FIX_DIR, 'malformed.svrl'), 'utf8');

// Simulates the engine's contract §3.1/§9.28 obligation: --out-source is
// always written, defaulting to a copy of --input (what a real engine does
// for XML input) unless `sourceContent` overrides it (what a real engine
// does for a PDF: the extracted embedded XML, unrelated to the raw upload).
function writingEngine(svrlContent, sourceContent) {
  return (inputPath, profile, svrlPath, outSourcePath) => {
    fs.writeFileSync(svrlPath, svrlContent);
    fs.writeFileSync(outSourcePath, sourceContent != null ? sourceContent : fs.readFileSync(inputPath));
    return { status: 0, stderr: '' };
  };
}

test('isProfileValid accepts exactly the 5 contract profile ids', () => {
  assert.deepEqual(PROFILES, ['en16931', 'peppol-bis-3.0.21', 'xrechnung-3.0.2', 'facturx', 'auto']);
  for (const p of PROFILES) assert.equal(isProfileValid(p), true);
  assert.equal(isProfileValid('peppol-bis-3.0.20'), false);
  assert.equal(isProfileValid(''), false);
  assert.equal(isProfileValid(null), false);
  assert.equal(isProfileValid(undefined), false);
});

test('validateDocument: BR-CO-13 fixture produces an enriched report.json-shaped object', () => {
  const { report } = validateDocument(Buffer.from(BRCO13_XML, 'utf8'), 'en16931', {
    engineRunner: writingEngine(BRCO13_SVRL),
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.profile, 'en16931');
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.passed, false);
  const file = report.files[0];
  assert.equal(file.documentType, 'ubl-invoice');
  assert.equal(file.findings.length, 1);
  const f = file.findings[0];
  assert.equal(f.id, 'BR-CO-13');
  assert.equal(f.severity, 'error');
  assert.equal(f.enriched, true);
  assert.ok(f.explain.includes('1,180.00') || f.explain.includes('1180.00'), 'explain should reference the stated value');
  assert.ok(f.values, 'enriched finding should carry probed values');
  // docBase comes from the environment; the module reads it per call, so setting
  // it here is enough. It used to be asserted against a hardcoded placeholder
  // default, which meant this line tested the placeholder rather than the wiring.
  assert.equal(f.docUrl, undefined, 'no EINVOICE_DOC_BASE set -> no docUrl at all');
});

test('validateDocument: docUrl is built from EINVOICE_DOC_BASE when it is set', () => {
  const prev = process.env.EINVOICE_DOC_BASE;
  process.env.EINVOICE_DOC_BASE = 'https://host.invalid/rules';
  try {
    const { report } = validateDocument(Buffer.from(BRCO13_XML, 'utf8'), 'en16931', {
      engineRunner: writingEngine(BRCO13_SVRL),
    });
    const f = report.files[0].findings[0];
    assert.equal(f.docUrl, 'https://host.invalid/rules/BR-CO-13');
  } finally {
    if (prev === undefined) delete process.env.EINVOICE_DOC_BASE;
    else process.env.EINVOICE_DOC_BASE = prev;
  }
});

test('validateDocument: no findings -> summary.passed true, empty findings array', () => {
  const { report } = validateDocument(Buffer.from(BRCO13_XML, 'utf8'), 'en16931', {
    engineRunner: writingEngine(EMPTY_SVRL),
  });
  assert.equal(report.summary.passed, true);
  assert.equal(report.files[0].findings.length, 0);
});

test('validateDocument: contract §3.1/§9.28 -- uses --out-source, never the original upload', () => {
  // `body` is deliberately not XML at all (stands in for a PDF/facturx
  // upload); the engine "extracts" real XML to outSourcePath instead. If
  // validate.js ever regresses to passing `body` to buildReport, this
  // throws (xdoc.js's parser rejects non-XML) instead of succeeding.
  const notXml = Buffer.from('%PDF-1.7 this is not xml at all, just pretend PDF bytes');
  const { report } = validateDocument(notXml, 'facturx', {
    engineRunner: writingEngine(BRCO13_SVRL, BRCO13_XML),
  });
  assert.equal(report.files[0].findings[0].id, 'BR-CO-13');
  assert.equal(report.files[0].documentType, 'ubl-invoice');
});

test('validateDocument: engineRunner is called with (inputPath, profile, svrlPath, outSourcePath) -- 4 args, no branching on profile', () => {
  let receivedArgs;
  const engineRunner = (...args) => {
    receivedArgs = args;
    fs.writeFileSync(args[2], EMPTY_SVRL);
    fs.writeFileSync(args[3], BRCO13_XML);
    return { status: 0, stderr: '' };
  };
  validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner });
  assert.equal(receivedArgs.length, 4);
  assert.equal(receivedArgs[1], 'en16931');
  assert.equal(typeof receivedArgs[3], 'string');
  assert.notEqual(receivedArgs[3], receivedArgs[2], 'outSourcePath must be distinct from svrlPath');
});

test('validateDocument: missing/unreadable --out-source -> ValidationError(502)', () => {
  const engineRunner = (inputPath, profile, svrlPath) => {
    fs.writeFileSync(svrlPath, EMPTY_SVRL);
    // deliberately does not write outSourcePath
    return { status: 0, stderr: '' };
  };
  assert.throws(
    () => validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner }),
    (e) => e instanceof ValidationError && e.status === 502
  );
});

test('validateDocument: engine exit 2 -> ValidationError(422) with a classified, non-raw message', () => {
  const engineRunner = () => ({ status: 2, stderr: 'engine: error: input is not well-formed XML\nsome xmllint output quoting <bad>garbage</bad>' });
  assert.throws(
    () => validateDocument(Buffer.from('not xml'), 'en16931', { engineRunner }),
    (e) => {
      assert.ok(e instanceof ValidationError);
      assert.equal(e.status, 422);
      assert.equal(e.message, 'The document is not well-formed XML.');
      assert.ok(!e.message.includes('garbage'), 'classified message must not leak raw engine stderr');
      return true;
    }
  );
});

test('validateDocument: engine exit 3 -> ValidationError(502)', () => {
  const engineRunner = () => ({ status: 3, stderr: 'engine: error: missing artifact: foo.jar' });
  assert.throws(
    () => validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner }),
    (e) => {
      assert.ok(e instanceof ValidationError);
      assert.equal(e.status, 502);
      assert.ok(!e.message.includes('foo.jar'), 'must not leak raw engine stderr');
      return true;
    }
  );
});

test('validateDocument: engine spawn failure (status null) -> ValidationError(502)', () => {
  const engineRunner = () => ({ status: null, stderr: '' });
  assert.throws(
    () => validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner }),
    (e) => e instanceof ValidationError && e.status === 502
  );
});

test('validateDocument: engineRunner throwing synchronously -> ValidationError(502), not an unhandled crash', () => {
  const engineRunner = () => { throw new Error('boom'); };
  assert.throws(
    () => validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner }),
    (e) => e instanceof ValidationError && e.status === 502
  );
});

test('validateDocument: malformed SVRL from the engine -> ValidationError(502), message does not leak the exception', () => {
  const { report, ...rest } = { report: undefined };
  assert.throws(
    () => validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner: writingEngine(MALFORMED_SVRL) }),
    (e) => {
      assert.ok(e instanceof ValidationError);
      assert.equal(e.status, 502);
      assert.equal(e.message, 'The report could not be generated for this document.');
      return true;
    }
  );
});

for (const [needle, expected] of [
  ['is not a PDF file', 'PDF'],
  ['no known e-invoice attachment found in PDF', 'Factur-X/ZUGFeRD'],
  ['is not well-formed XML', 'not well-formed XML'],
  ['unsupported document root', 'UBL Invoice'],
  ['XML Schema validation failed', 'XML Schema'],
  ['no validation scenario matched', 'validation scenario'],
  ['some completely unknown message', 'could not be validated'],
]) {
  test(`classifyInputError: "${needle}" classifies without echoing the raw text`, () => {
    const msg = classifyInputError(`engine: error: ${needle} <secret-invoice-fragment>`);
    assert.ok(msg.includes(expected), `expected classified message to mention "${expected}", got: ${msg}`);
    assert.ok(!msg.includes('secret-invoice-fragment'));
  });
}

test('validateDocument: temp input file does not survive a request that throws in buildReport', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-web-test-'));
  const prevTmp = process.env.EINVOICE_TMPDIR;
  process.env.EINVOICE_TMPDIR = tmpBase;
  try {
    assert.throws(() =>
      validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner: writingEngine(MALFORMED_SVRL) })
    );
    const left = fs.readdirSync(tmpBase);
    assert.deepEqual(left, [], `temp dir must be empty after a failing request, found: ${left.join(', ')}`);
  } finally {
    if (prevTmp === undefined) delete process.env.EINVOICE_TMPDIR;
    else process.env.EINVOICE_TMPDIR = prevTmp;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('validateDocument: temp input/svrl files do not survive a successful request either', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'einvoice-web-test-'));
  const prevTmp = process.env.EINVOICE_TMPDIR;
  process.env.EINVOICE_TMPDIR = tmpBase;
  try {
    validateDocument(Buffer.from(BRCO13_XML), 'en16931', { engineRunner: writingEngine(BRCO13_SVRL) });
    const left = fs.readdirSync(tmpBase);
    assert.deepEqual(left, [], `temp dir must be empty after a successful request, found: ${left.join(', ')}`);
  } finally {
    if (prevTmp === undefined) delete process.env.EINVOICE_TMPDIR;
    else process.env.EINVOICE_TMPDIR = prevTmp;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});
