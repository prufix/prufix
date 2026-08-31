---
id: PEPPOL-EN16931-R001
title: Missing Peppol business process (ProfileID)
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Business process MUST be provided.
bt: BT-23
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

BT-23, the business process type, is *optional* under plain EN 16931 but
*mandatory* under Peppol BIS Billing 3.0. It identifies which Peppol
document flow (billing, self-billing, etc.) this invoice belongs to. A
document that validates cleanly against `en16931` but hasn't set this field
will fail the moment it's checked against `peppol-bis-3.0.21` — this rule is
the textbook example of "passes EN 16931, fails Peppol".

Peppol BIS Billing 3.0 is UBL-only; there is no CII binding for this rule.

## Common causes

- **Generator built and tested against plain EN 16931 only**, then pointed
  at Peppol without adding the Peppol-specific mandatory fields — this rule,
  `PEPPOL-EN16931-R004`, `-R010`, and `-R020` tend to appear together on the
  same first Peppol submission.
- **`ProfileID` confused with `CustomizationID`.** The two are adjacent,
  both URNs, and easy to conflate: `CustomizationID` (BT-24, `BR-01`) says
  *which specification* the document follows; `ProfileID` (BT-23, this rule)
  says *which business process*. Setting only one of the two is common.
- **Non-standard billing process value used.** Peppol defines a specific set
  of business process identifiers; a custom or malformed URN in `ProfileID`
  reads as "not provided" by a strict validator even though the element
  technically exists with some content.

## How to fix it

Add `cbc:ProfileID` immediately after `cbc:CustomizationID`, with the
standard Peppol billing process URN.

## Example

### Wrong

```xml
<Invoice ...>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <!-- ProfileID missing -->
  <cbc:ID>INV-2026-0001</cbc:ID>
  ...
</Invoice>
```

### Correct

```xml
<Invoice ...>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>INV-2026-0001</cbc:ID>
  ...
</Invoice>
```
