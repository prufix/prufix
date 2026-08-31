---
id: BR-AE-10
title: Reverse-charge VAT breakdown needs an exemption reason
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: A VAT breakdown (BG-23) with VAT Category code (BT-118) "Reverse charge" shall have a VAT exemption reason code (BT-121), meaning "Reverse charge" or the VAT exemption reason text (BT-120) "Reverse charge".
bt: BT-118, BT-121, BT-120
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

While `BR-AE-05` checks the rate on each *line*, this rule checks the
*document-level VAT breakdown group* (BG-23) for category `AE`: it must
carry an exemption reason — either the coded form (BT-121) or free text
(BT-120) — stating that reverse charge applies. A reverse-charge VAT amount
of `0.00` without any stated reason leaves the recipient unable to tell
whether VAT was correctly omitted or simply forgotten.

## Common causes

- **Line-level fix without the breakdown-level reason.** After fixing
  `BR-AE-05` (rate set to 0 on the lines), the header VAT breakdown group for
  category `AE` is still missing its exemption reason — the two elements are
  independent and both need to be set.
- **Free text used where the code is expected, or vice versa, in a strict
  downstream validator.** EN 16931 accepts either BT-120 or BT-121; some
  receiving platforms require the coded value specifically. Providing only
  free text ("Reverse charge - Article 196") passes this rule but may still
  be rejected downstream — when in doubt, provide the code.
- **Reason attached to the wrong VAT category group** on a mixed invoice
  with more than one `TaxSubtotal`/`ApplicableTradeTax` — the exemption text
  ends up on the `S` group instead of the `AE` one.

## How to fix it

- **UBL**: add `cbc:TaxExemptionReasonCode` (e.g. `VATEX-EU-AE`) or
  `cbc:TaxExemptionReason` (e.g. `Reverse charge`) inside `cac:TaxCategory`
  of the `TaxSubtotal` whose category is `AE`.
- **CII**: add `ram:ExemptionReasonCode` (e.g. `VATEX-EU-AE`) or
  `ram:ExemptionReason` (e.g. `Reverse charge`) inside the `AE`
  `ram:ApplicableTradeTax` group.

## Example

### UBL — wrong

```xml
<cac:TaxSubtotal>
  <cbc:TaxableAmount currencyID="EUR">2000.00</cbc:TaxableAmount>
  <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
  <cac:TaxCategory>
    <cbc:ID>AE</cbc:ID>
    <cbc:Percent>0</cbc:Percent>
    <!-- no exemption reason -->
  </cac:TaxCategory>
</cac:TaxSubtotal>
```

### UBL — correct

```xml
<cac:TaxSubtotal>
  <cbc:TaxableAmount currencyID="EUR">2000.00</cbc:TaxableAmount>
  <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
  <cac:TaxCategory>
    <cbc:ID>AE</cbc:ID>
    <cbc:Percent>0</cbc:Percent>
    <cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>
    <cbc:TaxExemptionReason>Reverse charge</cbc:TaxExemptionReason>
  </cac:TaxCategory>
</cac:TaxSubtotal>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>0.00</ram:CalculatedAmount>
  <ram:BasisAmount>2000.00</ram:BasisAmount>
  <ram:CategoryCode>AE</ram:CategoryCode>
  <ram:ExemptionReason>Reverse charge</ram:ExemptionReason>
  <ram:RateApplicablePercent>0</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
