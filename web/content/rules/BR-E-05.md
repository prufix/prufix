---
id: BR-E-05
title: VAT-exempt line must have a VAT rate of 0
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Exempt from VAT", the Invoiced item VAT rate (BT-152) shall be 0 (zero).
bt: BT-151, BT-152
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

Category `E` ("exempt from VAT") requires the rate (BT-152) to be `0`, the
same shape as `BR-Z-05` for category `Z`. Exempt supplies (e.g. certain
financial or medical services) carry no VAT at all, so a non-zero rate on an
`E` line contradicts the category.

## Common causes

- **A rate left in place from before the item was reclassified as exempt.**
  Same root cause as `BR-Z-05` — the category ID changes but the rate field
  is a separate control that doesn't get updated automatically.
- **Exemption reason recorded without zeroing the rate.** Some
  implementations correctly add the exemption reason text/code (BT-120/BT-121
  on the VAT breakdown) but leave a stale non-zero rate on the individual
  line's tax category.
- **Mistaking "exempt" for "reduced rate".** A reduced VAT rate (still
  taxed, just at a lower percentage) is category `S` with a lower `Percent`,
  not category `E`. `E` means no VAT applies at all, not "less VAT".

## How to fix it

Set the line's `Percent` to `0` whenever `ID` is `E`. Also make sure the
VAT breakdown group for category `E` states the exemption reason (BT-120 or
BT-121) — this rule only checks the line-level rate; a related check on the
breakdown (not in this dictionary yet) covers the missing reason.

## Example

### UBL — wrong

```xml
<cac:ClassifiedTaxCategory>
  <cbc:ID>E</cbc:ID>
  <cbc:Percent>5</cbc:Percent>
</cac:ClassifiedTaxCategory>
```

### UBL — correct

```xml
<cac:ClassifiedTaxCategory>
  <cbc:ID>E</cbc:ID>
  <cbc:Percent>0</cbc:Percent>
</cac:ClassifiedTaxCategory>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CategoryCode>E</ram:CategoryCode>
  <ram:RateApplicablePercent>0</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
