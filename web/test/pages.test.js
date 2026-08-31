'use strict';

// Smoke tests for layout.js (contract §9.21's frozen signature) and the
// page bodies built on top of it: valid-ish HTML shape, no leaked markup
// from the fixed signature's escaping, and no duplicate attributes when a
// nav item is marked current.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const layout = require('../src/layout');
const { homeBody, waitlistBody, waitlistThanksBody, notFoundBody } = require('../src/pages');

test('layout.page: exports exactly { page } (contract §9.21)', () => {
  assert.deepEqual(Object.keys(layout), ['page']);
  assert.equal(typeof layout.page, 'function');
});

test('layout.page: title suffix, escaping, and a real doctype', () => {
  const html = layout.page({ title: 'BR-CO-13', description: 'x & y "quoted"', body: '<p>hi</p>', nav: null });
  assert.match(html, /<title>BR-CO-13 — Prufix<\/title>/);
  assert.match(html, /content="x &amp; y &quot;quoted&quot;"/);
  assert.match(html, /^<!doctype html>/i);
});

test('layout.page: no attribute is duplicated on any tag for any nav value', () => {
  for (const nav of ['validator', 'rules', 'waitlist', null]) {
    const html = layout.page({ title: 't', description: 'd', body: '<p>b</p>', nav });
    // crude but effective: no tag should contain the same attribute name twice
    const tagRe = /<[a-z][a-z0-9-]*\b([^>]*)>/gi;
    let m;
    while ((m = tagRe.exec(html))) {
      const attrs = m[1].match(/([a-zA-Z-]+)=/g) || [];
      const seen = new Set();
      for (const a of attrs) {
        assert.ok(!seen.has(a), `duplicate attribute ${a} in tag "${m[0]}" (nav=${nav})`);
        seen.add(a);
      }
    }
  }
});

test('layout.page: canonical link is optional', () => {
  const withCanonical = layout.page({ title: 't', description: 'd', body: '', nav: null, canonical: 'https://example.dev/rules/BR-CO-13' });
  assert.match(withCanonical, /rel="canonical" href="https:\/\/example\.dev\/rules\/BR-CO-13"/);
  const without = layout.page({ title: 't', description: 'd', body: '', nav: null });
  assert.doesNotMatch(without, /rel="canonical"/);
});

test('layout.page: self-contained (no external stylesheet or script tags)', () => {
  const html = layout.page({ title: 't', description: 'd', body: '<p>b</p>', nav: 'validator' });
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.match(html, /<style>/);
});

test('pages.homeBody / waitlistBody / waitlistThanksBody / notFoundBody render without throwing', () => {
  assert.equal(typeof homeBody(), 'string');
  assert.equal(typeof waitlistBody({}), 'string');
  assert.equal(typeof waitlistBody({ error: 'bad <email>', email: 'a@b.com', profile: 'en16931' }), 'string');
  assert.equal(typeof waitlistThanksBody(), 'string');
  assert.equal(typeof notFoundBody(), 'string');
});

test('waitlistBody escapes the error message and email value (no HTML injection)', () => {
  const html = waitlistBody({ error: '<script>alert(1)</script>', email: '"><img src=x>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('homeBody includes all 5 contract profile ids as select options', () => {
  const html = homeBody();
  for (const id of ['en16931', 'peppol-bis-3.0.21', 'xrechnung-3.0.2', 'facturx', 'auto']) {
    assert.match(html, new RegExp(`value="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});
