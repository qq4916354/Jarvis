#!/usr/bin/env bash
# One-click install oh-my-claudecode from GitHub
# Usage: bash scripts/install-omc.sh

set -e

OMC_DIR="$HOME/.omc-source"
OMC_REPO="https://github.com/Yeachan-Heo/oh-my-claudecode.git"

echo "[omc] Installing oh-my-claudecode..."

# Clone or update
if [ -d "$OMC_DIR/.git" ]; then
  echo "[omc] Updating existing clone..."
  cd "$OMC_DIR" && git pull --ff-only 2>/dev/null || true
else
  echo "[omc] Cloning repo..."
  rm -rf "$OMC_DIR"
  git clone --depth 1 "$OMC_REPO" "$OMC_DIR"
fi

# Install deps and build
cd "$OMC_DIR"
echo "[omc] Installing dependencies..."
npm install --no-audit --no-fund 2>&1 | tail -3
echo "[omc] Building..."
npm run build 2>&1 | tail -5

# Link globally
echo "[omc] Linking globally..."
npm link 2>&1 | tail -2

# Run plugin setup (HUD, skills, hooks)
echo "[omc] Running plugin setup..."
node scripts/plugin-setup.mjs 2>&1 || true

# Verify
if command -v omc &>/dev/null; then
  echo "[omc] Installed successfully: omc $(omc --version)"
else
  echo "[omc] WARNING: omc not found in PATH after install"
  exit 1
fi

echo "[omc] Done!"
