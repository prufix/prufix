'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Decimal, sumStrings } = require('../src/decimal');

test('parse and toString keep lexical scale', () => {
  assert.equal(Decimal.parse('1180.00').toString(), '1180.00');
  assert.equal(Decimal.parse('-60.00').toString(), '-60.00');
  assert.equal(Decimal.parse('0').toString(), '0');
  assert.equal(Decimal.parse('.5').toString(), '0.5');
  assert.equal(Decimal.parse('007.10').toString(), '7.10');
});

test('float traps do not occur', () => {
  // 0.1 + 0.2 -> 0.30000000000000004 in IEEE-754
  assert.equal(Decimal.parse('0.1').add(Decimal.parse('0.2')).toString(), '0.3');
  // ten times 0.10 -> 0.9999999999999999 in IEEE-754
  assert.equal(sumStrings(Array(10).fill('0.10')).toString(), '1.00');
  // 1117.20 + 62.80 style additions stay exact
  assert.equal(Decimal.parse('1117.20').add(Decimal.parse('62.80')).toString(), '1180.00');
});

test('sub / mul / div', () => {
  assert.equal(Decimal.parse('1240.00').sub(Decimal.parse('-60.00')).toString(), '1300.00');
  assert.equal(Decimal.parse('33.33').mul(Decimal.parse('19')).toString(), '633.27');
  assert.equal(Decimal.parse('633.27').div(Decimal.parse('100')).toString(), '6.3327');
  assert.equal(Decimal.parse('10.00').div(Decimal.parse('4')).toString(), '2.50');
  assert.throws(() => Decimal.parse('1').div(Decimal.parse('0')), /division by zero/);
});

test('rescale rounds half away from zero', () => {
  assert.equal(Decimal.parse('6.3327').rescale(2).toString(), '6.33');
  assert.equal(Decimal.parse('6.335').rescale(2).toString(), '6.34');
  assert.equal(Decimal.parse('-6.335').rescale(2).toString(), '-6.34');
  assert.equal(Decimal.parse('2.5').rescale(0).toString(), '3');
});

test('cmp aligns scales', () => {
  assert.equal(Decimal.parse('1.1').cmp(Decimal.parse('1.10')), 0);
  assert.equal(Decimal.parse('1180.00').cmp(Decimal.parse('1300')), -1);
  assert.equal(Decimal.parse('-0.00').cmp(Decimal.parse('0')), 0);
});

test('isNumeric', () => {
  assert.ok(Decimal.isNumeric('123.45'));
  assert.ok(Decimal.isNumeric('-1'));
  assert.ok(!Decimal.isNumeric('EUR'));
  assert.ok(!Decimal.isNumeric('1,240.00'));
  assert.ok(!Decimal.isNumeric(''));
});
