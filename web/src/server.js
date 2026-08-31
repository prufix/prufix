'use strict';

/**
 * Prufix web server (contract §9.18-§9.24, mvp-design §5).
 * node:http only, no dependencies beyond the formatter's existing exports.
 *
 * Routes:
 *   GET  /                 drop-a-file validator page
 *   GET  /healthz          healthcheck
 *   POST /api/validate     raw-body validation (contract §9.22)
 *   GET  /waitlist         signup form
 *   POST /waitlist         signup submit
 *   GET  *                 static files from ../public ([D2]'s generated
 *                          output -- may not exist yet; handled without
 *                          crashing)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const layout = require('./layout');
const { homeBody, waitlistBody, waitlistThanksBody, notFoundBody } = require('./pages');
const { validateDocument, ValidationError, PROFILES, MAX_BYTES, isProfileValid } = require('./validate');
const { validateEmail, sanitizeProfile, recordSignup } = require('./waitlist');
const { renderText } = require('../../formatter/src/render');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const WAITLIST_MAX_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

// -- logging -----------------------------------------------------------
// Contract §7 / §9.24: rule ids, counts, profile, duration, byte size only.
// Never file names, amounts, counterparty names, IP addresses, or raw
// exception/parser text.
function log(fields) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...fields }));
}

// -- small response helpers ---------------------------------------------
function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}
function sendPage(res, status, { title, description, nav, body }) {
  sendHtml(res, status, layout.page({ title, description, nav, body }));
}

function wantsText(acceptHeader) {
  if (!acceptHeader) return false;
  const a = acceptHeader.toLowerCase();
  if (a.includes('application/json')) return false;
  return a.includes('text/plain');
}

/** Reads the full request body, rejecting once `maxBytes` is exceeded
 * (Content-Length fast path, plus a running total for chunked bodies). */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new ValidationError(413, 'Request body exceeds the 10 MB limit.'));
      req.resume();
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        reject(new ValidationError(413, 'Request body exceeds the 10 MB limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!settled) {
        settled = true;
        reject(new ValidationError(400, 'Error reading the request body.'));
      }
    });
  });
}

// -- GET / ----------------------------------------------------------------
function handleHome(req, res) {
  sendPage(res, 200, {
    title: 'Validate an e-invoice',
    description:
      'Drop a UBL, CII, or Factur-X invoice and see exactly which values fail EN 16931, Peppol BIS, XRechnung, or Factur-X rules.',
    nav: 'validator',
    body: homeBody(),
  });
}

// -- POST /api/validate ----------------------------------------------------
async function handleValidate(req, res, url) {
  const started = Date.now();
  const profile = url.searchParams.get('profile');
  const text = wantsText(req.headers.accept);

  if (!isProfileValid(profile)) {
    const msg = `Unknown or missing profile. Expected one of: ${PROFILES.join(', ')}.`;
    return text ? sendText(res, 400, `${msg}\n`) : sendJson(res, 400, { error: msg });
  }

  let body;
  try {
    body = await readBody(req, MAX_BYTES);
  } catch (e) {
    const status = e instanceof ValidationError ? e.status : 400;
    const msg = e instanceof ValidationError ? e.message : 'Could not read the request body.';
    return text ? sendText(res, status, `${msg}\n`) : sendJson(res, status, { error: msg });
  }

  let result;
  try {
    result = validateDocument(body, profile);
  } catch (e) {
    if (e instanceof ValidationError) {
      log({ event: 'validate', profile, status: e.status, durationMs: Date.now() - started, bytes: body.length });
      return text ? sendText(res, e.status, `${e.message}\n`) : sendJson(res, e.status, { error: e.message });
    }
    log({ event: 'validate', profile, status: 502, durationMs: Date.now() - started, bytes: body.length, unexpected: true });
    const msg = 'Internal error while validating the document.';
    return text ? sendText(res, 502, `${msg}\n`) : sendJson(res, 502, { error: msg });
  }

  const { report } = result;
  const file = report.files[0];
  log({
    event: 'validate',
    profile: report.profile,
    documentType: file.documentType,
    errors: file.errors,
    warnings: file.warnings,
    ruleIds: file.findings.map((f) => f.id),
    durationMs: Date.now() - started,
    bytes: body.length,
  });

  if (text) return sendText(res, 200, renderText(report));
  return sendJson(res, 200, report);
}

// -- GET/POST /waitlist -----------------------------------------------------
function handleWaitlistGet(req, res, opts = {}) {
  sendPage(res, opts.error ? 400 : 200, {
    title: 'Waitlist',
    description: 'Get notified when Prufix starts checking your invoices against every new validator version.',
    nav: 'waitlist',
    body: waitlistBody(opts),
  });
}

async function handleWaitlistPost(req, res) {
  let params;
  try {
    const buf = await readBody(req, WAITLIST_MAX_BYTES);
    params = new URLSearchParams(buf.toString('utf8'));
  } catch (e) {
    return handleWaitlistGet(req, res, { error: 'Could not read the form submission.' });
  }

  const email = (params.get('email') || '').trim();
  const profile = sanitizeProfile(params.get('profile'));

  if (!validateEmail(email)) {
    return handleWaitlistGet(req, res, { error: 'Please enter a valid email address.', email, profile });
  }

  try {
    // Awaited: the https sink is a network call, and a signup that failed to
    // reach the sink must show the visitor an error rather than a thank-you.
    await recordSignup({ email, profile });
  } catch (e) {
    // Without this the operator sees a working page and an empty sheet, with
    // nothing anywhere saying why. recordSignup builds its own messages and
    // keeps the address out of them, which is what makes this safe to log.
    log({ event: 'waitlist-sink-failed', reason: e && e.message });
    return handleWaitlistGet(req, res, { error: 'Could not save your signup right now. Please try again.', email, profile });
  }

  sendPage(res, 200, {
    title: 'Waitlist',
    description: 'You are on the list.',
    nav: 'waitlist',
    body: waitlistThanksBody(),
  });
}

// -- static files from [D2]'s public/ output ---------------------------------
// report.json's `docUrl` (contract §4.2) is extensionless (".../rules/BR-CO-13"),
// but the generator writes "<ID>.html" -- so an extensionless path that isn't
// a file on its own gets one extensionless-URL fallback: `<path>.html`.
function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    return send404(res);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  const withinPublic = target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + path.sep);
  if (!withinPublic) return send404(res);

  fs.stat(target, (err, stat) => {
    if (!err && stat.isFile()) return streamFile(res, target);
    if (path.extname(target) === '') {
      const withHtml = `${target}.html`;
      return fs.stat(withHtml, (err2, stat2) => {
        if (!err2 && stat2.isFile()) return streamFile(res, withHtml);
        send404(res);
      });
    }
    send404(res);
  });
}

function streamFile(res, target) {
  fs.stat(target, (err, stat) => {
    if (err) return send404(res);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    const stream = fs.createReadStream(target);
    stream.on('error', () => { if (!res.headersSent) send404(res); else res.end(); });
    stream.pipe(res);
  });
}

function send404(res) {
  sendPage(res, 404, {
    title: 'Page not found',
    description: 'This page does not exist.',
    nav: null,
    body: notFoundBody(),
  });
}

// -- routing ------------------------------------------------------------
function requestHandler(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (e) {
    return sendText(res, 400, 'Bad request.\n');
  }
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/') return handleHome(req, res);

  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/healthz') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (pathname === '/api/validate') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
    return handleValidate(req, res, url).catch((e) => {
      log({ event: 'validate-crash' });
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error.' });
    });
  }

  if (pathname === '/waitlist') {
    if (req.method === 'GET') return handleWaitlistGet(req, res);
    if (req.method === 'POST') {
      return handleWaitlistPost(req, res).catch((e) => {
        log({ event: 'waitlist-crash' });
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal error.' });
      });
    }
    return sendJson(res, 405, { error: 'Use GET or POST.' });
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);

  return sendJson(res, 404, { error: 'Not found.' });
}

function createServer() {
  return http.createServer(requestHandler);
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    log({ event: 'listening', port: PORT });
  });
}

module.exports = { createServer, requestHandler };
