'use strict';

/**
 * Tiny safe evaluator for dictionary expressions (contract §5).
 *
 * Grammar (no eval, no Function, no property access, no calls except abs()):
 *   or     := and ('or' and)*
 *   and    := cmp ('and' cmp)*
 *   cmp    := sum (('<'|'<='|'>'|'>='|'=='|'!=') sum)?
 *   sum    := term (('+'|'-') term)*
 *   term   := unary (('*'|'/') unary)*
 *   unary  := '-' unary | primary
 *   primary:= number | string | identifier | 'abs' '(' or ')'
 *           | 'round' '(' or ',' number ')' | '(' or ')'
 *
 * `derive` expressions must evaluate to a Decimal; `when` expressions to a boolean.
 * Identifiers resolve against probed/derived values. Referencing a value that was
 * not probed throws MissingValue, which callers treat as "skip this derive/hint".
 */

const { Decimal } = require('./decimal');

class MissingValue extends Error {
  constructor(name) {
    super(`missing value: ${name}`);
    this.name = 'MissingValue';
    this.key = name;
  }
}

const TOKEN_RE = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|('(?:[^'\\]|\\.)*')|(<=|>=|==|!=|[<>+\-*/(),]))/y;

function tokenize(src) {
  const tokens = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`bad token in expression at offset ${pos}: ${JSON.stringify(src.slice(pos, pos + 12))}`);
    }
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: m[1] });
    else if (m[2] !== undefined) {
      if (m[2] === 'and' || m[2] === 'or') tokens.push({ t: 'op', v: m[2] });
      else tokens.push({ t: 'id', v: m[2] });
    } else if (m[3] !== undefined) tokens.push({ t: 'str', v: m[3].slice(1, -1).replace(/\\(.)/g, '$1') });
    else tokens.push({ t: 'op', v: m[4] });
  }
  return tokens;
}

function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => {
    const tok = tokens[i];
    if (!tok || (v !== undefined && !(tok.t === 'op' && tok.v === v))) {
      throw new Error(`expected ${v ?? 'token'} in expression: ${src}`);
    }
    i += 1;
    return tok;
  };

  function primary() {
    const tok = peek();
    if (!tok) throw new Error(`unexpected end of expression: ${src}`);
    if (tok.t === 'num') { i += 1; return { k: 'num', v: tok.v }; }
    if (tok.t === 'str') { i += 1; return { k: 'str', v: tok.v }; }
    if (tok.t === 'id') {
      i += 1;
      if (tok.v === 'abs' && peek() && peek().t === 'op' && peek().v === '(') {
        take('(');
        const arg = or();
        take(')');
        return { k: 'abs', arg };
      }
      if (tok.v === 'round' && peek() && peek().t === 'op' && peek().v === '(') {
        take('(');
        const arg = or();
        take(',');
        const digitsTok = peek();
        if (!digitsTok || digitsTok.t !== 'num' || digitsTok.v.includes('.')) {
          throw new Error(`round() needs an integer digit count: ${src}`);
        }
        i += 1;
        take(')');
        return { k: 'round', arg, digits: Number(digitsTok.v) };
      }
      return { k: 'id', v: tok.v };
    }
    if (tok.t === 'op' && tok.v === '(') {
      take('(');
      const inner = or();
      take(')');
      return inner;
    }
    throw new Error(`unexpected ${JSON.stringify(tok.v)} in expression: ${src}`);
  }

  function unary() {
    if (peek() && peek().t === 'op' && peek().v === '-') {
      take('-');
      return { k: 'neg', arg: unary() };
    }
    return primary();
  }

  function binary(next, ops, kind) {
    return () => {
      let left = next();
      while (peek() && peek().t === 'op' && ops.includes(peek().v)) {
        const op = take().v;
        left = { k: kind, op, left, right: next() };
      }
      return left;
    };
  }

  const term = binary(unary, ['*', '/'], 'arith');
  const sum = binary(term, ['+', '-'], 'arith');
  function cmp() {
    const left = sum();
    if (peek() && peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) {
      const op = take().v;
      return { k: 'cmp', op, left, right: sum() };
    }
    return left;
  }
  const and = binary(cmp, ['and'], 'bool');
  const or = binary(and, ['or'], 'bool');

  const ast = or();
  if (i !== tokens.length) throw new Error(`trailing tokens in expression: ${src}`);
  return ast;
}

function asDecimal(v, src) {
  if (v instanceof Decimal) return v;
  if (typeof v === 'string' && Decimal.isNumeric(v)) return Decimal.parse(v);
  throw new Error(`non-numeric operand in arithmetic: ${src}`);
}

function evalNode(node, env, src) {
  switch (node.k) {
    case 'num': return Decimal.parse(node.v);
    case 'str': return node.v;
    case 'id': {
      // Object.hasOwn, not `in`: 'constructor' etc. must read as missing
      if (!Object.hasOwn(env, node.v)) throw new MissingValue(node.v);
      const v = env[node.v];
      return Decimal.isNumeric(v) ? Decimal.parse(v) : v;
    }
    case 'neg': return asDecimal(evalNode(node.arg, env, src), src).neg();
    case 'abs': return asDecimal(evalNode(node.arg, env, src), src).abs();
    case 'round': return asDecimal(evalNode(node.arg, env, src), src).rescale(node.digits);
    case 'arith': {
      const a = asDecimal(evalNode(node.left, env, src), src);
      const b = asDecimal(evalNode(node.right, env, src), src);
      switch (node.op) {
        case '+': return a.add(b);
        case '-': return a.sub(b);
        case '*': return a.mul(b).trim(2);
        case '/': return a.div(b);
        default: throw new Error(`unknown operator ${node.op}`);
      }
    }
    case 'cmp': {
      const a = evalNode(node.left, env, src);
      const b = evalNode(node.right, env, src);
      const bothNum = a instanceof Decimal && b instanceof Decimal;
      if (bothNum) {
        const c = a.cmp(b);
        switch (node.op) {
          case '<': return c < 0;
          case '<=': return c <= 0;
          case '>': return c > 0;
          case '>=': return c >= 0;
          case '==': return c === 0;
          case '!=': return c !== 0;
          default: throw new Error(`unknown operator ${node.op}`);
        }
      }
      const as = a instanceof Decimal ? a.toString() : a;
      const bs = b instanceof Decimal ? b.toString() : b;
      if (node.op === '==') return as === bs;
      if (node.op === '!=') return as !== bs;
      throw new Error(`ordered comparison on non-numeric values: ${src}`);
    }
    case 'bool': {
      const a = evalNode(node.left, env, src);
      if (node.op === 'and') return a === true ? evalNode(node.right, env, src) === true : false;
      return a === true ? true : evalNode(node.right, env, src) === true;
    }
    default:
      throw new Error(`unknown node kind ${node.k}`);
  }
}

/**
 * Evaluate `src` against `env` (map of name -> string | Decimal).
 * Returns Decimal | string | boolean. Throws MissingValue for unknown identifiers.
 */
function evaluate(src, env) {
  return evalNode(parse(src), env, src);
}

module.exports = { evaluate, parse, MissingValue };
