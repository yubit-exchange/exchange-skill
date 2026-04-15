#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

exec node bin/cli.js setup "$@"
