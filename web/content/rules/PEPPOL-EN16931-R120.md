---
id: PEPPOL-EN16931-R120
title: Line net amount does not match quantity times price
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Invoice line net amount MUST equal (Invoiced quantity * (Item net price / item price base quantity) + Sum of invoice line charge amount - sum of invoice line allowance amount).
bt: BT-131, BT-129, BT-146, BT-149, BT-141, BT-136
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

This is the line-level counterpart to `BR-CO-13`: the line net amount
(BT-131) must equal quantity × (price ÷ base quantity), plus any line-level
charges, minus any line-level allowances. Unlike the header rules, this one
is Peppol-specific — plain EN 16931 doesn't fix an exact formula for line
net amount, but Peppol does. It runs once per line.

This is a Peppol BIS Billing 3.0 addition (UBL-only); there is no CII
binding for this rule.

## Common causes

- **Base quantity ignored.** When an item is priced per a base quantity
  other than 1 (e.g. €12.50 per 100 units), the line net amount must be
  `quantity × (price / base quantity)`, not `quantity × price`. Multiplying
  quantity by price directly, without dividing by the base quantity,
  overstates the line total by exactly a factor of the base quantity.
- **Line-level allowances/charges applied at the wrong level, or not at
  all.** Line-level `AllowanceCharge` elements belong *inside* BT-131 —
  unlike document-level allowances/charges (`BR-CO-13`), which are applied
  *after* the line totals are already summed. A line discount recorded but
  not subtracted from BT-131 (or subtracted a second time at the document
  level) both fail this rule or `BR-CO-13`, depending on which step is
  wrong.
- **Rounding the gross line amount before applying charges/allowances**,
  instead of after — small enough to be a one-cent difference, but real:
  round `quantity × price / baseQty` to two decimals first, then apply
  line-level charges and allowances on top.

## How to fix it

Compute, per line: `round(quantity × price ÷ baseQuantity, 2) + Σ line
charges − Σ line allowances`, using `baseQuantity = 1` when
`cbc:BaseQuantity` is absent.

## Example

### Wrong

```xml
<cac:InvoiceLine>
  <cbc:ID>1</cbc:ID>
  <cbc:InvoicedQuantity unitCode="C62">50</cbc:InvoicedQuantity>
  <cbc:LineExtensionAmount currencyID="EUR">625.00</cbc:LineExtensionAmount>  <!-- 50 x 12.50, base qty ignored -->
  <cac:Item>
    <cbc:Name>Widgets</cbc:Name>
  </cac:Item>
  <cac:Price>
    <cbc:PriceAmount currencyID="EUR">12.50</cbc:PriceAmount>
    <cbc:BaseQuantity unitCode="C62">100</cbc:BaseQuantity>  <!-- price is per 100 units -->
  </cac:Price>
</cac:InvoiceLine>
```

### Correct

```xml
<cac:InvoiceLine>
  <cbc:ID>1</cbc:ID>
  <cbc:InvoicedQuantity unitCode="C62">50</cbc:InvoicedQuantity>
  <cbc:LineExtensionAmount currencyID="EUR">6.25</cbc:LineExtensionAmount>  <!-- 50 x (12.50 / 100) -->
  <cac:Item>
    <cbc:Name>Widgets</cbc:Name>
  </cac:Item>
  <cac:Price>
    <cbc:PriceAmount currencyID="EUR">12.50</cbc:PriceAmount>
    <cbc:BaseQuantity unitCode="C62">100</cbc:BaseQuantity>
  </cac:Price>
</cac:InvoiceLine>
```
