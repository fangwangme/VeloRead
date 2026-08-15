# VeloRead

A desktop EPUB reader built to replace Kindle for daily English reading:
a speed-reading pacer, Kindle-compatible highlight export, and a word-lookup → flashcard pipeline.
Everything stays on your machine.

## Status

Rebuilt from scratch on 2026-08-15 — the repository currently holds the app shell and project
structure, not the features. See [`docs/specs/PRD.md`](docs/specs/PRD.md) for what is being built.

## Planned Features

- **Reader** — EPUB rendering, TOC navigation, CFI-persisted progress, per-book typography, light/dark/sepia
- **Pacer** — WPM-driven highlight that guides your eyes, word-chunked for English and character-chunked for CJK, with reading-speed stats
- **Highlights** — annotate as you read, export as plain text in Kindle `My Clippings.txt` format so existing tooling just works
- **Vocabulary** — look up a word from the page, keep the sentence it came from, export to Anki (`.apkg`/CSV or AnkiConnect)

## Development

```bash
bun install
bun run dev        # frontend only, http://localhost:5174 — fastest UI loop
bun run app:dev    # full desktop app (Tauri; first Rust build takes a while)
bun run app:build  # bundle .app / .dmg
bun run lint
```

Requires [bun](https://bun.sh), a Rust toolchain, and Xcode Command Line Tools.

## Stack

Tauri v2 (Rust + WKWebView) · React 19 · TypeScript · Vite 7 · Tailwind CSS 4

## Documentation

- Product requirements: [`docs/specs/PRD.md`](docs/specs/PRD.md)
- Contributor and agent conventions: [`AGENTS.md`](AGENTS.md)

## License

MIT
