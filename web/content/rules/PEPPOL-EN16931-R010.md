---
id: PEPPOL-EN16931-R010
title: Missing buyer electronic address
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Buyer electronic address MUST be provided.
bt: BT-49
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

BT-49, the buyer's electronic address, is optional under plain EN 16931 but
mandatory under Peppol BIS Billing 3.0 — the Peppol network is
address-routed, so without it the network has nowhere to deliver the
document. See `PEPPOL-EN16931-CL008` for the companion rule that checks the
address's *scheme* is valid, once this rule confirms the address itself is
present.

Peppol BIS Billing 3.0 is UBL-only; there is no CII binding for this rule.

## Common causes

- **EN16931-only generator reused for Peppol** without adding the endpoint
  identifiers — the same root cause as `PEPPOL-EN16931-R001`; these findings
  typically appear together on a first Peppol attempt.
- **Confusing the buyer's postal/contact details with its electronic
  address.** `cac:AccountingCustomerParty/cac:Party` already carries a
  postal address and often an email in `cac:Contact` — neither of those
  satisfies BT-49, which is specifically `cbc:EndpointID`, a *Peppol network*
  identifier (an org number, GLN, or VAT id in a specific scheme), not an
  email or street address.
- **Endpoint identifier populated on the seller party but not the buyer**,
  or vice versa — the two are separate elements under separate parties, and
  it's easy to add one and forget the other (see `PEPPOL-EN16931-R020` for
  the seller-side equivalent).

## How to fix it

Add `cbc:EndpointID` (with a `schemeID` attribute from the Peppol Electronic
Address Identifier Scheme list) under
`cac:AccountingCustomerParty/cac:Party`.

## Example

### Wrong

```xml
<cac:AccountingCustomerParty>
  <cac:Party>
    <!-- EndpointID missing -->
    <cac:PostalAddress>...</cac:PostalAddress>
  </cac:Party>
</cac:AccountingCustomerParty>
```

### Correct

```xml
<cac:AccountingCustomerParty>
  <cac:Party>
    <cbc:EndpointID schemeID="0192">987654321</cbc:EndpointID>
    <cac:PostalAddress>...</cac:PostalAddress>
  </cac:Party>
</cac:AccountingCustomerParty>
```
