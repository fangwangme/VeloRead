# Changelog

Notable changes, newest first. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [semantic versioning](https://semver.org/spec/v2.0.0.html).

`version` in `src-tauri/tauri.conf.json` is the source of truth; `package.json`
follows it. There are no published binaries — see
[`docs/usage/build.md`](docs/usage/build.md) for why and how to build.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-08-21

First version that works end to end. **EPUB only**; TXT and PDF are not started,
and nothing exports yet.

### Added

- **Library** — import EPUB by drag or file picker, cover-grid shelf ordered by
  last read with reading progress on each cover, and collections a book can
  belong to several of at once.
- **Reader** — six typography presets, relative steps for size, leading and
  measure, typeface choice, single/double/adaptive columns, paginated and
  scrolling flow. Contents, bookmarks and highlights share one drawer.
  Typography is kept per script — one Chinese setup, one English one — so
  tuning it once covers every book in that language.
- **Pacer** — a highlight that advances through the text at a set pace, to
  train reading past subvocalization. One engine with separate profiles for
  Latin (words/min) and CJK (graphemes/min), applied per chunk so mixed text
  paces correctly. Colour, strength and shape are configurable. Click a word to
  set where it starts.
- **Highlights** — five colours with optional notes, painted through epub.js
  marks so they survive page turns, listed in the drawer.
- **Highlight export** — every highlight as one document, or one document per
  book, in Kindle's `My Clippings.txt` format. Sorted by reading position rather
  than by when it was made, and a note becomes its own record after the
  highlight it belongs to.
- **Whole-book search** — no index exists in EPUB, so each chapter is loaded,
  searched and unloaded in turn: memory stays flat, the pass is visible, and it
  can be stopped without losing what it found.
- **Reading activity** — active-reading minutes that stop for a hidden window,
  an unfocused one, an open panel and a page you have sat on for five minutes.
  Latin words and CJK graphemes counted separately, never merged. Heatmap,
  streaks, and a four-tier daily check-in with a configurable goal.
- **Time left** — minutes to the end of the chapter and of the book, computed
  from the rate your own sessions recorded rather than from the Pacer setting.
- **Interface in English and Chinese**, following the system by default.
- **Storage on two targets** — SQLite under Tauri, IndexedDB in the browser,
  behind one port so `bun run dev` stays a usable target.
- **CI** — lint, tests and the type-checked build on Linux; `cargo fmt`,
  `clippy -D warnings` and `cargo test` on macOS.

### Known gaps

- **No import.** Highlights export, but a Kindle `My Clippings.txt` cannot yet
  be read back in, so a migration from Kindle still leaves its history behind.
- **No vocabulary list**, no dictionary lookup.
- **TXT and PDF** unimplemented; `Locator` has not landed, so bookmarks and
  highlights still store EPUB CFIs directly.
- **Unsigned and un-notarized**, and built for the host architecture only.
- The main JS chunk is ~813 kB (~250 kB gzipped); no code splitting yet.

[Unreleased]: https://github.com/fangwangme/VeloRead/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fangwangme/VeloRead/releases/tag/v0.1.0
