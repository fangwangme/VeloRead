#!/bin/bash

# Ensure tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed."
    exit 1
fi

# Determine Project Root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

# Heuristic: Check if we are in main or dev
if [[ "$(basename "$SCRIPT_DIR")" == "main" || "$(basename "$SCRIPT_DIR")" == "dev" ]]; then
    PROJECT_ROOT="$PARENT_DIR"
else
    # Fallback: Assume script is at Project Root
    PROJECT_ROOT="$SCRIPT_DIR"
fi

SESSION_NAME="velo-read"
MAIN_DIR="$PROJECT_ROOT/main"
DEV_DIR="$PROJECT_ROOT/dev"

# Check if session exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Attaching to existing session '$SESSION_NAME'..."
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

echo "Worktree Root: $PROJECT_ROOT"
echo "Creating new session '$SESSION_NAME'..."

if [ ! -d "$DEV_DIR" ]; then
    echo "Error: Dev directory not found at $DEV_DIR"
    exit 1
fi

if [ ! -d "$MAIN_DIR" ]; then
    echo "Error: Main directory not found at $MAIN_DIR"
    exit 1
fi

# Window 1: Dev Environment (Dev Server)
tmux new-session -d -s "$SESSION_NAME" -n "dev" -c "$DEV_DIR"
tmux send-keys -t "$SESSION_NAME:1" "npm run dev" C-m

# Window 2: Main Environment (Stable Build)
tmux new-window -t "$SESSION_NAME:2" -n "main" -c "$MAIN_DIR"
# Run build and preview for stable version
tmux send-keys -t "$SESSION_NAME:2" "npm run build && npm run preview" C-m

# Select the dev window
tmux select-window -t "$SESSION_NAME:1"

# Attach
tmux attach-session -t "$SESSION_NAME"
