'use strict';

/**
 * The /api/validate pipeline: raw body -> temp file -> engine (boundary 1,
 * child process) -> formatter (in-process, contract §9.18) -> report.json
 * shaped object.
 *
 * [D] is only allowed to call `enrich.buildReport` and `render.renderText`
 * (contract §9.18) -- never svrl.js / xdoc.js / dictionary.js directly,
 * except `dictionary.loadRules`, which is the documented way to load the
 * same rules.yaml the CLI loads (cli.js does the same require).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { buildReport } = require('../../formatter/src/enrich');
const { loadRules } = require('../../formatter/src/dictionary');
const { runEngine: defaultEngineRunner } = require('./engine');

const PROFILES = ['en16931', 'peppol-bis-3.0.21', 'xrechnung-3.0.2', 'facturx', 'auto'];
const MAX_BYTES = 10 * 1024 * 1024;

const RULES_PATH = path.join(__dirname, '..', '..', 'formatter', 'rules', 'rules.yaml');
const FORMATTER_PKG_PATH = path.join(__dirname, '..', '..', 'formatter', 'package.json');

// Product name/org/domain are undecided (contract §8) -- placeholder only.
const DOC_BASE = process.env.EINVOICE_DOC_BASE || 'https://example.dev/rules';

let rulesCache = null;
function getRules() {
  if (!rulesCache) rulesCache = loadRules(RULES_PATH);
  return rulesCache;
}

let toolVersionCache = null;
function getToolVersion() {
  if (!toolVersionCache) {
    // eslint-disable-next-line global-require
    toolVersionCache = require(FORMATTER_PKG_PATH).version;
  }
  return toolVersionCache;
}

function isProfileValid(profile) {
  return typeof profile === 'string' && PROFILES.includes(profile);
}

/** Thrown for anything that should become an HTTP error response. */
class ValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Engine exit 2 means the input was rejected before/at the Schematron stage
 * (contract §3.3). We classify the failure from a closed set of the
 * engine's own die_input() messages instead of forwarding stderr, because
 * stderr can carry raw xmllint/KoSIT output that quotes fragments of the
 * uploaded document (contract §9.24: never leak a parser exception
 * verbatim). Unrecognized text falls back to a generic message.
 */
function classifyInputError(stderr) {
  const s = stderr || '';
  const has = (needle) => s.includes(needle);
  if (has('is not a PDF file') || has('cannot read embedded files from PDF') || has('failed to extract embedded XML from PDF')) {
    return 'The uploaded file could not be read as a PDF.';
  }
  if (has('no known e-invoice attachment found in PDF')) {
    return 'No embedded e-invoice XML (Factur-X/ZUGFeRD) was found inside this PDF.';
  }
  if (has('is not well-formed XML')) {
    return 'The document is not well-formed XML.';
  }
  if (has('unsupported document root')) {
    return 'The document root is not a UBL Invoice, UBL CreditNote, or CII CrossIndustryInvoice.';
  }
  if (has('XML Schema validation failed')) {
    return 'The document does not conform to the UBL/CII XML Schema for this profile.';
  }
  if (has('document failed before Schematron') || has('no validation scenario matched')) {
    return 'No matching validation scenario was found for this document and profile.';
  }
  return 'The document could not be validated for this profile.';
}

/**
 * Runs one document through the engine + formatter pipeline.
 *
 * The input is written under os.tmpdir() with a random name and always
 * removed in `finally`, including when buildReport() throws (contract
 * §9.24 / §9.24's "no invoice content survives a request").
 *
 * @param {Buffer} body
 * @param {string} profile          must already be one of PROFILES
 * @param {object} [opts]
 * @param {function} [opts.engineRunner]  (inputPath, profile, svrlPath, outSourcePath) -> { status, stderr }
 *          Injectable so tests can run the pipeline against a fixture SVRL
 *          without the built Docker image / real engine.
 * @returns {{ report: object }}
 * @throws {ValidationError}
 */
function validateDocument(body, profile, opts = {}) {
  const engineRunner = opts.engineRunner || defaultEngineRunner;
  const tmpBase = process.env.EINVOICE_TMPDIR || os.tmpdir();
  const rand = crypto.randomBytes(12).toString('hex');
  const inputPath = path.join(tmpBase, `einvoice-web-${rand}.input`);
  const svrlPath = path.join(tmpBase, `einvoice-web-${rand}.svrl.xml`);
  const outSourcePath = path.join(tmpBase, `einvoice-web-${rand}.source.xml`);

  fs.writeFileSync(inputPath, body);
  try {
    let engineResult;
    try {
      engineResult = engineRunner(inputPath, profile, svrlPath, outSourcePath);
    } catch (e) {
      throw new ValidationError(502, 'Could not start the validation engine.');
    }
    const { status, stderr } = engineResult;

    if (status === 2) {
      throw new ValidationError(422, classifyInputError(stderr));
    }
    if (status !== 0) {
      // Includes exit 3 (tool-side failure, contract §3.3) and a spawn
      // failure (status: null) -- both are toolchain problems, not a
      // verdict on the document, so both map to 502.
      throw new ValidationError(502, 'The validation engine failed unexpectedly.');
    }

    let svrlXml;
    try {
      svrlXml = fs.readFileSync(svrlPath, 'utf8');
    } catch (e) {
      throw new ValidationError(502, 'The validation engine did not produce a report.');
    }

    // Contract §3.1 / §9.28: --out-source is the XML the engine actually
    // validated -- a copy for XML input, the extracted embedded XML for a
    // PDF (facturx). This is read UNCONDITIONALLY, with no profile branch:
    // the original upload (`body`) must never reach buildReport, because
    // for a PDF it isn't XML at all and xdoc.js's parser throws on it.
    let sourceXml;
    try {
      sourceXml = fs.readFileSync(outSourcePath, 'utf8');
    } catch (e) {
      throw new ValidationError(502, 'The validation engine did not produce the validated source document.');
    }

    let report;
    try {
      report = buildReport({
        svrlXml,
        sourceXml,
        sourcePath: 'upload',
        profile,
        rules: getRules(),
        docBase: DOC_BASE,
        toolVersion: getToolVersion(),
      });
    } catch (e) {
      // Never forward e.message: it can come from the XML parser and quote
      // the offending bytes of the uploaded document (contract §9.24).
      throw new ValidationError(502, 'The report could not be generated for this document.');
    }

    return { report };
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(svrlPath, { force: true });
    fs.rmSync(outSourcePath, { force: true });
  }
}

module.exports = {
  validateDocument,
  ValidationError,
  PROFILES,
  MAX_BYTES,
  isProfileValid,
  classifyInputError,
};
