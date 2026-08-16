# VeloRead

A desktop reader (EPUB, TXT, PDF) built to replace Kindle for daily English reading:
auto-advancing pacer for speed training, plus highlights and a vocabulary list that
export as plain text in Kindle's format. Everything stays on your machine — and
unlike Kindle, everything can be exported back out.

## Status

Rebuilt from scratch on 2026-08-15. The reading core loop (import → render → paginate →
persist position) works; everything else is in progress. Start at
[`docs/specs/overview.md`](docs/specs/overview.md) for what is being built and where it stands.

## Planned Features

- **Reader** — EPUB, TXT and PDF; TOC navigation, per-book typography, and Apple Books-style
  visual presets (Book / News / Journal / Sepia / Night)
- **Pacer** — an auto-advancing highlight that paces your eyes a few words at a time, to train
  reading speed past subvocalization
- **Highlights** — annotate as you read; export *and import* Kindle's `My Clippings.txt`
- **Vocabulary** — look up a word, keep the sentence it came from, export it as plain text.
  Kindle records this too, but won't let you take it with you. This will.

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

- Specs — start with [`docs/specs/overview.md`](docs/specs/overview.md); each module has its own
  spec under [`docs/specs/`](docs/specs/)
- Contributor and agent conventions: [`AGENTS.md`](AGENTS.md)

## License

MIT
