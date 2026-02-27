#!/bin/bash
set -e

cd "$(dirname "$0")/.."

VERBOSE=false
if [[ "$1" == "-v" || "$1" == "--verbose" ]]; then
    VERBOSE=true
fi

# Run a test suite, capturing output. In quiet mode, show a one-line summary
# on success or full output on failure. In verbose mode, stream everything.
#   $1 = display name (e.g. "Python tests")
#   $2+ = command to run
run_suite() {
    local name="$1"
    shift

    if $VERBOSE; then
        echo "=== $name ==="
        "$@"
        echo ""
        return
    fi

    local tmpfile
    tmpfile=$(mktemp)
    local start_time=$SECONDS
    local exit_code=0

    "$@" > "$tmpfile" 2>&1 || exit_code=$?

    local elapsed=$(( SECONDS - start_time ))

    if [[ $exit_code -ne 0 ]]; then
        echo "✗ $name: FAILED"
        echo ""
        cat "$tmpfile"
        echo ""
        rm -f "$tmpfile"
        exit $exit_code
    fi

    # Extract passed count from runner-specific summary lines (strip ANSI codes)
    local clean
    clean=$(sed 's/\x1b\[[0-9;]*m//g' "$tmpfile")
    local count=""

    case "$name" in
        Python*)
            count=$(echo "$clean" | grep -oE '[0-9]+ passed' | head -1)
            ;;
        JavaScript*)
            # vitest: "Tests  149 passed (149)"
            count=$(echo "$clean" | grep -E '^\s*Tests\s' | grep -oE '[0-9]+ passed' | head -1)
            ;;
        E2E*)
            # playwright: "  60 passed (12.1s)"
            count=$(echo "$clean" | grep -oE '[0-9]+ passed' | tail -1)
            ;;
    esac

    echo "✓ $name: ${count:-ok} (${elapsed}s)"
    rm -f "$tmpfile"
}

run_suite "Python tests"      .venv/bin/python -m pytest tests/python/ -v
run_suite "JavaScript tests"  npx vitest run
run_suite "E2E tests"         npx playwright test

echo ""
echo "All tests passed."
