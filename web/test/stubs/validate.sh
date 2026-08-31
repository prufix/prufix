#!/usr/bin/env bash
# Stub engine for local web-server tests (mirrors app/action/test/stubs's
# convention). Honours the CLI/exit-code contract (contract section 3) only
# -- the real engine lives in /app/engine and is built by another agent.
#
# Behaviour is keyed off the --profile value, OR (since the web server
# writes inputs under random names and only accepts the 5 contract profile
# ids) off a marker as the input's first line:
#   profile stub-toolfail / body starts with TRIGGER-TOOLFAIL -> exit 3
#   profile stub-badinput / body starts with TRIGGER-BADINPUT -> exit 2
#   anything else  -> exit 0; writes $STUB_SVRL_FIXTURE to --out-svrl if that
#                     env var is set, else an empty schematron-output; and
#                     writes $STUB_SOURCE_FIXTURE to --out-source if that env
#                     var is set, else a verbatim copy of --input (contract
#                     §3.1/§9.28: --out-source is always written).
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

if [ -z "$profile" ] || [ -z "$input" ] || [ -z "$out" ] || [ -z "$out_source" ]; then
  echo "stub-engine: missing required arguments (--out-source is mandatory per contract §9.28)" >&2
  exit 3
fi

if [ ! -f "$input" ]; then
  echo "stub-engine: input file not found: $input" >&2
  exit 3
fi

echo "stub-engine: validating with profile $profile" >&2

case "$profile" in
  stub-toolfail)
    echo "stub-engine: simulated tool failure (missing dependency)" >&2
    exit 3
    ;;
  stub-badinput)
    echo "stub-engine: error: input is not well-formed XML" >&2
    exit 2
    ;;
esac

FIRST_LINE="$(head -c 32 "$input")"
case "$FIRST_LINE" in
  TRIGGER-TOOLFAIL*)
    echo "stub-engine: simulated tool failure (missing dependency)" >&2
    exit 3
    ;;
  TRIGGER-BADINPUT*)
    echo "stub-engine: error: input is not well-formed XML" >&2
    exit 2
    ;;
esac

if [ -n "${STUB_SVRL_FIXTURE:-}" ] && [ -f "$STUB_SVRL_FIXTURE" ]; then
  cp "$STUB_SVRL_FIXTURE" "$out"
else
  cat > "$out" <<'SVRL'
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
</svrl:schematron-output>
SVRL
fi

if [ -n "${STUB_SOURCE_FIXTURE:-}" ] && [ -f "$STUB_SOURCE_FIXTURE" ]; then
  cp "$STUB_SOURCE_FIXTURE" "$out_source"
else
  cp "$input" "$out_source"
fi

exit 0
