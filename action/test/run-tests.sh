#!/usr/bin/env bash
# Local tests for the action wrapper, run against the stub engine/formatter
# in test/stubs/ -- no Docker and no real validation artifacts needed.
#
#   bash app/action/test/run-tests.sh
#
# Works on Linux and on Windows Git Bash (paths are converted with cygpath
# where present, because the driver runs under native Node).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION_DIR="$(cd "$HERE/.." && pwd)"

winpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

TMP_ROOT="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

# ---- test workspace ------------------------------------------------------
WORK="$TMP_ROOT/workspace"
mkdir -p "$WORK/invoices/sub" "$WORK/other"
printf '<Invoice/>' > "$WORK/invoices/clean-a.xml"
printf '<Invoice/>' > "$WORK/invoices/sub/clean-b.xml"
printf '<Invoice/>' > "$WORK/invoices/errors-b.xml"
printf 'not-xml'    > "$WORK/invoices/bad-xml-c.xml"
printf '<Invoice/>' > "$WORK/invoices/toolfail-d.xml"
printf '<Invoice/>' > "$WORK/invoices/warnonly-e.xml"
printf '<Invoice/>' > "$WORK/other/clean-z.xml"
printf '{"pull_request":{"number":7}}' > "$TMP_ROOT/event.json"

# ---- tiny assertion helpers ---------------------------------------------
PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }

assert_eq() { # actual expected label
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2', got '$1')"; fi
}
assert_contains() { # haystack needle label
  if printf '%s' "$1" | grep -qF -- "$2"; then ok "$3"; else bad "$3 (missing '$2')"; fi
}
assert_not_contains() { # haystack needle label
  if printf '%s' "$1" | grep -qF -- "$2"; then bad "$3 (unexpectedly contains '$2')"; else ok "$3"; fi
}

# ---- action invocation ---------------------------------------------------
# run_action <name> [VAR=VALUE ...]
# Later VAR=VALUE entries override the base ones, so tests can override
# INPUT_COMMENT, GITHUB_EVENT_NAME, etc.
run_action() {
  local name="$1"
  shift
  OUT_FILE="$(winpath "$TMP_ROOT/out_$name")"
  SUM_FILE="$(winpath "$TMP_ROOT/sum_$name")"
  : > "$OUT_FILE"
  : > "$SUM_FILE"
  local log_file="$TMP_ROOT/log_$name"
  env \
    GITHUB_WORKSPACE="$(winpath "$WORK")" \
    GITHUB_OUTPUT="$OUT_FILE" \
    GITHUB_STEP_SUMMARY="$SUM_FILE" \
    GITHUB_EVENT_NAME="push" \
    GITHUB_EVENT_PATH="" \
    GITHUB_TOKEN="" \
    GITHUB_API_URL="" \
    GITHUB_REPOSITORY="" \
    EINVOICE_TMPDIR="$(winpath "$TMP_ROOT")" \
    EINVOICE_ENGINE="bash $(winpath "$HERE/stubs/validate.sh")" \
    EINVOICE_FORMATTER="node $(winpath "$HERE/stubs/formatter-cli.js")" \
    EINVOICE_ACTION_MAIN="$(winpath "$ACTION_DIR/src/main.js")" \
    INPUT_PROFILE="auto" \
    INPUT_COMMENT="false" \
    "$@" \
    bash "$ACTION_DIR/entrypoint.sh" > "$log_file" 2>&1
  EXIT_CODE=$?
  LOG="$(cat "$log_file")"
}

output() { # name key
  node "$HERE/read-output.js" "$TMP_ROOT/out_$1" "$2" 2>/dev/null
}

report_query() { # name node-expression over parsed report `r`
  local name="$1" expr="$2"
  output "$name" report | node -e "
    let s = '';
    process.stdin.on('data', (c) => (s += c));
    process.stdin.on('end', () => { const r = JSON.parse(s); process.stdout.write(String($expr)); });
  "
}

# =========================================================================
echo "T1: clean files, fail-on=error -> exit 0, clean outputs"
run_action t1 INPUT_PATH='invoices/clean-a.xml
invoices/sub/clean-b.xml' 'INPUT_FAIL-ON=error'
assert_eq "$EXIT_CODE" "0" "T1 exit code 0"
assert_eq "$(output t1 errors)" "0" "T1 errors output"
assert_eq "$(output t1 warnings)" "0" "T1 warnings output"
assert_eq "$(output t1 files-checked)" "2" "T1 files-checked output"
assert_eq "$(output t1 passed)" "true" "T1 passed output"
assert_contains "$(cat "$TMP_ROOT/sum_t1")" "No findings" "T1 summary says no findings"

echo "T2: findings, fail-on=error -> exit 1, merged report"
run_action t2 INPUT_PATH='invoices/clean-a.xml
invoices/errors-b.xml' 'INPUT_FAIL-ON=error'
assert_eq "$EXIT_CODE" "1" "T2 exit code 1"
assert_eq "$(output t2 errors)" "1" "T2 errors output"
assert_eq "$(output t2 warnings)" "1" "T2 warnings output"
assert_eq "$(output t2 passed)" "false" "T2 passed output"
assert_eq "$(report_query t2 'r.files.length')" "2" "T2 report has both files"
assert_eq "$(report_query t2 'r.summary.errors')" "1" "T2 report summary errors"
assert_eq "$(report_query t2 'r.schemaVersion')" "1" "T2 report schemaVersion"
assert_contains "$(cat "$TMP_ROOT/sum_t2")" "BR-CO-13" "T2 summary table lists the rule"
assert_contains "$(cat "$TMP_ROOT/sum_t2")" "<details>" "T2 summary collapses detail"
assert_contains "$LOG" "fail-on: error" "T2 log explains the failure"

echo "T3: warnings only -> fail-on=error passes, fail-on=warning fails"
run_action t3a INPUT_PATH='invoices/warnonly-e.xml' 'INPUT_FAIL-ON=error'
assert_eq "$EXIT_CODE" "0" "T3 fail-on=error exit 0"
assert_eq "$(output t3a passed)" "true" "T3 passed=true with warnings only"
run_action t3b INPUT_PATH='invoices/warnonly-e.xml' 'INPUT_FAIL-ON=warning'
assert_eq "$EXIT_CODE" "1" "T3 fail-on=warning exit 1"

echo "T4: errors with fail-on=never -> exit 0, findings still reported"
run_action t4 INPUT_PATH='invoices/errors-b.xml' 'INPUT_FAIL-ON=never'
assert_eq "$EXIT_CODE" "0" "T4 exit code 0"
assert_eq "$(output t4 errors)" "1" "T4 errors still counted"

echo "T5: zero glob matches -> clear failure"
run_action t5 INPUT_PATH='no/such/**/*.xml' 'INPUT_FAIL-ON=error'
assert_eq "$EXIT_CODE" "1" "T5 exit code 1"
assert_contains "$LOG" "No files matched" "T5 message is explicit"

echo "T6: engine exit 2 (bad input) -> finding recorded, run continues"
run_action t6 INPUT_PATH='invoices/bad-xml-c.xml
invoices/clean-a.xml' 'INPUT_FAIL-ON=error'
assert_eq "$EXIT_CODE" "1" "T6 exit code 1 (bad file is an error)"
assert_eq "$(output t6 files-checked)" "2" "T6 both files in the report"
assert_eq "$(output t6 errors)" "1" "T6 one error"
assert_contains "$(report_query t6 'JSON.stringify(r.files.map(f=>f.findings.map(x=>x.id)))')" "INPUT-INVALID" "T6 synthetic finding present"

echo "T7: engine exit 3 (tool failure) -> abort, exit 1 even with fail-on=never"
run_action t7 INPUT_PATH='invoices/clean-a.xml
invoices/toolfail-d.xml' 'INPUT_FAIL-ON=never'
assert_eq "$EXIT_CODE" "1" "T7 exit code 1 despite fail-on=never"
assert_contains "$LOG" "regardless of fail-on" "T7 abort message is loud"
assert_contains "$LOG" "exit code 3" "T7 names the engine exit code"

echo "T8: invalid profile / fail-on rejected up front"
run_action t8a INPUT_PATH='invoices/clean-a.xml' INPUT_PROFILE='bogus'
assert_eq "$EXIT_CODE" "1" "T8 bad profile exit 1"
assert_contains "$LOG" "Unknown profile" "T8 bad profile message"
run_action t8b INPUT_PATH='invoices/clean-a.xml' 'INPUT_FAIL-ON=sometimes'
assert_eq "$EXIT_CODE" "1" "T8 bad fail-on exit 1"
assert_contains "$LOG" "Unknown fail-on" "T8 bad fail-on message"

echo "T9: PR comment -> created once, then updated in place"
node "$HERE/fake-github.js" "$TMP_ROOT/api.log" > "$TMP_ROOT/server.out" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  grep -q '^PORT=' "$TMP_ROOT/server.out" 2>/dev/null && break
  sleep 0.1
done
PORT="$(sed -n 's/^PORT=//p' "$TMP_ROOT/server.out")"
if [ -z "$PORT" ]; then
  bad "T9 fake GitHub server did not start"
else
  pr_env=(
    INPUT_COMMENT="true"
    GITHUB_EVENT_NAME="pull_request"
    GITHUB_EVENT_PATH="$(winpath "$TMP_ROOT/event.json")"
    GITHUB_TOKEN="test-token"
    GITHUB_API_URL="http://127.0.0.1:$PORT"
    GITHUB_REPOSITORY="acme/demo"
  )
  run_action t9a INPUT_PATH='invoices/errors-b.xml' 'INPUT_FAIL-ON=never' "${pr_env[@]}"
  assert_contains "$LOG" "created a PR comment" "T9 first run creates"
  run_action t9b INPUT_PATH='invoices/errors-b.xml' 'INPUT_FAIL-ON=never' "${pr_env[@]}"
  assert_contains "$LOG" "updated the existing PR comment" "T9 second run updates"
  COMMENTS="$(curl -s "http://127.0.0.1:$PORT/__comments")"
  assert_eq "$(printf '%s' "$COMMENTS" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(s).length)))')" "1" "T9 exactly one comment exists"
  assert_contains "$COMMENTS" "prufix:report" "T9 comment carries the marker"
  API_CALLS="$(cat "$TMP_ROOT/api.log")"
  assert_contains "$API_CALLS" "POST /repos/acme/demo/issues/7/comments" "T9 POST happened once"
  assert_contains "$API_CALLS" "PATCH /repos/acme/demo/issues/comments/1" "T9 PATCH happened"
fi

echo "T10: comment=true outside a PR event -> silent skip"
run_action t10 INPUT_PATH='invoices/errors-b.xml' 'INPUT_FAIL-ON=never' INPUT_COMMENT="true" GITHUB_EVENT_NAME="push"
assert_eq "$EXIT_CODE" "0" "T10 exit unaffected"
assert_contains "$LOG" "not a pull request event" "T10 skip is logged, not warned"
assert_not_contains "$LOG" "::warning" "T10 no warning for a normal skip"

echo "T11: comment=true on a PR but no token -> warn, do not fail"
run_action t11 INPUT_PATH='invoices/errors-b.xml' 'INPUT_FAIL-ON=never' \
  INPUT_COMMENT="true" GITHUB_EVENT_NAME="pull_request" \
  GITHUB_EVENT_PATH="$(winpath "$TMP_ROOT/event.json")" GITHUB_TOKEN=""
assert_eq "$EXIT_CODE" "0" "T11 exit unaffected"
assert_contains "$LOG" "::warning" "T11 warning emitted"
assert_contains "$LOG" "no token" "T11 warning names the cause"

echo "T12: multiple glob patterns, one per line"
run_action t12 INPUT_PATH='invoices/sub/*.xml
other/*.xml' 'INPUT_FAIL-ON=error'
assert_eq "$EXIT_CODE" "0" "T12 exit code 0"
assert_eq "$(output t12 files-checked)" "2" "T12 both patterns matched"

echo "T13: outputs are written in heredoc form"
assert_contains "$(cat "$TMP_ROOT/out_t2")" "report<<EINVOICE_EOF_" "T13 heredoc delimiter used"

echo "T14: --source is the engine's --out-source file, --path is the real input (contract 3.1/9.28/9.31)"
SRC_LOG="$TMP_ROOT/src_log_t14"
: > "$SRC_LOG"
run_action t14 INPUT_PATH='invoices/clean-a.xml
invoices/errors-b.xml' 'INPUT_FAIL-ON=never' EINVOICE_TEST_SOURCE_LOG="$(winpath "$SRC_LOG")"
assert_eq "$EXIT_CODE" "0" "T14 exit code 0"
LOGGED="$(cat "$SRC_LOG" 2>/dev/null)"
# clean-a.xml has no findings -> formatter called once (json).
# errors-b.xml has findings   -> formatter called twice (json + markdown).
assert_eq "$(printf '%s\n' "$LOGGED" | grep -c '.')" "3" "T14 formatter invoked 3 times total"
SOURCES="$(printf '%s\n' "$LOGGED" | sed -n 's/^source=\([^ ]*\) path=.*/\1/p')"
PATHS="$(printf '%s\n' "$LOGGED" | sed -n 's/^source=[^ ]* path=\(.*\)$/\1/p')"
assert_not_contains "$SOURCES" "clean-a.xml" "T14 --source never carries the original input filename"
assert_not_contains "$SOURCES" "errors-b.xml" "T14 --source never carries the original input filename"
assert_contains "$SOURCES" ".source" "T14 --source is the engine's --out-source file instead"
assert_contains "$PATHS" "clean-a.xml" "T14 --path carries the real input filename"
assert_contains "$PATHS" "errors-b.xml" "T14 --path carries the real input filename"
assert_contains "$(report_query t14 'JSON.stringify(r.files.map(f=>f.path))')" "errors-b.xml" "T14 report files[].path is the real input path (formatter fills it from --path, not --source)"

echo "T15: no workDir (svrl/source temp files) survives after a later file aborts the run"
# NOTE on what this does and doesn't prove: this is a black-box check from
# outside the process, taken once the whole run has finished. It shows the
# workDir is gone at the end -- it cannot observe whether cleanup actually
# happened per-file, during the loop, rather than only in the final
# recursive rmSync. The per-file try/finally in runner.js is what does that;
# this test does not exercise it in isolation.
run_action t15 INPUT_PATH='invoices/clean-a.xml
invoices/toolfail-d.xml' 'INPUT_FAIL-ON=never'
assert_eq "$EXIT_CODE" "1" "T15 exit code 1 (tool failure aborts)"
# runAll's workDir (mkdtempSync 'prufix-XXXXXX', a directory) is what
# holds the per-file svrl/source temp files; entrypoint.sh's own
# 'prufix-files-<pid>.txt' list file is a different, unrelated thing
# and is intentionally not matched here.
LEFTOVER="$(find "$TMP_ROOT" -maxdepth 1 -type d -name 'prufix-*' 2>/dev/null)"
assert_eq "$LEFTOVER" "" "T15 no workDir left behind after the abort"

# =========================================================================
echo ""
echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
