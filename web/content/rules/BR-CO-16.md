---
id: BR-CO-16
title: Amount due does not match total with VAT minus prepaid
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) - Paid amount (BT-113) + Rounding amount (BT-114).
bt: BT-115, BT-112, BT-113, BT-114
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-115, the **amount due for payment**, must equal the total with VAT
(BT-112) minus any amount already paid (BT-113) plus a rounding amount
(BT-114) used to round the payable amount to the currency's smallest unit.
On most invoices there is no prepayment and no rounding, so BT-115 simply
equals BT-112 — this rule exists for the cases where that's not true.

## Common causes

- **Prepayment not subtracted.** A deposit or advance payment is recorded in
  BT-113 (often alongside a reference to the prepayment invoice) but the
  payable amount is still set to the full BT-112, so the customer is asked to
  pay twice for the prepaid part.
- **Sign error on BT-113.** Like the allowance/charge fields elsewhere, the
  paid amount must be positive; the formula subtracts it. A negative BT-113
  adds the prepayment back on top of the total instead of deducting it.
- **Rounding amount used to paper over an unrelated bug.** BT-114 exists for
  genuine currency-rounding (e.g. rounding to the nearest 0.05 in cash
  settlement), not as a fudge factor to force BT-115 to match an otherwise
  wrong BT-112 — using it that way just relocates the real bug.

## How to fix it

- **UBL**: `cac:LegalMonetaryTotal/cbc:PayableAmount` =
  `cbc:TaxInclusiveAmount` − `cbc:PrepaidAmount` + `cbc:PayableRoundingAmount`
  (the latter two default to 0.00 when absent).
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount`
  = `ram:GrandTotalAmount` − `ram:TotalPrepaidAmount` + `ram:RoundingAmount`.

## Example

### UBL — wrong

```xml
<cac:LegalMonetaryTotal>
  <cbc:TaxInclusiveAmount currencyID="EUR">1404.20</cbc:TaxInclusiveAmount>
  <cbc:PrepaidAmount currencyID="EUR">500.00</cbc:PrepaidAmount>
  <cbc:PayableAmount currencyID="EUR">1404.20</cbc:PayableAmount>  <!-- deposit not deducted -->
</cac:LegalMonetaryTotal>
```

### UBL — correct

```xml
<cac:LegalMonetaryTotal>
  <cbc:TaxInclusiveAmount currencyID="EUR">1404.20</cbc:TaxInclusiveAmount>
  <cbc:PrepaidAmount currencyID="EUR">500.00</cbc:PrepaidAmount>
  <cbc:PayableAmount currencyID="EUR">904.20</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
```

### CII — correct

```xml
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:GrandTotalAmount>1404.20</ram:GrandTotalAmount>
  <ram:TotalPrepaidAmount>500.00</ram:TotalPrepaidAmount>
  <ram:DuePayableAmount>904.20</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
