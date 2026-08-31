'use strict';

/**
 * Source-document side: namespace-aware XPath probing and SVRL @location
 * resolution against the ORIGINAL invoice document.
 */

const xpath = require('xpath');
const { parseXml } = require('./svrl');
const { Decimal, sumStrings } = require('./decimal');

const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const UBL_CREDITNOTE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const CII_NS = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';

/** Prefixes available to dictionary probes and to SVRL locations (SVRL's own map wins on clash). */
const DEFAULT_NS = {
  ubl: UBL_INVOICE_NS,
  inv: UBL_INVOICE_NS,
  cn: UBL_CREDITNOTE_NS,
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  rsm: CII_NS,
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
};

class SourceDoc {
  constructor(xml, svrlNsMap = {}) {
    this.doc = parseXml(xml, 'source document');
    this.root = this.doc.documentElement;
    this.nsMap = { ...DEFAULT_NS, ...svrlNsMap };
    this.select = xpath.useNamespaces(this.nsMap);
  }

  documentType() {
    const { namespaceURI, localName } = this.root;
    if (namespaceURI === UBL_INVOICE_NS && localName === 'Invoice') return 'ubl-invoice';
    if (namespaceURI === UBL_CREDITNOTE_NS && localName === 'CreditNote') return 'ubl-creditnote';
    if (namespaceURI === CII_NS && localName === 'CrossIndustryInvoice') return 'cii';
    return (localName || 'unknown').toLowerCase();
  }

  /**
   * SVRL @location values come in several dialects; rewrite the XPath 2.0-only
   * syntaxes into XPath 1.0 the `xpath` package can run:
   *   Q{uri}name  (Saxon EQName, used by the KoSIT validator)
   *   *:name      (wildcard prefix; namespace-uri() predicates stay — they are legal XPath 1.0)
   * Prefixed steps (ubl:Invoice[1]/…) are resolved via svrl:ns-prefix-in-attribute-values.
   */
  static translateLocation(location) {
    if (!location) return location;
    let out = location.replace(
      /Q\{([^}]*)\}([A-Za-z_][\w.-]*)/g,
      (m, uri, name) => `*[local-name()='${name}' and namespace-uri()='${uri}']`
    );
    out = out.replace(/\*:([A-Za-z_][\w.-]*)/g, (m, name) => `*[local-name()='${name}']`);
    return out;
  }

  /** Resolve an SVRL @location to a context node, or null when it cannot be resolved. */
  resolveLocation(location) {
    if (!location) return null;
    try {
      const nodes = this.select(SourceDoc.translateLocation(location), this.doc);
      if (Array.isArray(nodes) && nodes.length > 0) return nodes[0];
    } catch (e) {
      // fall through: contract §5 says fall back to document root
    }
    return null;
  }

  /**
   * Evaluate one probe expression. Returns a lexical string (money amounts keep
   * their original lexical form; sums/counts use exact decimal arithmetic), or
   * null when the probe comes up empty.
   *
   * Only `sum(…)` and `count(…)` are computed outside the XPath engine — the
   * XPath number type is an IEEE-754 double and would reintroduce float error.
   */
  probeOne(expr, contextNode, emptyAggAsNull = false) {
    const ctx = contextNode || this.root;
    const src = expr.trim();

    const agg = /^(sum|count)\((.*)\)$/s.exec(src);
    if (agg) {
      const nodes = this.select(agg[2], ctx);
      if (!Array.isArray(nodes)) throw new Error(`probe ${agg[1]}() needs a node-set: ${src}`);
      // An empty node-set at the @location context usually means the probe is
      // written root-relative — report it as a miss so probe() retries from root.
      if (nodes.length === 0 && emptyAggAsNull) return null;
      if (agg[1] === 'count') return Decimal.fromInt(nodes.length).toString();
      if (nodes.length === 0) return '0.00'; // XPath sum() of empty node-set is 0
      const texts = nodes.map((n) => nodeText(n));
      if (!texts.every((t) => Decimal.isNumeric(t))) return null;
      return sumStrings(texts).toString();
    }

    const res = this.select(src, ctx);
    if (Array.isArray(res)) {
      if (res.length === 0) return null;
      const t = nodeText(res[0]);
      return t === '' ? null : t;
    }
    if (typeof res === 'string') return res === '' ? null : res;
    if (typeof res === 'boolean') return res ? 'true' : 'false';
    if (typeof res === 'number') return Number.isFinite(res) ? String(res) : null;
    return null;
  }

  /**
   * Contract §5: try the probe relative to the @location node first; if that
   * yields nothing, retry from the document root. Absolute probes are evaluated once.
   *
   * `locationOnly` (contract §9.33) switches that retry off for one key. The
   * root retry exists for probes that MEAN the whole document but happen to be
   * evaluated at a line-level @location. A probe that means "this line's own
   * allowances" is the opposite case: an empty node-set at the line is a real zero,
   * and retrying at the root silently substitutes the DOCUMENT-level element of
   * the same name -- a wrong number printed as if it were the line's.
   */
  probe(expr, locationNode, locationOnly = false) {
    const isAbsolute = expr.trim().startsWith('/');
    if (locationOnly) {
      // No root retry, and an empty aggregate here is a legitimate 0.00.
      if (!locationNode) return null;
      try {
        return this.probeOne(expr, locationNode);
      } catch (e) {
        return null;
      }
    }
    if (!isAbsolute && locationNode) {
      try {
        const v = this.probeOne(expr, locationNode, true);
        if (v !== null) return v;
      } catch (e) {
        // ignore and retry from root
      }
    }
    try {
      return this.probeOne(expr, this.root);
    } catch (e) {
      return null;
    }
  }
}

function nodeText(node) {
  if (node == null) return '';
  if (node.nodeType === 2) return String(node.value ?? node.nodeValue ?? '').trim(); // attribute
  return String(node.textContent || '').replace(/\s+/g, ' ').trim();
}

module.exports = { SourceDoc, DEFAULT_NS };
