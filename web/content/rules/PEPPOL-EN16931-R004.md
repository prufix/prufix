---
id: PEPPOL-EN16931-R004
title: Specification identifier is not the Peppol BIS value
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Specification identifier MUST begin with the value 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'.
bt: BT-24
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

BT-24 (`cbc:CustomizationID`, see `BR-01`) must exist under plain EN 16931.
Under Peppol BIS Billing 3.0 it must additionally hold a *specific* value:
one beginning with
`urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0`.
This rule fires when the field is present (so `BR-01` passes) but holds the
plain EN 16931 URN or something else entirely.

Peppol BIS Billing 3.0 is UBL-only; there is no CII binding for this rule.

## Common causes

- **The value is exactly `urn:cen.eu:en16931:2017`** — a document generated
  for plain EN 16931 conformance, submitted unchanged to a Peppol receiver.
  The fix is purely additive: appending the Peppol suffix makes the same
  file pass both checks, since Peppol BIS is EN 16931 plus extra rules.
- **A stale or mistyped fragment after the `#compliant#`** — e.g. an old
  Peppol version string left over from a previous integration, or the
  billing version number typed by hand and slightly wrong.
- **Extra whitespace or a trailing newline** introduced by a templating
  engine, which some strict string-based comparisons will reject even though
  the URN text itself is correct.

## How to fix it

Set `cbc:CustomizationID` to exactly
`urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0`.

## Example

### Wrong

```xml
<cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
```

### Correct

```xml
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
```
