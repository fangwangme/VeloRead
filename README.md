# VeloRead

A modern, fast EPUB reader with Pacer (speed reading) functionality.

## Features

- 📖 Clean, distraction-free reading experience
- ⚡ **Pacer** - Guided speed reading with adjustable WPM
- 🌓 Light/Dark mode support
- 📱 Responsive design
- 💾 Local storage with IndexedDB

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5174 in your browser.

## Development Environment

This project uses **Git Worktree** + **tmux** for a seamless develop/use/test workflow.

### Directory Structure

```
/Users/fangwang/project/reading/
├── VeloRead/           # Main repo (development with Antigravity)
└── VeloRead-stable/    # Stable worktree (daily reading)
```

### One-Command Launch

```bash
./dev.sh
```

This launches a tmux session with 3 windows:

| Window | Name     | Port | Purpose                                |
| ------ | -------- | ---- | -------------------------------------- |
| 1      | `dev`    | 5174 | Development (Antigravity changes here) |
| 2      | `stable` | 5175 | Stable version for daily reading       |
| 3      | `test`   | -    | Logs & testing                         |

### tmux Shortcuts

- `Ctrl+b n` - Next window
- `Ctrl+b p` - Previous window
- `Ctrl+b d` - Detach session
- `tmux attach -t veloread` - Reattach session

### Updating Stable Version

When you're happy with development changes:

```bash
cd VeloRead-stable
git fetch origin
git checkout <commit-hash>  # or: git merge origin/main
npm install  # if dependencies changed
```

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- epubjs
- Zustand (state management)
- Dexie (IndexedDB wrapper)
