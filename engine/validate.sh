#!/usr/bin/env bash
# prufix engine: run official validation artifacts over one input file
# and write a plain svrl:schematron-output document.
#
# Usage:
#   validate.sh --profile <id> --input <path> --out-svrl <path> [--out-source <path>]
#
# --out-source (interface contract §3.1): when given, the engine writes the
# XML document it actually validated to that path -- a byte-identical copy of
# the input for XML input, or the extracted embedded XML for PDF (facturx)
# input. Always written when the flag is passed, not only for PDF input.
#
# Exit codes (interface contract §3.3):
#   0  validation executed (regardless of whether violations were found)
#   2  input broken as XML/PDF, or failed XML Schema before Schematron
#   3  tool-side failure (unknown profile, missing artifacts, ...)
#
# stdout stays silent; progress and warnings go to stderr.

set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$ENGINE_DIR")"
PROFILES_JSON="$ENGINE_DIR/profiles.json"
MERGE_XSL="$ENGINE_DIR/merge-svrl.xsl"

log()       { echo "engine: $*" >&2; }
die_input() { log "error: $*"; exit 2; }
die_tool()  { log "error: $*"; exit 3; }

# --- read a value out of profiles.json ------------------------------------
# pj <key> <key> ... -> prints scalar, or one array item per line; rc=1 if absent
pj() {
  node -e '
    const fs = require("fs");
    let cur = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const k of process.argv.slice(2)) {
      cur = cur === undefined || cur === null ? undefined : cur[k];
    }
    if (cur === undefined || cur === null) process.exit(1);
    if (Array.isArray(cur)) console.log(cur.join("\n"));
    else if (typeof cur === "object") console.log(JSON.stringify(cur));
    else console.log(String(cur));
  ' "$PROFILES_JSON" "$@"
}

# --- argument parsing ------------------------------------------------------
PROFILE="" INPUT="" OUT_SVRL="" OUT_SOURCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)    PROFILE="${2:-}"; shift 2 ;;
    --input)      INPUT="${2:-}"; shift 2 ;;
    --out-svrl)   OUT_SVRL="${2:-}"; shift 2 ;;
    --out-source) OUT_SOURCE="${2:-}"; shift 2 ;;
    *) die_tool "unknown argument: $1" ;;
  esac
done
[ -n "$PROFILE" ] && [ -n "$INPUT" ] && [ -n "$OUT_SVRL" ] \
  || die_tool "usage: validate.sh --profile <id> --input <path> --out-svrl <path> [--out-source <path>]"
[ -f "$INPUT" ] || die_tool "input file not found: $INPUT"
[ -f "$PROFILES_JSON" ] || die_tool "profiles.json not found: $PROFILES_JSON"

command -v node >/dev/null || die_tool "node not found on PATH"
command -v xmllint >/dev/null || die_tool "xmllint not found on PATH"
command -v java >/dev/null || die_tool "java not found on PATH"

SAXON_CP_REL="$(pj tools saxonClasspath)" || die_tool "tools.saxonClasspath missing"
# expand each classpath entry relative to APP_DIR
SAXON_CP=""
IFS=':' read -ra _cp <<< "$SAXON_CP_REL"
for e in "${_cp[@]}"; do
  [ -f "$APP_DIR/$e" ] || die_tool "missing tool jar: $APP_DIR/$e"
  SAXON_CP="${SAXON_CP:+$SAXON_CP:}$APP_DIR/$e"
done
saxon() { java -cp "$SAXON_CP" net.sf.saxon.Transform "$@"; }

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

# --- resolve profile (alias, auto, facturx) --------------------------------
if [ "$PROFILE" != "auto" ]; then
  pj profiles "$PROFILE" >/dev/null 2>&1 || die_tool "unknown profile: $PROFILE"
  ALIAS_OF="$(pj profiles "$PROFILE" aliasOf 2>/dev/null || true)"
  if [ -n "$ALIAS_OF" ]; then
    W="$(pj profiles "$PROFILE" warning 2>/dev/null || true)"
    [ -n "$W" ] && log "warning: $W"
    PROFILE="$ALIAS_OF"
  fi
fi

is_pdf() { [ "$(head -c 4 "$1")" = "%PDF" ]; }

# facturx: extract the embedded XML from the PDF/A-3, then continue on it
extract_pdf() {
  local pdf="$1"
  is_pdf "$pdf" || die_input "input is not a PDF file"
  command -v pdfdetach >/dev/null || die_tool "pdfdetach not found on PATH"
  local list
  list="$(pdfdetach -list "$pdf" 2>/dev/null)" \
    || die_input "cannot read embedded files from PDF (not a valid PDF?)"
  local names num name found=""
  while IFS= read -r cand; do
    # list lines look like "1: factur-x.xml"
    num="$(printf '%s\n' "$list" | grep -i ": ${cand}\$" | head -1 | cut -d: -f1 | tr -d ' ')" || true
    if [ -n "$num" ]; then found="$num"; break; fi
  done < <(pj profiles facturx embeddedNames)
  [ -n "$found" ] || die_input "no known e-invoice attachment found in PDF (looked for: $(pj profiles facturx embeddedNames | tr '\n' ' '))"
  pdfdetach -save "$found" -o "$TMPD/embedded.xml" "$pdf" 2>/dev/null \
    || die_input "failed to extract embedded XML from PDF"
  printf '%s\n' "$TMPD/embedded.xml"
}

if [ "$PROFILE" = "facturx" ]; then
  INPUT="$(extract_pdf "$INPUT")"
  PROFILE="$(pj profiles facturx then)"
  log "extracted embedded XML from PDF; continuing with profile $PROFILE"
elif [ "$PROFILE" = "auto" ]; then
  if is_pdf "$INPUT"; then
    INPUT="$(extract_pdf "$INPUT")"
    PROFILE="$(pj profiles facturx then)"
    log "auto: PDF input; extracted embedded XML; continuing with profile $PROFILE"
  fi
elif is_pdf "$INPUT"; then
  die_tool "profile $PROFILE takes XML input, got a PDF (use profile facturx or auto)"
fi

# --- write out the source XML actually validated (contract §3.1) ----------
# Always written when --out-source is passed, XML input or PDF input alike.
# Written via a temp file inside $TMPD + mv so a killed run never leaves a
# half-written file at the destination.
if [ -n "$OUT_SOURCE" ]; then
  mkdir -p "$(dirname "$OUT_SOURCE")"
  cp "$INPUT" "$TMPD/out-source.xml"
  mv "$TMPD/out-source.xml" "$OUT_SOURCE"
  log "wrote validated source XML to $OUT_SOURCE"
fi

# --- document type detection ----------------------------------------------
xmllint --noout --nonet "$INPUT" 2>"$TMPD/wf.err" \
  || { sed 's/^/engine: /' "$TMPD/wf.err" >&2; die_input "input is not well-formed XML"; }

ROOT_INFO="$(xmllint --nonet --xpath 'concat(local-name(/*)," ",namespace-uri(/*))' "$INPUT")"
ROOT_LOCAL="${ROOT_INFO%% *}"
ROOT_NS="${ROOT_INFO#* }"

DOCTYPE=""
for dt in $(pj documentTypes | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s)).join("\n")))'); do
  if [ "$(pj documentTypes "$dt" rootLocalName)" = "$ROOT_LOCAL" ] \
  && [ "$(pj documentTypes "$dt" rootNamespace)" = "$ROOT_NS" ]; then
    DOCTYPE="$dt"; break
  fi
done
[ -n "$DOCTYPE" ] || die_input "unsupported document root: {$ROOT_NS}$ROOT_LOCAL (expected UBL Invoice, UBL CreditNote, or CII CrossIndustryInvoice)"
log "document type: $DOCTYPE"

# --- auto profile: pick by customization identifier ------------------------
if [ "$PROFILE" = "auto" ]; then
  case "$DOCTYPE" in
    cii) CUST="$(xmllint --nonet --xpath "string(/*/*[local-name()='ExchangedDocumentContext']/*[local-name()='GuidelineSpecifiedDocumentContextParameter']/*[local-name()='ID'])" "$INPUT")" ;;
    *)   CUST="$(xmllint --nonet --xpath "string(/*/*[local-name()='CustomizationID'])" "$INPUT")" ;;
  esac
  PICKED=""
  while IFS=$'\t' read -r sub prof; do
    case "$CUST" in *"$sub"*) PICKED="$prof"; break ;; esac
  done < <(node -e '
    const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const r of p.autoDetect.customizationContains)
      console.log(r.substring + "\t" + r.profile);
  ' "$PROFILES_JSON")
  [ -n "$PICKED" ] || die_tool "auto: cannot determine profile from customization identifier '$CUST'"
  PROFILE="$PICKED"
  log "auto: detected profile $PROFILE"
fi

ENGINE="$(pj profiles "$PROFILE" engine)" || die_tool "profile $PROFILE has no engine"

# --- XML Schema gate -------------------------------------------------------
XSD_REL="$(pj documentTypes "$DOCTYPE" xsd)"
XSD="$APP_DIR/$XSD_REL"
[ -f "$XSD" ] || die_tool "missing XSD: $XSD"
set +e
xmllint --noout --nonet --schema "$XSD" "$INPUT" 2>"$TMPD/xsd.err"
XSD_RC=$?
set -e
if [ "$XSD_RC" -ne 0 ]; then
  if [ "$XSD_RC" -ge 5 ]; then
    sed 's/^/engine: /' "$TMPD/xsd.err" >&2
    die_tool "XML Schema could not be loaded (rc=$XSD_RC)"
  fi
  sed 's/^/engine: /' "$TMPD/xsd.err" >&2
  die_input "XML Schema validation failed"
fi
log "XML Schema validation passed ($DOCTYPE)"

# --- run the validation pipeline ------------------------------------------
mkdir -p "$(dirname "$OUT_SVRL")"
MERGE_ARGS=()

case "$ENGINE" in
  kosit)
    JAR="$APP_DIR/$(pj profiles "$PROFILE" validatorJar)"
    SCEN="$APP_DIR/$(pj profiles "$PROFILE" scenarios)"
    REPO="$APP_DIR/$(pj profiles "$PROFILE" repository)"
    OVR="$APP_DIR/$(pj profiles "$PROFILE" overrides)"
    for f in "$JAR" "$SCEN" "$OVR"; do
      [ -f "$f" ] || die_tool "missing artifact: $f"
    done
    cp "$INPUT" "$TMPD/in.xml"
    set +e
    ( cd "$TMPD" && java -jar "$JAR" -s "$SCEN" -r "$REPO" \
        --serialize-report-input -o "$TMPD" in.xml ) \
        >"$TMPD/kosit.log" 2>&1
    set -e
    RI="$TMPD/in-reportInput.xml"
    if [ ! -f "$RI" ]; then
      sed 's/^/engine: kosit: /' "$TMPD/kosit.log" >&2
      die_tool "KoSIT validator produced no report input"
    fi
    N_SVRL="$(xmllint --nonet --xpath 'count(//*[local-name()="schematron-output"])' "$RI")"
    if [ "$N_SVRL" -lt 1 ]; then
      N_ERR="$(xmllint --nonet --xpath 'count(//*[local-name()="xmlSyntaxError"]) + count(//*[local-name()="processingError"])' "$RI")"
      if [ "$N_ERR" -gt 0 ]; then
        die_input "document failed before Schematron (parser or XML Schema stage in KoSIT validator)"
      fi
      die_input "no validation scenario matched this document (is it an XRechnung/EN16931 invoice?)"
    fi
    SCENARIO_NAME="$(xmllint --nonet --xpath "string(/*/*[local-name()='scenario']/*[local-name()='name'])" "$RI")"
    log "KoSIT scenario: ${SCENARIO_NAME:-<none>}; $N_SVRL schematron step(s)"
    printf '<merge><svrl href="%s"/></merge>\n' "$RI" > "$TMPD/files.xml"
    MERGE_ARGS=("overrides-uri=$OVR" "scenario=$SCENARIO_NAME")
    ;;
  schematron)
    XSLTS="$(pj profiles "$PROFILE" xslt "$DOCTYPE")" \
      || die_tool "profile $PROFILE does not support document type $DOCTYPE"
    : > "$TMPD/list.txt"
    i=0
    while IFS= read -r x; do
      [ -f "$APP_DIR/$x" ] || die_tool "missing artifact: $APP_DIR/$x"
      i=$((i+1))
      saxon -xsl:"$APP_DIR/$x" -s:"$INPUT" -o:"$TMPD/step$i.svrl" 2>>"$TMPD/saxon.err" \
        || { sed 's/^/engine: saxon: /' "$TMPD/saxon.err" >&2; die_tool "Schematron XSLT failed: $x"; }
      printf '%s/step%d.svrl\n' "$TMPD" "$i" >> "$TMPD/list.txt"
      log "ran $(basename "$x")"
    done <<< "$XSLTS"
    {
      printf '<merge>'
      while IFS= read -r f; do printf '<svrl href="%s"/>' "$f"; done < "$TMPD/list.txt"
      printf '</merge>\n'
    } > "$TMPD/files.xml"
    ;;
  *)
    die_tool "unknown engine '$ENGINE' for profile $PROFILE"
    ;;
esac

saxon -xsl:"$MERGE_XSL" -s:"$TMPD/files.xml" -o:"$TMPD/merged.svrl" ${MERGE_ARGS[@]+"${MERGE_ARGS[@]}"} \
  2>"$TMPD/merge.err" \
  || { sed 's/^/engine: merge: /' "$TMPD/merge.err" >&2; die_tool "SVRL merge failed"; }

mv "$TMPD/merged.svrl" "$OUT_SVRL"
N_FAIL="$(xmllint --nonet --xpath 'count(//*[local-name()="failed-assert"])' "$OUT_SVRL")"
N_REP="$(xmllint --nonet --xpath 'count(//*[local-name()="successful-report"])' "$OUT_SVRL")"
log "done: profile=$PROFILE failed-asserts=$N_FAIL successful-reports=$N_REP"
exit 0
