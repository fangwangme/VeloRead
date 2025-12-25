# VeloRead

A modern, fast EPUB reader with Pacer (speed reading) functionality.

## Features

- 📖 Clean, distraction-free reading experience
- ⚡ **Pacer** - Guided speed reading with adjustable WPM
- 🌓 Light/Dark mode support
- 📱 Responsive design
- 💾 Local storage with IndexedDB

## Development Workflow

This project is set up with **Git Worktree** to separate stable code from active development.

### Directory Structure

```
VeloReadApp/
├── main/               # Stable branch (origin/main)
├── dev/                # Development worktree (origin/dev)
└── start_work_env.sh   # One-click environment setup script
```

### Quick Start

1.  **Run the environment script:**

    You can run the script directly from the `main` directory:

    ```bash
    ./main/start_work_env.sh
    ```

    (Or copy it to your project root `cp main/start_work_env.sh .` and run `./start_work_env.sh`)

    This launches a `tmux` session named `velo-read` with configured windows:

    | Window | Name          | Path    | Purpose                                 |
    | :----- | :------------ | :------ | :-------------------------------------- |
    | 1      | `dev-code`    | `dev/`  | **Active Development**. Edit code here. |
    | 2      | `dev-server`  | `dev/`  | Runs `npm run dev` (Port 5174).         |
    | 3      | `main-stable` | `main/` | Reference or Stable Build.              |

2.  **Open the App:**
    - Dev: [http://localhost:5174](http://localhost:5174)

### Tmux Cheatsheet

- `Ctrl+b` then `n`: Next window
- `Ctrl+b` then `p`: Previous window
- `Ctrl+b` then `d`: Detach (minimize) session
- To resume: `./start_work_env.sh` (or `tmux attach -t velo-read`)

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- epubjs
- Zustand, Dexie
