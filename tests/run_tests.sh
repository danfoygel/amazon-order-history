#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "=== Python tests ==="
.venv/bin/python -m pytest tests/python/ -v

echo ""
echo "=== JavaScript tests ==="
npx vitest run

echo ""
echo "=== E2E + Visual regression tests ==="
npx playwright test

echo ""
echo "=== All tests passed ==="
