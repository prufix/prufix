'use strict';

/**
 * SVRL (ISO/IEC 19757-3 Annex D) reader.
 *
 * Pulls svrl:failed-assert and svrl:successful-report out of a
 * svrl:schematron-output document, together with the prefix declarations
 * (svrl:ns-prefix-in-attribute-values) needed to resolve @location XPaths.
 *
 * Real-world validators do not agree on where the rule id lives:
 *   - EN16931 / Peppol schematrons put it in @id           -> primary source
 *   - some builds only embed it in the text: "[BR-CO-13]-…" -> fallback 1
 *   - some put a rule-id-looking value in @role             -> fallback 2
 *     (@role usually holds a severity word; those are ignored)
 *   - some link it via @see (…/rules/BR-CO-13)              -> fallback 3
 */

const { DOMParser } = require('@xmldom/xmldom');

const SVRL_NS = 'http://purl.oclc.org/dsdl/svrl';
const SEVERITY_WORDS = new Set(['fatal', 'error', 'warning', 'warn', 'info', 'information']);
const RULE_ID_RE = /^[A-Za-z][A-Za-z0-9._]*(?:-[A-Za-z0-9._]+)+$/; // BR-CO-13, PEPPOL-EN16931-R120, UBL-CR-001…

function parseXml(xml, what) {
  let fatal = null;
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level === 'fatalError' && !fatal) fatal = msg;
    },
  });
  let doc = null;
  try {
    doc = parser.parseFromString(xml, 'text/xml');
  } catch (e) {
    throw new Error(`${what} is not well-formed XML: ${e.message}`);
  }
  if (fatal || !doc || !doc.documentElement) {
    throw new Error(`${what} is not well-formed XML${fatal ? `: ${fatal}` : ''}`);
  }
  return doc;
}

function textContentOf(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function idFromText(text) {
  const m = /^\[([^\]\s]+)\]/.exec(text);
  if (m && RULE_ID_RE.test(m[1])) return m[1];
  return null;
}

function idFromSee(see) {
  if (!see) return null;
  const tail = see.replace(/[/#]+$/, '').split(/[/#]/).pop();
  if (tail && RULE_ID_RE.test(tail)) return tail;
  return null;
}

/**
 * Contract §4.3 as amended in rev.2: unknown or non-error flags NEVER escalate.
 *   fatal, error        -> error
 *   absent flag         -> error (Schematron's default assert is hard), unless
 *                          @role downgrades it (KoSIT customLevel uses roles)
 *   warning, warn       -> warning
 *   information(al), info -> warning
 *   any other non-empty flag -> warning  (a flag some standards body invented
 *                          after we shipped: degrade downward, never upward —
 *                          guessing "error" would flag valid documents)
 * svrl:successful-report -> always warning (Peppol uses it for warnings).
 */
function severityOf(el, kind) {
  if (kind === 'successful-report') return 'warning';
  const flag = (el.getAttribute('flag') || '').toLowerCase();
  if (flag === 'fatal' || flag === 'error') return 'error';
  if (flag === '') {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'warning' || role === 'warn' || role === 'information' || role === 'info') return 'warning';
    return 'error';
  }
  return 'warning';
}

function ruleIdOf(el, text) {
  const id = el.getAttribute('id');
  if (id) return id;
  const fromText = idFromText(text);
  if (fromText) return fromText;
  const role = el.getAttribute('role') || '';
  if (RULE_ID_RE.test(role) && !SEVERITY_WORDS.has(role.toLowerCase())) return role;
  const fromSee = idFromSee(el.getAttribute('see'));
  if (fromSee) return fromSee;
  return null;
}

/**
 * @returns {{ nsMap: Object<string,string>, findings: Array<{id: string|null, severity: 'error'|'warning', location: string, text: string, kind: string}> }}
 */
function parseSvrl(xml) {
  const doc = parseXml(xml, 'SVRL');
  const root = doc.documentElement;
  if (root.namespaceURI !== SVRL_NS || root.localName !== 'schematron-output') {
    throw new Error(
      `SVRL root must be {${SVRL_NS}}schematron-output, got {${root.namespaceURI}}${root.localName}`
    );
  }

  const nsMap = {};
  const findings = [];

  // Walk in document order so multi-schematron merges keep their sequence.
  const walk = (node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue; // ELEMENT_NODE
      if (child.namespaceURI === SVRL_NS && child.localName === 'ns-prefix-in-attribute-values') {
        const prefix = child.getAttribute('prefix');
        const uri = child.getAttribute('uri');
        if (prefix && uri) nsMap[prefix] = uri;
      } else if (
        child.namespaceURI === SVRL_NS &&
        (child.localName === 'failed-assert' || child.localName === 'successful-report')
      ) {
        // svrl:text children only; ignore diagnostic-reference etc. for the message
        let text = '';
        for (let g = child.firstChild; g; g = g.nextSibling) {
          if (g.nodeType === 1 && g.namespaceURI === SVRL_NS && g.localName === 'text') {
            text = text ? `${text} ${textContentOf(g)}` : textContentOf(g);
          }
        }
        if (!text) text = textContentOf(child);
        findings.push({
          id: ruleIdOf(child, text),
          severity: severityOf(child, child.localName),
          location: child.getAttribute('location') || '',
          text,
          kind: child.localName,
        });
      } else {
        walk(child);
      }
    }
  };
  walk(root);

  return { nsMap, findings };
}

module.exports = { parseSvrl, parseXml, SVRL_NS };
