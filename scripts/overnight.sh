#!/usr/bin/env bash
# A small first pass over the arena games with real models, turn-based (decision quality).
# Runs one after another so each model stays under the OpenRouter per-minute cap.
# About 30 minutes and under US$1.50 at September 2026 prices.
set -u
cd "$(dirname "$0")/.."
MODELS=jev,luna,haiku

run() { echo; echo "### $*"; bun src/arena/bench.ts --mode turn --quiet "$@" 2>&1 | grep -v '^seed'; }

run --game dispatch --level 4 --seeds 1-3 --controllers $MODELS,keyword,oracle
run --game sorting --level 3 --seeds 1-2 --controllers $MODELS,parser --option strategy=extract
run --game sorting --level 3 --seeds 1 --controllers $MODELS,parser --option strategy=stepwise
run --game sorting --level 3 --seeds 1 --controllers $MODELS,parser --option strategy=flat
# 343 bays: over Jev's 255-option limit. Haiku left out here (about $0.014 per decision).
run --game sorting --level 4 --seeds 1 --controllers jev,luna,parser --option strategy=flat
run --game highway --level 3 --seeds 1 --controllers $MODELS,autopilot --option state=raw
run --game highway --level 3 --seeds 1 --controllers $MODELS,autopilot --option state=facts
echo; echo "done"
