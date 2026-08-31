---
id: BR-CO-13
title: Total amount does not match the line items
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).
bt: BT-109, BT-131, BT-107, BT-108, BT-92, BT-99
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-109, the **invoice total amount without VAT**, must equal the sum of all
line net amounts, minus the document-level allowance total (BT-107), plus
the document-level charge total (BT-108). It is the header total that
everything downstream (`BR-CO-15`, `BR-CO-16`) builds on.

## Common causes

- **Ignoring document-level allowances/charges entirely.** BT-109 gets set
  to the plain sum of the lines, as if `BR-CO-10` were the whole story — this
  is correct only when there happen to be no document-level
  allowances/charges, and wrong the moment either exists.
- **Sign errors on BT-92/BT-99** (see `BR-CO-11`/`BR-CO-12`). Because the
  formula subtracts allowances and adds charges, a negative allowance is
  subtracted twice (i.e. added back), and a negative charge cancels itself
  out — both produce a total that's off by exactly double the mis-signed
  amount.
- **Double-counting line-level adjustments.** Line-level allowances/charges
  are already folded into BT-131 (`PEPPOL-EN16931-R120`); applying them again
  at the document level inflates or deflates BT-109 a second time.

## How to fix it

Compute BT-109 as `Σ line net amounts − document allowances + document
charges`, always in that order, with both BT-92 and BT-99 entered as
positive numbers.

- **UBL**: `cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount` = sum of
  `cac:InvoiceLine/cbc:LineExtensionAmount` (or `CreditNoteLine`) minus sum
  of allowance `cac:AllowanceCharge` amounts plus sum of charge ones.
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount`,
  same formula over the CII line and header allowance/charge elements.

## Example

### UBL — wrong

```xml
<!-- 3 lines summing to 1240.00; one document allowance of 60.00 -->
<cac:AllowanceCharge>
  <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
  <cbc:Amount currencyID="EUR">-60.00</cbc:Amount>  <!-- sign bug -->
</cac:AllowanceCharge>
<cac:LegalMonetaryTotal>
  <cbc:LineExtensionAmount currencyID="EUR">1240.00</cbc:LineExtensionAmount>
  <cbc:AllowanceTotalAmount currencyID="EUR">-60.00</cbc:AllowanceTotalAmount>
  <!-- 1240 - (-60) = 1300, but this file states 1180 -->
  <cbc:TaxExclusiveAmount currencyID="EUR">1180.00</cbc:TaxExclusiveAmount>
</cac:LegalMonetaryTotal>
```

### UBL — correct

```xml
<cac:AllowanceCharge>
  <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
  <cbc:Amount currencyID="EUR">60.00</cbc:Amount>
</cac:AllowanceCharge>
<cac:LegalMonetaryTotal>
  <cbc:LineExtensionAmount currencyID="EUR">1240.00</cbc:LineExtensionAmount>
  <cbc:AllowanceTotalAmount currencyID="EUR">60.00</cbc:AllowanceTotalAmount>
  <cbc:TaxExclusiveAmount currencyID="EUR">1180.00</cbc:TaxExclusiveAmount>
</cac:LegalMonetaryTotal>
```

### CII — correct

```xml
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:LineTotalAmount>1240.00</ram:LineTotalAmount>
  <ram:AllowanceTotalAmount>60.00</ram:AllowanceTotalAmount>
  <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
  <ram:TaxBasisTotalAmount>1180.00</ram:TaxBasisTotalAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
