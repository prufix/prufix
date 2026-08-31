---
id: BR-S-05
title: Standard-rated line must have a VAT rate above zero
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Standard rated" the Invoiced item VAT rate (BT-152) shall be greater than zero.
bt: BT-151, BT-152
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

The VAT category code (BT-151, UNCL5305 subset `S`/`Z`/`E`/`AE`/`K`/`G`/`O`/`L`/`M`)
carries the *legal* meaning of how VAT applies to a line; the rate (BT-152)
is just the number. Category `S` means "standard rated", which by definition
means a positive rate applies — a standard-rated line with a 0% rate is a
contradiction the rule catches directly, without needing to know the actual
rate in force.

## Common causes

- **Copied template line with the rate zeroed out but the category left as
  `S`.** A common source of this: a "sample" or "free of charge" line is
  created by setting the price/rate to 0 without changing the category code
  to match.
- **Confusing "0% VAT" with "no VAT category".** Genuinely zero-rated goods
  (books, some exports) use category `Z`, not `S` with a 0% rate. `S` at 0%
  isn't a smaller version of zero-rated — it's an invalid combination.
- **Exempt or reverse-charge items miscategorized as standard.** If VAT
  doesn't apply at all (exempt) or is self-assessed by the buyer (reverse
  charge), the correct categories are `E` and `AE` respectively — not `S`
  with the rate zeroed.

## How to fix it

Pick the category that matches how VAT actually applies to this line, then
set the rate consistently with it:

- Standard rate applies → category `S`, rate > 0 (this rule).
- Legally zero-rated → category `Z`, rate = 0 (see `BR-Z-05`).
- Exempt → category `E`, rate = 0 (see `BR-E-05`).
- Reverse charge → category `AE`, rate = 0 (see `BR-AE-05`).

Category and rate are set together, from the same business decision — never
edit one without checking the other.

## Example

### UBL — wrong

```xml
<cac:InvoiceLine>
  <cbc:ID>1</cbc:ID>
  <cac:Item>
    <cbc:Name>Sample unit</cbc:Name>
    <cac:ClassifiedTaxCategory>
      <cbc:ID>S</cbc:ID>
      <cbc:Percent>0</cbc:Percent>
    </cac:ClassifiedTaxCategory>
  </cac:Item>
</cac:InvoiceLine>
```

### UBL — correct

```xml
<cac:InvoiceLine>
  <cbc:ID>1</cbc:ID>
  <cac:Item>
    <cbc:Name>Sample unit</cbc:Name>
    <cac:ClassifiedTaxCategory>
      <cbc:ID>Z</cbc:ID>
      <cbc:Percent>0</cbc:Percent>
    </cac:ClassifiedTaxCategory>
  </cac:Item>
</cac:InvoiceLine>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CategoryCode>S</ram:CategoryCode>
  <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
