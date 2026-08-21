# VeloRead

A clean, elegant, local-first macOS desktop reader for EPUB, PDF, and TXT: featuring an auto-advancing Pacer for focus and speed training, structured highlights and annotations, reading activity tracking, and complete local data freedom with plain-text export.

<p align="center">
  <img src="docs/images/reader-pacer.png" alt="VeloRead Reader & Pacer" width="800" />
</p>

## Highlights & Screenshots

### Library & Collections
Manage books locally with custom shelves, reading progress indicators, and fast filtering.

<p align="center">
  <img src="docs/images/library.png" alt="Library View" width="700" />
</p>

### Reader & Pacer
Immersive reading with customizable typography, six aesthetic presets (Classic Book, Parchment, Modern Prose, Academic, Editorial, Chinese Song), paginated or continuous scrolling, and an auto-advancing **Pacer** that paces your eyes a few words at a time to train reading speed past subvocalization.

<p align="center">
  <img src="docs/images/reader-pacer.png" alt="Reader & Pacer View" width="700" />
</p>

### Reading Activity & Statistics
Track honest active reading time, words and CJK characters read, reading streaks, and daily check-in goals with an activity heatmap.

<p align="center">
  <img src="docs/images/reading-stats.png" alt="Reading Activity & Statistics" width="700" />
</p>

## Features

### Available Now (EPUB)

- **Reader Experience** — Table of contents, bookmarks, per-book typography settings, six visual presets, light/dark themes, and paginated or scrolling mode.
- **Pacer Speed Training** — Auto-advancing highlight with dedicated pacing engines for Latin text (words/min) and CJK text (graphemes/min), fully customizable speed, highlight intensity, and shape.
- **Highlights & Notes** — Five highlight colors with optional notes, listed alongside TOC/bookmarks, and exportable as standard plain text (`My Clippings` format) per book or across your entire library.
- **Full-Text Search** — Search across the entire book with on-demand chapter indexing.
- **Library & Shelves** — Drag-and-drop shelf management and multi-collection organization.
- **Reading Activity** — Active time tracking, CJK/Latin word counts, reading streaks, and daily goals.
- **Bilingual Interface** — English and Simplified Chinese UI with system auto-detection.

### Roadmap

- **TXT and PDF Support** — TXT support sharing the EPUB rendering pipeline; PDF support with dedicated native renderer. See [`docs/specs/reading-formats.md`](docs/specs/reading-formats.md).
- **Clippings Import** — Import existing plain-text clippings files to migrate reading history.
- **Vocabulary Builder** — Instant word lookup, sentence-in-context recording, and plain-text vocabulary export.

## Installation & Running

### Pre-built Releases

Download the latest `.dmg` installer for macOS from [GitHub Releases](https://github.com/fangwangme/VeloRead/releases).

> **Note for macOS Gatekeeper:**
> Because VeloRead is an open-source project without a paid Apple Developer certificate, macOS Gatekeeper may show a warning when opening downloaded builds. You can open it via **Right-click > Open** or run `xattr -cr /Applications/VeloRead.app` in Terminal.

### Building from Source

```bash
bun install
bun run dev        # frontend only (http://localhost:5174) — fastest UI iteration loop
bun run app:dev    # full desktop app (Tauri v2 + SQLite)
bun run app:build  # package .app and .dmg into .local/release/<version>/
bun run lint       # eslint
bun run test       # vitest unit tests
bun run build      # tsc -b && vite build
```

**Prerequisites:**
- [bun](https://bun.sh)
- Rust toolchain ([rustup](https://rustup.rs))
- Xcode Command Line Tools (`xcode-select --install`)

Packaged artifacts will be generated in `.local/release/<version>/`.

## Tech Stack

Tauri v2 (Rust + WKWebView) · React 19 · TypeScript · Vite 7 · Tailwind CSS 4

## Documentation

- Specs — start with [`docs/specs/overview.md`](docs/specs/overview.md); each module has its own spec under [`docs/specs/`](docs/specs/)
- Building and packaging: [`docs/usage/build.md`](docs/usage/build.md)
- What changed and what is still missing: [`CHANGELOG.md`](CHANGELOG.md)
- Contributor and agent conventions: [`AGENTS.md`](AGENTS.md)

## License

MIT
