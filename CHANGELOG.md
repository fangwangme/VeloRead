# Changelog

Notable changes, newest first. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [semantic versioning](https://semver.org/spec/v2.0.0.html).

`version` in `src-tauri/tauri.conf.json` is the source of truth; `package.json`
follows it. There are no published binaries — see
[`docs/usage/build.md`](docs/usage/build.md) for why and how to build.

## [0.2.1] — 2026-08-22

### Added

- **Select a word and see what it means.** One word, no second click — a
  definition from a local English dictionary, right where you selected it. The
  popover it appears in is a hub rather than a dead end: save the word, mark it
  known, highlight the passage, write a note, search the whole book for it, or
  copy it, all without reselecting.
- **A vocabulary list, in the library beside reading stats.** Every word you
  looked up with the sentence it was in, one row per word and one sentence per
  time you met it — so the same word found in three books keeps all three.
  Filter by book, remove what you have learned, and **export the lot as plain
  text**: a Kindle records exactly this and will not give it back, which is the
  whole reason the feature exists.
- **The dictionary is 102,217 entries in its own indexed SQLite file**, next to
  the library database and never inside it. It is imported once, streaming, and
  never loaded into memory: a lookup measures 0.009 ms at the median against
  the full dictionary, where the target was 50 ms. Installing it is one file
  copy — see [`docs/usage/dictionary.md`](docs/usage/dictionary.md).
- **`bun run dict:import`**, to build that file from the command line.

### Changed

- **The selection popover has a fixed structure.** The definition area is
  always at the top and is simply absent for a selection that is not a single
  word; the actions below it are the same buttons in the same order either way,
  disabled in place rather than removed. Deleting a highlight is therefore a
  permanent button that is sometimes disabled, where it used to appear and
  disappear — a control that moves with the length of your selection is one you
  can never learn the position of.
- **Looking a word up on the desktop does not automatically file it.** Kindle
  records every lookup because a long press is deliberate; a double-click is
  how you put the caret somewhere. A definition is free, and the row costs
  either a moment's attention or any further action on the word — otherwise the
  list fills with words nobody asked about, and its whole value is its
  signal-to-noise ratio.
- Searching in a book can be opened with a term already in it, and runs it
  straight away.

### Fixed

- **A note being written no longer disappears when you pick a colour.** The
  popover was rebuilt from scratch the moment a selection became a saved
  highlight, which threw away whatever was in the note editor and replayed the
  entrance animation — undoing the one thing the popover promises, that a colour
  tap can be followed by a note without reselecting.

## [0.2.0] — 2026-08-22

### Added

- **Turn the page with a sideways swipe** on a trackpad or Magic Mouse. One
  flick is one page, however long its inertia runs; vertical scrolling is left
  alone, and scrolling flow opts out because it has no page to turn.
- **A whole line as a Pacer cursor size**, alongside three, four and five words
  — the ruler people use to keep their place, rather than a fixation guide.
  Optionally, the line under a chunk-sized cursor can be tinted as well.
- **The reading position is now a word, not a page.** Auto-reading records the
  word under the cursor, so reopening a book puts the cursor back where it was
  and changing the font size no longer loses it.
- **Read a highlight where you are.** Opening one from the drawer shows the
  passage and its note over the page; jumping to it is a button inside that
  card, and imported clippings can be read there too. While there is somewhere
  to jump back to, the top bar stops hiding itself.
- **About**, with the version this build was made from.

### Changed

- **How much the cursor covers is one control.** Whole line used to be a cursor
  mode while size was a separate stepper, so the two could contradict each
  other. One- and two-unit chunks are gone: a fixation covers two to three
  words, and they were the only reason the rate was capped at 600 wpm.
- **Text size steps one pixel at a time** across a range that reaches what the
  renderer allows, instead of two pixels across nine positions, and shows its
  value between the two buttons that change it.
- Both panels in the reader's top-right corner are wider; settings are ordered
  by how often they are touched, with the key reference and About last; the
  panel itself drops a level of nested boxes and has no type below 11px.
- **The heatmap follows GitHub's ramp, in blue** — darkening with the hours in
  light mode, brightening in dark. The previous scale's top step in dark mode
  was a pale mint, so the busiest days looked like the emptiest.

### Fixed

- **The Pacer cursor no longer spans two columns.** A line was "the same
  vertical position", which in a two-column spread is also true of the line
  beside it, so a chunk could run from the end of one column into the start of
  the next.
- **A word hyphenated across a line break is lit on both lines.** Only the first
  half used to be, which made the next line look like it started mid-word.
- **A chunk of mixed Chinese and English is timed by both rates** rather than by
  whichever script it was labelled with.
- **Changing the font size while paused keeps the cursor on its word** instead
  of dropping it at the top of the page.
- **Closing the window writes what is still queued** — the reading position and
  the buffered reading time — through a platform lifecycle port with a
  grace period on the Rust side.

### Known gaps

- **macOS Cmd+Q cannot be held.** `NSApplication` terminate reaches the app as
  `RunEvent::Exit` alone — no `ExitRequested`, no window `CloseRequested` — and
  `Exit` cannot be deferred, so there is no window in which to flush. The reader
  keeps its exposure small instead (the within-page position is written at most
  every two seconds, and on blur), which costs at most a line and a half.

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

[0.2.1]: https://github.com/fangwangme/VeloRead/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/fangwangme/VeloRead/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fangwangme/VeloRead/releases/tag/v0.1.0
