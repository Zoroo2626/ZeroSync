#!/usr/bin/env bash
# build_setup.sh – Compile the circom circuit and run PLONK trusted setup
#
# Prerequisites:
#   - circom compiler installed: npm install -g circom  (or cargo install circom)
#   - snarkjs installed:         npm install -g snarkjs
#   - A powers-of-tau file (downloaded automatically if missing)
#
# Usage: cd zk && bash build_setup.sh

set -e
trap 'echo "[ZeroSync ZK] ERROR on line $LINENO. See above for details." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_DIR="$SCRIPT_DIR/build"
CIRCUIT="$SCRIPT_DIR/circuits/weighted_sum.circom"
PTAU_FILE="$BUILD_DIR/pot12_final.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau"

echo "============================================="
echo " ZeroSync – ZK Circuit Build & Setup (PLONK)"
echo "============================================="

# ── Check prerequisites ─────────────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "[ZeroSync ZK] ERROR: '$1' not found."
    echo "  Install with:"
    echo "    npm install -g $1"
    echo "  Or for circom: see https://docs.circom.io/getting-started/installation/"
    exit 1
  fi
}

check_cmd circom
check_cmd snarkjs

# ── Create build directory ───────────────────────────────────────────
mkdir -p "$BUILD_DIR"


# ── Step 1: Compile the circuit ──────────────────────────────────────
echo ""
echo "[DEBUG] CIRCUIT path: $CIRCUIT"
ls -l "$SCRIPT_DIR/circuits"
echo "[DEBUG] First 10 lines of circuit file:"
head -n 10 "$CIRCUIT"
echo "[DEBUG] Full circom command: circom \"$CIRCUIT\" --r1cs --wasm --sym -o \"$BUILD_DIR\""
circom "$CIRCUIT" --r1cs --wasm --sym -o "$BUILD_DIR"
echo "  ✓ R1CS:  $BUILD_DIR/weighted_sum.r1cs"
echo "  ✓ WASM:  $BUILD_DIR/weighted_sum_js/weighted_sum.wasm"
echo "  ✓ SYM:   $BUILD_DIR/weighted_sum.sym"

# ── Step 2: Download powers-of-tau (if missing) ─────────────────────
echo ""
echo "[Step 2/4] Checking powers-of-tau file..."
if [ -f "$PTAU_FILE" ]; then
  echo "  ✓ PTAU file exists: $PTAU_FILE"
else
  echo "  Downloading powers-of-tau (phase 1 ceremony)..."
  echo "  URL: $PTAU_URL"
  echo "  This may take a few minutes (~70MB)..."
  curl -L -o "$PTAU_FILE" "$PTAU_URL"
  if [ ! -f "$PTAU_FILE" ]; then
    echo "[ZeroSync ZK] ERROR: Failed to download PTAU file."
    echo "  Manual download: curl -L -o $PTAU_FILE $PTAU_URL"
    exit 1
  fi
  echo "  ✓ Downloaded: $PTAU_FILE"
fi

# ── Step 3: Generate PLONK proving/verification keys ────────────────
echo ""
echo "[Step 3/4] Generating PLONK setup (proving & verification keys)..."
snarkjs plonk setup \
  "$BUILD_DIR/weighted_sum.r1cs" \
  "$PTAU_FILE" \
  "$BUILD_DIR/weighted_sum_final.zkey"
echo "  ✓ ZKey: $BUILD_DIR/weighted_sum_final.zkey"

# ── Step 4: Export verification key ──────────────────────────────────
echo ""
echo "[Step 4/4] Exporting verification key..."
snarkjs zkey export verificationkey \
  "$BUILD_DIR/weighted_sum_final.zkey" \
  "$BUILD_DIR/verification_key.json"
echo "  ✓ Verification key: $BUILD_DIR/verification_key.json"


# ── Step 5: Compile weighted_average circuit (production) ────────────
echo ""
echo "[Step 5/7] Compiling weighted_average circuit (production)..."
AVG_CIRCUIT="$SCRIPT_DIR/circuits/weighted_average.circom"
if [ -f "$AVG_CIRCUIT" ]; then
  echo "[DEBUG] AVG_CIRCUIT path: $AVG_CIRCUIT"
  ls -l "$AVG_CIRCUIT"
  echo "[DEBUG] Listing circuits directory: $SCRIPT_DIR/circuits"
  ls -l "$SCRIPT_DIR/circuits"
  echo "[DEBUG] First 10 lines of average circuit file:"
  head -n 10 "$AVG_CIRCUIT"
  echo "[DEBUG] Full circom command: circom \"$AVG_CIRCUIT\" --r1cs --wasm --sym -o \"$BUILD_DIR\""
  circom "$AVG_CIRCUIT" --r1cs --wasm --sym -o "$BUILD_DIR"
  echo "  ✓ R1CS:  $BUILD_DIR/weighted_average.r1cs"
  echo "  ✓ WASM:  $BUILD_DIR/weighted_average_js/weighted_average.wasm"

  # Step 6: PLONK setup for average circuit
  echo ""
  echo "[Step 6/7] Generating PLONK setup for weighted_average..."
  snarkjs plonk setup \
    "$BUILD_DIR/weighted_average.r1cs" \
    "$PTAU_FILE" \
    "$BUILD_DIR/weighted_average_final.zkey"
  echo "  ✓ ZKey: $BUILD_DIR/weighted_average_final.zkey"

  # Step 7: Export verification key for average circuit
  echo ""
  echo "[Step 7/7] Exporting verification key for weighted_average..."
  snarkjs zkey export verificationkey \
    "$BUILD_DIR/weighted_average_final.zkey" \
    "$BUILD_DIR/verification_key_average.json"
  echo "  ✓ Verification key: $BUILD_DIR/verification_key_average.json"
else
  echo "  ⚠ weighted_average.circom not found – skipping production circuit"
fi

echo ""
echo "============================================="
echo " ZK Build & Setup Complete ✓"
echo " Circuits: weighted_sum (MVP) + weighted_average (production)"
echo "============================================="
echo ""
echo "Next steps:"
echo "  1. Run the aggregator: npm run aggregate"
echo "  2. Generate proof:     npm run zk:prove"
