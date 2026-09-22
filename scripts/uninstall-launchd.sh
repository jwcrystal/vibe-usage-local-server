#!/usr/bin/env bash
# Remove the vibe-usage local server LaunchAgent.
set -euo pipefail

LABEL="com.vibe-usage.server"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$DEST"

# Remove the newsyslog rotation config installed by install-launchd.sh (root-owned).
if [[ -f "/etc/newsyslog.d/$LABEL.conf" ]] && sudo -n true 2>/dev/null; then
  sudo rm -f "/etc/newsyslog.d/$LABEL.conf"
  echo "Removed newsyslog config: /etc/newsyslog.d/$LABEL.conf"
fi

echo "Removed LaunchAgent: $DEST"
