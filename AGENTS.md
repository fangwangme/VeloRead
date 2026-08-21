# VeloRead

macOS 桌面阅读器（EPUB / TXT / PDF），专注于长篇专注阅读、速度训练与数据自由导出：
自动阅读 Pacer、划线摘抄与生词本（对齐主流纯文本格式，且**必须能导出**）。

规格从 `docs/specs/overview.md` 读起 —— 它是入口，含模块地图与格式支持矩阵；
每个模块另有独立 spec。本项目**不使用单一 PRD 文档**。

## Tech Stack

- 外壳：Tauri v2（Rust + WKWebView），产物是 macOS 应用；后续可出 Windows / Linux 包
- 前端：React 19 + TypeScript + Vite 7 + Tailwind CSS 4
  （Tailwind 走 `@tailwindcss/vite`，没有 `tailwind.config.js`，样式入口 `src/index.css`）
- 包管理：**bun**（`bun install`），锁文件 `bun.lock`
- 构建输出：前端 `.local/dist/`，Rust 产物 `.local/target/`（`.cargo/config.toml` 指定），都不入库

```bash
bun install
bun run dev        # 仅前端，浏览器 http://localhost:5174，改 UI 最快
bun run app:dev    # 完整桌面应用（Tauri dev，首次编译 Rust 较慢）
bun run app:build  # 打包 .app / .dmg
bun run build      # 仅前端构建到 .local/dist
bun run lint
```

## Architecture

- `src/` —— 前端。书页渲染基于 epub.js：EPUB 本身是 XHTML+CSS，Pacer 高亮、划词、划线都是对书页
  DOM 的操作，这部分逻辑始终在前端。
- `src-tauri/` —— Rust 外壳。文件系统、SQLite、与 Anki 的本地通信这类原生能力放这里。
- **平台适配层**：`storage`（书库/进度/划线）、`fs`（摘抄导出）、`dict`（词典查询）三类能力必须走
  接口，各有 web 与 Tauri 两份实现。前端组件不直接 `import { invoke }`。
  这样浏览器目标始终可用于快速迭代和开源后的在线 demo。

## Project Structure

- Work in a non-`main` git worktree for normal development
- Only modify `main` directly when the user explicitly authorizes template or repository-structure maintenance
- Manual worktrees live under `.worktrees/`
- Worktree-local state lives under `.local/`
- Shared specs live under `docs/specs/`
- Agent notes, plans, archives, and project status live under `.agents/`

本项目额外约定：

- `.local/data/dictionary.json`（22 MB 英英词典原始数据）是本地资产，**不入库**。目标方案是导入
  SQLite 并建索引，不整包载入内存。
- `.local/data/archive/` 存 2025 年那版 Web 实现的代码快照，仅供参考，不要直接搬回 `src/`。
  功能盘点见 `.agents/notes/2026-08-15-legacy-implementation-handoff.md`。

## Development Workflow

1. Before starting feature work, read `AGENTS.md`, `.agents/plans/PROJECT_STATUS.md`, and the relevant `docs/specs/`.
2. Use the currently available issue-driven development orchestration skill as the public entry point. Invoke it manually with an explicit action; ordinary conversation never authorizes Issue, worktree, dispatch, PR, or cleanup mutations.
3. For non-trivial work, an explicit `issue` action creates the executable GitHub issue and stops. A later explicit `worktree` action authorizes rule-derived naming, worktree creation, and its documented dispatch bundle.
4. Require the executor to self-review and verify its work; the master independently accepts it against the issue before PR preparation. Merge remains a user decision.
5. Update `docs/specs/` when the current architecture, behavior contract, API, UX, or data shape changes; put usage instructions in `docs/usage/` when needed.
6. Update `.agents/plans/PROJECT_STATUS.md` when project state, active work, or important decisions change; the issue-driven workflow's actions maintain the per-issue Active Work lines themselves. Use `.agents/notes/` and `.agents/plans/` only for optional temporary multi-agent artifacts, then archive them on request when superseded.

Document placement: current architecture and durable behavior contracts in `docs/specs/`; usage guidance in `docs/usage/`; the executable feature/fix contract in the GitHub issue; its worktree-local authoring file in `.local/issues/`; raw/private requirement inputs in `.local/requirements/`; optional temporary review/research in `.agents/notes/`; optional temporary optimization/implementation alternatives in `.agents/plans/`; current state and active work in `.agents/plans/PROJECT_STATUS.md`.
