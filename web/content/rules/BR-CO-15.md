---
id: BR-CO-15
title: Total with VAT is not total without VAT plus VAT
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).
bt: BT-112, BT-109, BT-110
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-112, the **invoice total with VAT**, must equal BT-109 (total without
VAT) plus BT-110 (total VAT amount). Both of those are themselves checked by
`BR-CO-13` and `BR-CO-14`, so this rule is usually the last one to fail in a
chain — if BT-109 or BT-110 is already wrong, fix those first.

## Common causes

- **VAT not added at all.** BT-112 is set equal to BT-109, as if the invoice
  had no VAT — common on invoices where VAT is computed and displayed but
  the "total with VAT" field is filled from the wrong source amount before
  VAT is added in.
- **Reverse-charge invoices with residual VAT.** On a fully reverse-charged
  invoice BT-110 is legitimately `0.00` and BT-112 should equal BT-109 — that
  case is fine. The bug this rule catches is when BT-110 is non-zero but
  wasn't added.
- **Currency/rounding drift between the two source fields.** BT-109 and
  BT-110 are each independently rounded to 2 decimals (per `BR-CO-13` /
  `BR-CO-14`); BT-112 must be the sum of those two already-rounded values,
  not an independent recomputation that can drift by a cent.

## How to fix it

Set BT-112 to the literal sum of BT-109 and BT-110, computed after both of
those are already correct.

- **UBL**: `cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount` =
  `cbc:TaxExclusiveAmount` + the VAT total from `cac:TaxTotal/cbc:TaxAmount`.
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount`
  = `ram:TaxBasisTotalAmount` + `ram:TaxTotalAmount`.

## Example

### UBL — wrong

```xml
<cac:LegalMonetaryTotal>
  <cbc:TaxExclusiveAmount currencyID="EUR">1180.00</cbc:TaxExclusiveAmount>
  <cbc:TaxInclusiveAmount currencyID="EUR">1180.00</cbc:TaxInclusiveAmount>  <!-- VAT missing -->
  <cbc:PayableAmount currencyID="EUR">1180.00</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
<cac:TaxTotal>
  <cbc:TaxAmount currencyID="EUR">224.20</cbc:TaxAmount>
</cac:TaxTotal>
```

### UBL — correct

```xml
<cac:LegalMonetaryTotal>
  <cbc:TaxExclusiveAmount currencyID="EUR">1180.00</cbc:TaxExclusiveAmount>
  <cbc:TaxInclusiveAmount currencyID="EUR">1404.20</cbc:TaxInclusiveAmount>
  <cbc:PayableAmount currencyID="EUR">1404.20</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
<cac:TaxTotal>
  <cbc:TaxAmount currencyID="EUR">224.20</cbc:TaxAmount>
</cac:TaxTotal>
```

### CII — correct

```xml
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:TaxBasisTotalAmount>1180.00</ram:TaxBasisTotalAmount>
  <ram:TaxTotalAmount>224.20</ram:TaxTotalAmount>
  <ram:GrandTotalAmount>1404.20</ram:GrandTotalAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
