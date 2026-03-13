#!/usr/bin/env bash
# e2e.sh – ZeroSync End-to-End Test Script
#
# This script runs the full demo pipeline:
#   1. Start a local Hardhat node (background)
#   2. Start the signaling server (background)
#   3. Run the aggregator with sample data
#   4. Run the ZK proof workflow (if circom is available)
#   5. Deploy ModelRegistry and publish a record
#   6. Clean up background processes
#
# Usage: bash tests/e2e.sh
# Output is saved to tests/e2e_output.txt

set -e
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/e2e_output.txt"
PIDS=()

# Redirect all output to both terminal and file
exec > >(tee "$OUTPUT_FILE") 2>&1

cleanup() {
  echo ""
  echo "============================================="
  echo " Cleaning up background processes..."
  echo "============================================="
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "  Stopped PID $pid"
    fi
  done
  echo "  Done."
}

echo "============================================="
echo " ZeroSync End-to-End Test"
echo " $(date)"
echo "============================================="
echo ""

# ── Check Node.js ────────────────────────────────────────────────────
echo "[E2E] Checking Node.js..."
if command -v node &>/dev/null; then
  echo "  ✓ Node.js $(node --version)"
else
  echo "  ✗ Node.js not found"
  echo "  Fix (macOS):  brew install node@18"
  echo "  Fix (Ubuntu): curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi

# ── Check Python ─────────────────────────────────────────────────────
echo "[E2E] Checking Python..."
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
  PYTHON_CMD="python3"
  echo "  ✓ Python $($PYTHON_CMD --version 2>&1 | awk '{print $2}')"
elif command -v python &>/dev/null; then
  PYTHON_CMD="python"
  echo "  ✓ Python $($PYTHON_CMD --version 2>&1 | awk '{print $2}')"
else
  echo "  ✗ Python not found"
  echo "  Fix (macOS):  brew install python@3.10"
  echo "  Fix (Ubuntu): sudo apt install -y python3"
  exit 1
fi

# ── Step 1: Syntax check all JS files ────────────────────────────────
echo ""
echo "============================================="
echo " Step 1: Syntax Check (node --check)"
echo "============================================="
FAIL=0
for f in $(find "$ROOT_DIR" -name '*.js' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/artifacts/*' -not -path '*/cache/*'); do
  if node --check "$f" 2>/dev/null; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f"
    FAIL=1
  fi
done
if [ $FAIL -eq 1 ]; then
  echo "  WARNING: Some JS files have syntax errors"
fi

# ── Step 2: Install server dependencies ──────────────────────────────
echo ""
echo "============================================="
echo " Step 2: Install Dependencies"
echo "============================================="
cd "$ROOT_DIR/server"
if [ ! -d "node_modules" ]; then
  echo "  Installing server deps..."
  npm install --silent 2>&1
fi
echo "  ✓ Server deps ready"

# ── Step 3: Start signaling server ───────────────────────────────────
echo ""
echo "============================================="
echo " Step 3: Start Signaling Server"
echo "============================================="
cd "$ROOT_DIR"
node server/signaling.js &
SIG_PID=$!
PIDS+=($SIG_PID)
sleep 2

if kill -0 "$SIG_PID" 2>/dev/null; then
  echo "  ✓ Signaling server started (PID $SIG_PID)"
else
  echo "  ✗ Signaling server failed to start"
  echo "  Fix: Check if port 4200 is in use: lsof -ti:4200"
fi

# ── Step 4: Test WebSocket connection ────────────────────────────────
echo ""
echo "============================================="
echo " Step 4: Test WebSocket Connection"
echo "============================================="
cd "$ROOT_DIR"
node -e "
const WebSocket = require('./server/node_modules/ws');
const ws = new WebSocket('ws://127.0.0.1:4200');
ws.on('open', () => {
  console.log('  ✓ WebSocket connected');
  ws.send(JSON.stringify({ type: 'register', clientId: 'e2e_test' }));
  ws.send(JSON.stringify({
    type: 'model_update',
    clientId: 'e2e_test',
    summaryVector: [100, 200, 300, 400],
    timestamp: Date.now()
  }));
  setTimeout(() => { ws.close(); console.log('  ✓ Test message sent and connection closed'); process.exit(0); }, 1000);
});
ws.on('error', (err) => {
  console.error('  ✗ WebSocket error:', err.message);
  process.exit(1);
});
" 2>&1 || echo "  ✗ WebSocket test failed"

# ── Step 5: Run Aggregator ───────────────────────────────────────────
echo ""
echo "============================================="
echo " Step 5: Run Aggregator"
echo "============================================="
cd "$ROOT_DIR"
node aggregator/aggregate.js 2>&1 || echo "  ✗ Aggregator failed"

# ── Step 6: ZK Proof (optional – requires circom) ───────────────────
echo ""
echo "============================================="
echo " Step 6: ZK Proof (if circom available)"
echo "============================================="
if command -v circom &>/dev/null && command -v snarkjs &>/dev/null; then
  echo "  circom and snarkjs found, running ZK workflow..."
  cd "$ROOT_DIR/zk"
  bash build_setup.sh 2>&1 || echo "  ✗ ZK build failed"
  bash prove_and_verify.sh 2>&1 || echo "  ✗ ZK prove/verify failed"
else
  echo "  ⚠ circom or snarkjs not installed – skipping ZK proof step"
  echo "  Install circom:  npm install -g circom"
  echo "  Install snarkjs: npm install -g snarkjs"
  echo "  Or see: https://docs.circom.io/getting-started/installation/"
fi

# ── Step 7: Hardhat Deploy (optional – requires deps) ───────────────
echo ""
echo "============================================="
echo " Step 7: Hardhat Deploy (if deps available)"
echo "============================================="
cd "$ROOT_DIR/hardhat"
if [ ! -d "node_modules" ]; then
  echo "  Installing hardhat deps..."
  npm install --silent 2>&1 || echo "  ✗ npm install failed for hardhat"
fi

if [ -d "node_modules" ]; then
  echo "  Compiling contracts..."
  npx hardhat compile 2>&1 || echo "  ✗ Compilation failed"

  echo "  Starting Hardhat node (background)..."
  npx hardhat node &
  HH_PID=$!
  PIDS+=($HH_PID)
  sleep 3

  if kill -0 "$HH_PID" 2>/dev/null; then
    echo "  ✓ Hardhat node started (PID $HH_PID)"
    echo "  Deploying ModelRegistry..."
    npx hardhat run scripts/deploy.js --network localhost 2>&1 || echo "  ✗ Deploy failed"
  else
    echo "  ✗ Hardhat node failed to start"
    echo "  Fix: Check if port 8545 is in use: lsof -ti:8545"
  fi
else
  echo "  ⚠ Hardhat node_modules not available – skipping"
fi

# ── Step 8: Replay CLI test ──────────────────────────────────────────
echo ""
echo "============================================="
echo " Step 8: Replay CLI Test"
echo "============================================="
cd "$ROOT_DIR"
SAMPLE_REPLAY="$SCRIPT_DIR/sample_replay.json"
if [ -f "$SAMPLE_REPLAY" ]; then
  node aggregator/replay.js "$SAMPLE_REPLAY" 2>&1 || echo "  ✗ Replay failed"
else
  echo "  ⚠ No sample_replay.json found in tests/ – skipping replay test"
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo " E2E Test Summary"
echo "============================================="
echo "  Output saved to: $OUTPUT_FILE"
echo "  Timestamp: $(date)"
echo ""
echo "  Key results:"
echo "    - JS syntax check: $([ $FAIL -eq 0 ] && echo '✓ PASS' || echo '✗ FAIL')"
echo "    - Signaling server: $(kill -0 $SIG_PID 2>/dev/null && echo '✓ Running' || echo '✗ Stopped')"
echo "    - Aggregator: $([ -f '$ROOT_DIR/zk/input.json' ] && echo '✓ Generated input.json' || echo '⚠ Check output above')"
echo ""
echo "============================================="
echo " E2E Test Complete"
echo "============================================="
