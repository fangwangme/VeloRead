#!/bin/bash
# VeloRead Development Environment
# Launches tmux session with:
# - Window 1: Development (main worktree for Antigravity)
# - Window 2: Stable (for daily reading use)
# - Window 3: Logs/Testing

SESSION_NAME="veloread"
DEV_DIR="/Users/fangwang/project/reading/VeloRead"
STABLE_DIR="/Users/fangwang/project/reading/VeloRead-stable"

# Kill existing session if present
tmux kill-session -t $SESSION_NAME 2>/dev/null

# Create new session with first window for Development
tmux new-session -d -s $SESSION_NAME -n "dev" -c "$DEV_DIR"
tmux send-keys -t $SESSION_NAME:dev "npm run dev -- --port 5174" C-m

# Window 2: Stable version for daily use
tmux new-window -t $SESSION_NAME -n "stable" -c "$STABLE_DIR"
tmux send-keys -t $SESSION_NAME:stable "npm run dev -- --port 5175" C-m

# Window 3: Logs and testing
tmux new-window -t $SESSION_NAME -n "test" -c "$DEV_DIR"
tmux send-keys -t $SESSION_NAME:test "echo '📖 VeloRead Dev Environment Ready!'" C-m
tmux send-keys -t $SESSION_NAME:test "echo '  Dev:    http://localhost:5174'" C-m
tmux send-keys -t $SESSION_NAME:test "echo '  Stable: http://localhost:5175'" C-m

# Attach to session
tmux attach-session -t $SESSION_NAME
