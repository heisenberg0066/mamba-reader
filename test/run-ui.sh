#!/usr/bin/env bash
# Linux: self-test (creates samples) + renderer UI test, screenshots into docs/
set -e
cd "$(dirname "$0")/.."
export MAMBA_READER_DATA=${MAMBA_READER_DATA:-/tmp/mr-uitest}; rm -rf "$MAMBA_READER_DATA"
export CI=1 MAMBA_READER_NO_LOCK=1
xvfb-run -a -s "-screen 0 1600x1000x24" node_modules/.bin/electron --no-sandbox . --self-test 2>&1 | grep -E "^(PASS|FAIL)|passed"
MAMBA_READER_UITEST=test/ui.js MAMBA_READER_SHOTS=${SHOTS:-docs} xvfb-run -a -s "-screen 0 1600x1000x24" node_modules/.bin/electron --no-sandbox . 2>&1 | grep -E "^(PASS|FAIL)|UI:"
# layout regression check (both modes, several window sizes) at 100%, 125% and 150% scaling
for SF in 1 1.25 1.5; do
  MAMBA_READER_UITEST=test/ui-layout.js MAMBA_READER_SHOTS=${SHOTS:-docs/screenshots/after} xvfb-run -a -s "-screen 0 3000x1800x24" node_modules/.bin/electron --no-sandbox --force-device-scale-factor=$SF . 2>&1 | grep -E "^(PASS|FAIL)|UI:"
done
# PDF editor UI test (real input events), fixtures generated fresh
FX=$(mktemp -d); node test/edit-fixture.js "$FX" >/dev/null; rm -rf "$MAMBA_READER_DATA"
MAMBA_READER_FIXTURES="$FX" MAMBA_READER_UITEST=test/ui-edit.js MAMBA_READER_SHOTS=${SHOTS:-docs} xvfb-run -a -s "-screen 0 1600x1000x24" node_modules/.bin/electron --no-sandbox . 2>&1 | grep -E "^(PASS|FAIL)|UI:"
