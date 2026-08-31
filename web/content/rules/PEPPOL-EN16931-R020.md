---
id: PEPPOL-EN16931-R020
title: Missing seller electronic address
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Seller electronic address MUST be provided.
bt: BT-34
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

BT-34, the seller's electronic address, is the seller-side counterpart of
`PEPPOL-EN16931-R010`: optional under plain EN 16931, mandatory under Peppol
BIS Billing 3.0 so the network can identify who sent the document (and route
any response, such as a MLR — Message Level Response).

Peppol BIS Billing 3.0 is UBL-only; there is no CII binding for this rule.

## Common causes

- Same root causes as `PEPPOL-EN16931-R010`, mirrored to the seller party:
  reused EN16931-only generation code, or the buyer's endpoint added while
  the seller's is forgotten (or the reverse).
- **The seller's own Peppol Participant ID exists elsewhere in company
  systems (used to register with an Access Point) but isn't copied into the
  invoice itself.** The registration and the per-document field are two
  different things that must both be kept in sync.
- **Scheme confusion**: using a generic tax ID scheme when the company is
  actually registered under a different identifier scheme with its Access
  Point — see `PEPPOL-EN16931-CL008` for the validity of the `schemeID`
  value itself.

## How to fix it

Add `cbc:EndpointID` (with a `schemeID` attribute from the Peppol Electronic
Address Identifier Scheme list) under
`cac:AccountingSupplierParty/cac:Party`, matching the identifier the seller
is registered under with its Peppol Access Point.

## Example

### Wrong

```xml
<cac:AccountingSupplierParty>
  <cac:Party>
    <!-- EndpointID missing -->
    <cac:PartyLegalEntity>
      <cbc:RegistrationName>Acme Holdings B.V.</cbc:RegistrationName>
    </cac:PartyLegalEntity>
  </cac:Party>
</cac:AccountingSupplierParty>
```

### Correct

```xml
<cac:AccountingSupplierParty>
  <cac:Party>
    <cbc:EndpointID schemeID="9930">DE123456789</cbc:EndpointID>
    <cac:PartyLegalEntity>
      <cbc:RegistrationName>Acme Holdings B.V.</cbc:RegistrationName>
    </cac:PartyLegalEntity>
  </cac:Party>
</cac:AccountingSupplierParty>
```
