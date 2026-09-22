#!/usr/bin/env bash
# Install the vibe-usage local server as a per-user macOS LaunchAgent.
# Starts the server at login and keeps it alive (restarts on crash).
#
# Usage:
#   ./scripts/install-launchd.sh [--bin /absolute/path/to/vibe-usage-server.js]
#
# Default bin: npm-installed `vibe-usage-server`, or bundled wrapper in this checkout.
# Uninstall: ./scripts/uninstall-launchd.sh
set -euo pipefail

LABEL="com.vibe-usage.server"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
LOG_DIR="$HOME/.vibe-usage/logs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist"
BUNDLED_BIN="$SCRIPT_DIR/../bin/vibe-usage-server.js"

# Resolve the server entrypoint. `launchd` does not inherit Homebrew's PATH, so
# the plist invokes both Node and this script by absolute path.
BIN="$(command -v vibe-usage-server 2>/dev/null || true)"
if [[ -n "$BIN" && ! -f "$BIN" ]]; then
  BIN=""
fi
if [[ "${1:-}" == "--bin" ]]; then
  CANDIDATE="${2:-}"
  if [[ -z "$CANDIDATE" ]]; then
    echo "error: --bin requires a JavaScript entrypoint path." >&2
    exit 1
  fi
  if [[ "$CANDIDATE" == */* ]]; then
    BIN="$CANDIDATE"
  else
    BIN="$(command -v "$CANDIDATE" 2>/dev/null || true)"
  fi
elif [[ -z "$BIN" && -f "$BUNDLED_BIN" ]]; then
  BIN="$BUNDLED_BIN"
fi
if [[ -z "$BIN" || ! -f "$BIN" ]]; then
  echo "error: no vibe-usage server entrypoint found." >&2
  echo "Install it first, e.g.: npm install -g <pkg>  |  or run this script from a source checkout." >&2
  exit 1
fi
BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"
NODE="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "error: Node.js not found on PATH." >&2
  exit 1
fi
NODE="$(cd "$(dirname "$NODE")" && pwd)/$(basename "$NODE")"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

sed -e "s|__BIN_PATH__|$BIN|g" \
    -e "s|__NODE_PATH__|$NODE|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$TEMPLATE" > "$DEST"

# Load it (bootout first to avoid 'already loaded').
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"

# Bound log growth via newsyslog: rotate at 1MB, keep 3 compressed copies.
# Requires root once; skip with a printed hint when sudo is unavailable.
ROTATE_CONF="/etc/newsyslog.d/$LABEL.conf"
ROTATE_BODY="# mode count size when flags
$LOG_DIR/vibe-usage-server.log 644  3  1024  *  J
$LOG_DIR/server.err            644  3  1024  *  J"
if [[ -f "$ROTATE_CONF" ]]; then
  ROTATE_MSG="rotate : $ROTATE_CONF (already present)"
elif sudo -n true 2>/dev/null; then
  printf '%s\n' "$ROTATE_BODY" | sudo tee "$ROTATE_CONF" >/dev/null
  ROTATE_MSG="rotate : $ROTATE_CONF installed (1MB x 3, compressed)"
else
  ROTATE_MSG="rotate : NOT configured (needs sudo). To bound log growth run:
           sudo tee $ROTATE_CONF <<'EOF'
$ROTATE_BODY
EOF"
fi

echo "Installed LaunchAgent: $DEST"
echo "  node    : $NODE"
echo "  binary : $BIN"
echo "  logs   : $LOG_DIR"
echo "  $ROTATE_MSG"
echo "  status : launchctl print gui/$(id -u)/$LABEL"
