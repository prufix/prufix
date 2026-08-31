---
id: PEPPOL-EN16931-R121
title: Price base quantity must be above zero
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Base quantity MUST be a positive number above zero.
bt: BT-149
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

BT-149, the item price base quantity, is the denominator in the line net
amount formula checked by `PEPPOL-EN16931-R120`
(`quantity × price ÷ baseQuantity`). It must be strictly greater than zero —
a base quantity of 0 makes that formula divide by zero, and a negative one
is meaningless.

This is a Peppol BIS Billing 3.0 addition (UBL-only); there is no CII
binding for this rule.

## Common causes

- **`BaseQuantity` set to `0` by a field default** where the intent was "no
  base quantity, price is per unit" — the correct way to express that is to
  *omit* the element entirely (it then defaults to 1 for the formula in
  `PEPPOL-EN16931-R120`), not to write `0`.
- **A negative base quantity** copied from a signed adjustment field
  elsewhere in the system — base quantity is a pricing basis, not a
  transaction amount, and never carries a sign.
- **Unit conversion bug** that divides a positive base quantity by another
  factor and produces zero due to integer division somewhere upstream.

## How to fix it

Either omit `cbc:BaseQuantity` (implying 1) or set it to a positive number
matching how the price is actually quoted (e.g. `100` for "€12.50 per 100
units").

## Example

### Wrong

```xml
<cac:Price>
  <cbc:PriceAmount currencyID="EUR">12.50</cbc:PriceAmount>
  <cbc:BaseQuantity unitCode="C62">0</cbc:BaseQuantity>
</cac:Price>
```

### Correct

```xml
<cac:Price>
  <cbc:PriceAmount currencyID="EUR">12.50</cbc:PriceAmount>
  <!-- price is per single unit: omit BaseQuantity entirely -->
</cac:Price>
```

or, if the price genuinely applies per 100 units:

```xml
<cac:Price>
  <cbc:PriceAmount currencyID="EUR">12.50</cbc:PriceAmount>
  <cbc:BaseQuantity unitCode="C62">100</cbc:BaseQuantity>
</cac:Price>
```
