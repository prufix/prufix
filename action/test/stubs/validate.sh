#!/usr/bin/env bash
# Stub engine for local action tests. Honours the CLI/exit-code contract
# (contract section 3) only -- the real engine lives in /app/engine and is
# built by another agent. Behaviour is keyed off the input file name:
#   *toolfail* -> exit 3   (tool failure)
#   *bad-xml*  -> exit 2   (unparseable input)
#   *errors*   -> SVRL with 1 error + 1 warning
#   *warnonly* -> SVRL with 1 warning
#   otherwise  -> empty SVRL (no findings)
#
# --out-source (contract 3.1 / 9.28): written unconditionally on every
# successful (exit 0) run, as a copy of --input. The real engine writes the
# XML it actually validated (a copy for XML input, the extracted part for
# facturx PDF input); a plain copy is enough to exercise the *path* that the
# caller must use, which is what the action-side tests check.
set -u

profile=""
input=""
out=""
out_source=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile="$2"; shift 2 ;;
    --input) input="$2"; shift 2 ;;
    --out-svrl) out="$2"; shift 2 ;;
    --out-source) out_source="$2"; shift 2 ;;
    *) echo "stub-engine: unknown argument: $1" >&2; exit 3 ;;
  esac
done

if [ -z "$profile" ] || [ -z "$input" ] || [ -z "$out" ]; then
  echo "stub-engine: missing required arguments" >&2
  exit 3
fi

case "$profile" in
  en16931|peppol-bis-3.0.21|xrechnung-3.0.2|facturx|auto) ;;
  *) echo "stub-engine: unknown profile: $profile" >&2; exit 3 ;;
esac

if [ ! -f "$input" ]; then
  echo "stub-engine: input file not found: $input" >&2
  exit 3
fi

base="$(basename "$input")"
echo "stub-engine: validating $base with $profile" >&2

case "$base" in
  *toolfail*)
    echo "stub-engine: simulated tool failure (missing dependency)" >&2
    exit 3
    ;;
  *bad-xml*)
    echo "stub-engine: input is not well-formed XML" >&2
    exit 2
    ;;
  *errors*)
    cat > "$out" <<'SVRL'
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert id="BR-CO-13" location="/ubl:Invoice[1]/cac:LegalMonetaryTotal[1]">
    <svrl:text>[BR-CO-13] Invoice total amount without VAT (BT-109) = sum of Invoice line net amount (BT-131) - sum of Document level allowance amount (BT-92) + sum of Document level charge amount (BT-99).</svrl:text>
  </svrl:failed-assert>
  <svrl:failed-assert id="PEPPOL-EN16931-R008" flag="warning" location="/ubl:Invoice[1]">
    <svrl:text>[PEPPOL-EN16931-R008] Document MUST not contain empty elements.</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>
SVRL
    ;;
  *warnonly*)
    cat > "$out" <<'SVRL'
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert id="PEPPOL-EN16931-R008" flag="warning" location="/ubl:Invoice[1]">
    <svrl:text>[PEPPOL-EN16931-R008] Document MUST not contain empty elements.</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>
SVRL
    ;;
  *)
    cat > "$out" <<'SVRL'
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
</svrl:schematron-output>
SVRL
    ;;
esac

if [ -n "$out_source" ]; then
  cp "$input" "$out_source"
fi

exit 0
