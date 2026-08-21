# VeloRead

A desktop reader (EPUB, TXT, PDF) built to replace Kindle for daily English reading:
auto-advancing pacer for speed training, plus highlights and a vocabulary list that
export as plain text in Kindle's format. Everything stays on your machine — and
unlike Kindle, everything can be exported back out.

## Status

Rebuilt from scratch on 2026-08-15. EPUB is usable end to end today; TXT and PDF are not
started, and nothing exports yet. Start at
[`docs/specs/overview.md`](docs/specs/overview.md) for the module-by-module state.

## Features

**Working (EPUB only)**

- **Reader** — TOC, bookmarks, per-book typography, six visual presets (Classic Book,
  Parchment, Modern Prose, Academic, Editorial, Chinese Song), light and dark, paginated or
  scrolling
- **Pacer** — an auto-advancing highlight that paces your eyes a few words at a time, to train
  reading speed past subvocalization. One engine, separate profiles for Latin (words/min) and
  CJK (graphemes/min), applied per chunk so mixed text paces correctly. Its colour, strength
  and shape are yours to set
- **Highlights** — five colours with optional notes, listed alongside the TOC and bookmarks,
  and exportable as Kindle-format plain text: one file for everything, or one per book
- **Full-text search** — across the whole book, loading each chapter on demand
- **Library** — collections, with a book able to sit on several shelves
- **Reading activity** — honest active-reading time, words and CJK characters counted
  separately, streaks, and a four-tier daily check-in
- **Interface in English or Chinese** — following your system by default

**Not started**

- **TXT and PDF** — TXT will share the EPUB engine; PDF is a separate track with unequal
  capabilities by nature. See [`docs/specs/reading-formats.md`](docs/specs/reading-formats.md)
- **Import** — reading a Kindle `My Clippings.txt` back in, so a migration brings its
  history along. Export already works
- **Vocabulary** — look up a word, keep the sentence it came from, export it as plain text.
  Kindle records this too, but won't let you take it with you. This will

## Running it

There are no downloads. VeloRead is not code-signed, and an unsigned app that
arrives over the network is quarantined by Gatekeeper as *damaged* — not as
*unverified*, which you could right-click past. Handing someone a build that
looks broken is worse than handing them a build command, so: build it yourself.
It takes one command and the result opens by double-clicking, because a locally
built app is never quarantined.

```bash
bun install
bun run dev        # frontend only, http://localhost:5174 — fastest UI loop
bun run app:dev    # full desktop app (Tauri; first Rust build takes a while)
bun run app:build  # bundle .app / .dmg into .local/release/<version>/
bun run lint
bun run test
bun run build      # tsc -b && vite build
```

Requires [bun](https://bun.sh), a Rust toolchain, and Xcode Command Line Tools.
The bundle lands in `.local/release/<version>/`.

CI runs lint, tests and the type-checked build on Linux, and `cargo fmt --check`,
`cargo clippy -D warnings` and `cargo test` on macOS, for every pull request.

Packaging, artifact layout, and what is still missing before the build can be
handed to anyone else: [`docs/usage/build.md`](docs/usage/build.md).

## Stack

Tauri v2 (Rust + WKWebView) · React 19 · TypeScript · Vite 7 · Tailwind CSS 4

## Documentation

- Specs — start with [`docs/specs/overview.md`](docs/specs/overview.md); each module has its own
  spec under [`docs/specs/`](docs/specs/)
- Building and packaging: [`docs/usage/build.md`](docs/usage/build.md)
- What changed and what is still missing: [`CHANGELOG.md`](CHANGELOG.md)
- Contributor and agent conventions: [`AGENTS.md`](AGENTS.md)

## License

MIT
