---
id: BR-AE-05
title: Reverse-charge line must have a VAT rate of 0
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Reverse charge" the Invoiced item VAT rate (BT-152) shall be 0 (zero).
bt: BT-151, BT-152
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

Category `AE` ("VAT reverse charge") means the *buyer* — not the seller —
accounts for VAT on this line, typically for intra-EU B2B supplies of
services or goods under domestic reverse-charge schemes. Because the seller
charges no VAT, the line's own rate field must be `0`.

## Common causes

- **The buyer's applicable VAT rate is entered on the line by mistake.**
  It's tempting to record "this would be 21% if it weren't reverse-charged"
  on the line itself — but that rate belongs nowhere on this document. What
  the seller invoices is 0%; the buyer determines and self-assesses their own
  rate outside this invoice.
- **A cross-border B2B service line kept the domestic rate from a template**
  built for domestic sales, without switching both the category to `AE` and
  the rate to `0` when the buyer turned out to be in another member state.
- **Partial reverse charge on a mixed invoice**: some lines are standard
  domestic sales (category `S`) and others are reverse-charged (category
  `AE`) on the same invoice; a copy-paste between lines carries the wrong
  rate across.

## How to fix it

Set the line's rate to `0` whenever the category is `AE`. Then also confirm
the VAT breakdown group for category `AE` carries an exemption reason (see
`BR-AE-10`) — a reverse-charge line without a stated reason on the breakdown
still fails, even once the rate itself is fixed.

## Example

### UBL — wrong

```xml
<cac:ClassifiedTaxCategory>
  <cbc:ID>AE</cbc:ID>
  <cbc:Percent>21</cbc:Percent>
</cac:ClassifiedTaxCategory>
```

### UBL — correct

```xml
<cac:ClassifiedTaxCategory>
  <cbc:ID>AE</cbc:ID>
  <cbc:Percent>0</cbc:Percent>
</cac:ClassifiedTaxCategory>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CategoryCode>AE</ram:CategoryCode>
  <ram:RateApplicablePercent>0</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
