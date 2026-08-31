'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, MissingValue } = require('../src/expr');
const { Decimal } = require('../src/decimal');

const env = {
  lines: '1240.00',
  allowance: '-60.00',
  charge: '0.00',
  stated: '1180.00',
  rate: '0.19',
  category: 'S',
  count: '3',
};

test('arithmetic with decimals and precedence', () => {
  assert.equal(evaluate('lines - allowance + charge', env).toString(), '1300.00');
  assert.equal(evaluate('1 + 2 * 3', env).toString(), '7');
  assert.equal(evaluate('(1 + 2) * 3', env).toString(), '9');
  assert.equal(evaluate('-allowance', env).toString(), '60.00');
  assert.equal(evaluate('count * 0.01', env).toString(), '0.03');
});

test('abs and round', () => {
  assert.equal(evaluate('abs(allowance)', env).toString(), '60.00');
  assert.equal(evaluate('round(100 * rate, 2)', env).toString(), '19.00');
  assert.equal(evaluate('round(33.33 * 19 / 100, 2)', env).toString(), '6.33');
});

test('comparisons', () => {
  assert.equal(evaluate('allowance < 0', env), true);
  assert.equal(evaluate('stated == lines', env), false);
  assert.equal(evaluate('rate > 0 and rate < 1', env), true);
  assert.equal(evaluate('stated == lines or allowance != 0', env), true);
  assert.equal(evaluate("category == 'S'", env), true);
  assert.equal(evaluate("category != 'AE'", env), true);
});

test('missing identifiers throw MissingValue', () => {
  assert.throws(() => evaluate('nope + 1', env), MissingValue);
  // prototype properties must not resolve
  assert.throws(() => evaluate('constructor', env), MissingValue);
  assert.throws(() => evaluate('__proto__', env), MissingValue);
});

test('no code execution surface', () => {
  assert.throws(() => evaluate('process.exit(1)', env));
  assert.throws(() => evaluate("category('x')", env));
  assert.throws(() => evaluate('1; 2', env));
  assert.throws(() => evaluate('`x`', env));
});

test('ordered comparison on strings is rejected', () => {
  assert.throws(() => evaluate("category < 'T'", env), /non-numeric/);
});

test('returns Decimal instances for arithmetic', () => {
  assert.ok(evaluate('1 + 1', env) instanceof Decimal);
});
