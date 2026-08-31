'use strict';

/**
 * Fixed-point decimal arithmetic on BigInt.
 *
 * Invoice amounts must never travel through IEEE-754 floats: parseFloat-based
 * sums produce artifacts like 1180.0000000000002 and false mismatches.
 * A Decimal is { units: BigInt, scale: number } representing units * 10^-scale.
 */

const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

class Decimal {
  constructor(units, scale) {
    this.units = units; // BigInt
    this.scale = scale; // integer >= 0
  }

  static isNumeric(s) {
    return typeof s === 'string' && NUMERIC_RE.test(s.trim());
  }

  static parse(s) {
    if (s instanceof Decimal) return s;
    const t = String(s).trim();
    if (!NUMERIC_RE.test(t)) throw new Error(`not a decimal number: ${JSON.stringify(s)}`);
    const neg = t.startsWith('-');
    const body = t.replace(/^[+-]/, '');
    const dot = body.indexOf('.');
    const intPart = dot === -1 ? body : body.slice(0, dot);
    const fracPart = dot === -1 ? '' : body.slice(dot + 1);
    const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
    let units = BigInt(digits);
    if (neg) units = -units;
    return new Decimal(units, fracPart.length);
  }

  static fromInt(n) {
    return new Decimal(BigInt(n), 0);
  }

  rescale(scale) {
    if (scale === this.scale) return this;
    if (scale > this.scale) {
      return new Decimal(this.units * 10n ** BigInt(scale - this.scale), scale);
    }
    // Shrinking scale: round half away from zero.
    const factor = 10n ** BigInt(this.scale - scale);
    const q = this.units / factor;
    const r = this.units % factor;
    const half = factor / 2n;
    let units = q;
    if (r >= half) units = q + 1n;
    else if (-r >= half) units = q - 1n;
    return new Decimal(units, scale);
  }

  static align(a, b) {
    const scale = Math.max(a.scale, b.scale);
    return [a.rescale(scale), b.rescale(scale), scale];
  }

  add(other) {
    const [a, b, s] = Decimal.align(this, other);
    return new Decimal(a.units + b.units, s);
  }

  sub(other) {
    const [a, b, s] = Decimal.align(this, other);
    return new Decimal(a.units - b.units, s);
  }

  mul(other) {
    return new Decimal(this.units * other.units, this.scale + other.scale);
  }

  /** Division carried out to `precision` fractional digits, rounded half away from zero. */
  div(other, precision = 10) {
    if (other.units === 0n) throw new Error('division by zero');
    // this/other = (a.units * 10^(precision + b.scale - a.scale)) / b.units, at scale `precision`
    let num = this.units;
    let den = other.units;
    const shift = precision + other.scale - this.scale;
    if (shift >= 0) num *= 10n ** BigInt(shift);
    else den *= 10n ** BigInt(-shift);
    const q = num / den;
    const r = num % den;
    const negResult = (num < 0n) !== (den < 0n);
    const absR = r < 0n ? -r : r;
    const absDen = den < 0n ? -den : den;
    let units = q;
    if (absR * 2n >= absDen) units = negResult ? q - 1n : q + 1n;
    return new Decimal(units, precision).trim(2);
  }

  neg() {
    return new Decimal(-this.units, this.scale);
  }

  abs() {
    return this.units < 0n ? this.neg() : this;
  }

  cmp(other) {
    const [a, b] = Decimal.align(this, other);
    if (a.units < b.units) return -1;
    if (a.units > b.units) return 1;
    return 0;
  }

  isZero() {
    return this.units === 0n;
  }

  /** Drop trailing fractional zeros, but keep at least `minScale` fractional digits. */
  trim(minScale = 0) {
    let { units, scale } = this;
    while (scale > minScale && units % 10n === 0n) {
      units /= 10n;
      scale -= 1;
    }
    return new Decimal(units, scale);
  }

  toString() {
    const neg = this.units < 0n;
    let digits = (neg ? -this.units : this.units).toString();
    if (this.scale === 0) return (neg ? '-' : '') + digits;
    digits = digits.padStart(this.scale + 1, '0');
    const intPart = digits.slice(0, digits.length - this.scale);
    const fracPart = digits.slice(digits.length - this.scale);
    return `${neg ? '-' : ''}${intPart}.${fracPart}`;
  }
}

/** Sum an array of decimal strings; result scale = max operand scale (0 for empty). */
function sumStrings(strings) {
  let acc = new Decimal(0n, 0);
  for (const s of strings) acc = acc.add(Decimal.parse(s));
  return acc;
}

module.exports = { Decimal, sumStrings };
