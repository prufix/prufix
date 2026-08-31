---
id: BR-Z-05
title: Zero-rated line must have a VAT rate of exactly 0
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Zero rated" the Invoiced item VAT rate (BT-152) shall be 0 (zero).
bt: BT-151, BT-152
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

Category `Z` ("zero rated") is the counterpart of `S` (`BR-S-05`): the
category code itself asserts the rate is zero, so the rate field must
literally be `0`. A positive rate on a `Z` line is internally inconsistent.

## Common causes

- **Rate left over from switching a line's category.** A line was originally
  standard-rated with `Percent` set to 19, and only the category ID was
  changed to `Z` (e.g. because the item turned out to be zero-rated by law)
  without also zeroing the rate.
- **Confusing "zero rated" with "exempt".** These are legally distinct
  concepts with different category codes (`Z` vs `E`) — but both ultimately
  charge no VAT, which is the source of the mix-up. Getting the category
  wrong doesn't change the invoice total, so this class of bug frequently
  slips past manual review and is only caught by validation.
- **A default/template rate applied indiscriminately** by code that sets
  `Percent` from a per-product-type table without checking the category code
  that was independently set elsewhere.

## How to fix it

If VAT genuinely applies, use category `S` with the real rate (`BR-S-05`).
If it doesn't, and the reason is that the goods/services are zero-rated by
law, keep category `Z` and set the rate to `0`.

## Example

### UBL — wrong

```xml
<cac:ClassifiedTaxCategory>
  <cbc:ID>Z</cbc:ID>
  <cbc:Percent>19</cbc:Percent>
</cac:ClassifiedTaxCategory>
```

### UBL — correct

```xml
<cac:ClassifiedTaxCategory>
  <cbc:ID>Z</cbc:ID>
  <cbc:Percent>0</cbc:Percent>
</cac:ClassifiedTaxCategory>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CategoryCode>Z</ram:CategoryCode>
  <ram:RateApplicablePercent>0</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
