#!/usr/bin/env bash
# Remove the vibe-usage local server LaunchAgent.
set -euo pipefail

LABEL="com.vibe-usage.server"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$DEST"

echo "Removed LaunchAgent: $DEST"
