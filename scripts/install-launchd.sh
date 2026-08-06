#!/usr/bin/env bash
# Install the vibe-usage local server as a per-user macOS LaunchAgent.
# Starts the server at login and keeps it alive (restarts on crash).
#
# Usage:
#   ./scripts/install-launchd.sh [--bin /absolute/path/to/vibe-usage-server]
#
# Default bin: the npm-installed `vibe-usage-server` on PATH.
# Uninstall: ./scripts/uninstall-launchd.sh
set -euo pipefail

LABEL="com.vibe-usage.server"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
LOG_DIR="$HOME/.vibe-usage/logs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist"

# Resolve the server binary.
BIN="$(command -v vibe-usage-server 2>/dev/null || true)"
if [[ -z "$BIN" ]] && [[ "${1:-}" == "--bin" ]]; then
  BIN="$(command -v "${2:-}" 2>/dev/null || true)"
fi
if [[ -z "$BIN" ]]; then
  echo "error: 'vibe-usage-server' not found on PATH." >&2
  echo "Install it first, e.g.: npm install -g <pkg>  |  or pass --bin /path/to/binary" >&2
  exit 1
fi
BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

sed -e "s|__BIN_PATH__|$BIN|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$TEMPLATE" > "$DEST"

# Load it (bootout first to avoid 'already loaded').
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"

echo "Installed LaunchAgent: $DEST"
echo "  binary : $BIN"
echo "  logs   : $LOG_DIR"
echo "  status : launchctl print gui/$(id -u)/$LABEL"
