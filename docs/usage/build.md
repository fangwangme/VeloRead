# 构建与运行

VeloRead 提供 GitHub Releases 自动构建的 `.dmg` 安装包，也可以在本地直接通过源码构建。

## 前置依赖

- [bun](https://bun.sh)
- Rust 工具链（[rustup](https://rustup.rs)）
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）
- **Linux**：`webkit2gtk-4.1`、`gtk3`、`libayatana-appindicator`、`librsvg`
  （Arch：`webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg`）

产品目标是 macOS，但**开发可以在任何平台进行**：`bun run app:build` 按当前系统出对应产物，
所以在 Linux 上改完代码可以立刻本机构建、本机运行、本机验证。

## 日常

```bash
bun install
bun run dev        # 只跑前端，http://localhost:5174，改 UI 最快的回路
bun run app:dev    # 完整桌面应用（Tauri dev，首次编译 Rust 较慢）
```

`bun run dev` 用的是 web 实现的 `storage`（IndexedDB），`app:dev` 用的是 Tauri 实现（SQLite）。
两者数据互不相通——**在浏览器里导入的书，app 里看不到**，反之亦然。

## 检查

```bash
bun run lint       # eslint
bun run test       # vitest
bun run build      # tsc -b && vite build —— 类型检查在这一步
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI 跑的就是这一组：前端 job 在 Linux，Rust job 在 macOS（外壳链接 WKWebView，
在 gtk/webkit2gtk 上编译过只能证明另一件事）。

> 这条区别是有实际后果的：Linux 上跑的是 WebKitGTK，与 macOS 的 WKWebView 行为并不一致。
> 例如 WebKitGTK **不派发 `selectionchange`**，所以依赖它的选区检测在 Linux 上会静默失效——
> 见 `src/reader/renderer.ts` 里 `readSelectionFrom()` 的注释。在 Linux 上验证过的交互，
> 仍需在 macOS 上复验，反之亦然。Rust job 会先构建前端产物，
因为 `generate_context!` 要读 `frontendDist`。

## 打包

```bash
bun run app:build                  # 本机系统、本机架构
bun run app:build -- --no-bundle   # 只要可执行文件，跳过安装包（最快）
bun run app:build -- --bundles deb # 只打某一种格式
bun run app:build:universal        # macOS 专用：Intel + Apple silicon 合一
```

**脚本按 `process.platform` 分支**，产出各平台该有的东西，都落在
`.local/release/<version>/`，一个版本一个目录：

| 平台 | 产物 |
| --- | --- |
| macOS | `VeloRead.app` + `VeloRead_<version>_<arch>.dmg` |
| Linux | `VeloRead_<version>_amd64.deb`、`VeloRead-<version>-1.x86_64.rpm`、`.AppImage` |
| Windows | `.msi` / `.exe` |

不管哪个平台，可执行文件本身都在 `.local/target/release/veloread`，脚本最后会把
「怎么运行它」那行路径直接打出来。

### Linux 上的实际情况

**开发验证用 `--no-bundle` 就够了**，几十秒出一个可直接运行的可执行文件：

```bash
bun run app:build -- --no-bundle
./.local/target/release/veloread
```

打完整安装包时要知道两件事：

- **`.deb` / `.rpm` 在 Arch 上装不了。** 想要能从应用菜单启动的东西，只有 AppImage 有意义。
- **AppImage 需要 `libfuse2`。** Arch 默认只有 fuse3，缺它时 `linuxdeploy` 会失败并报
  `failed to run linuxdeploy`。这不会让整次构建作废——脚本会把已经成功的格式收好、
  把失败说清楚，可执行文件照常可用。装上 `libfuse2` 之后 AppImage 就能出。

这条「部分失败不算失败」是刻意的：Rust release 编译已经付出了，不该因为最后一个
打包格式缺个系统库就全部丢掉。

脚本是 [`scripts/build-app.ts`](../../scripts/build-app.ts)，它在 `tauri build` 之外做四件事：

1. **先卸载残留的磁盘映像。** 被中断的 `bundle_dmg.sh` 会把它的临时卷留在 `/Volumes/dmg.*`，
   下一次打包会在最后一步失败，而且只给你一句 `failed to run bundle_dmg.sh`——
   此时整个 Rust release 编译已经白跑了。
2. **把产物从四层深的目录复制出来。** `tauri build` 的输出路径还会随 `--target` 变化，
   `.local/release/<version>/` 不会。
3. **报告架构和签名状态**（macOS），因为这两条决定了产物能不能给别人。
4. **按平台分支**，并在 Linux 上容忍单个打包格式失败——见上一节。

`bun run clean` 清掉 `dist/` 和 `release/`；`bun run clean:all` 连 `target/` 一起（4 GB 左右）。

## 版本号

**改 `src-tauri/tauri.conf.json` 的 `version`，那是唯一来源**，并在
[`CHANGELOG.md`](../../CHANGELOG.md) 里同时开一节。`package.json` 与
`src-tauri/Cargo.toml` 跟着它写，打包脚本也从它读——产物文件名、
`.local/release/` 的目录名都由它决定。

## 关于架构

默认只出本机架构。Intel 机器上打出来的是 x86_64，拿到 Apple silicon 上要装 Rosetta 才能跑。
自己构建不会遇到这个问题——你就在目标机器上。`app:build:universal` 是给「一台机器打包、
另一台机器用」准备的，代价是编译两遍。

## 代码签名与分发

如需配置 macOS 官方代码签名与公证：

1. 配置 **Developer ID 证书** 签名与 `notarytool` 公证。
2. 构建 **universal binary**（`bun run app:build:universal`）兼顾 Intel 与 Apple silicon 架构。

## 产物目录

`.local/` 的完整布局见 [`.local/README.md`](../../.local/README.md)。
两条路径是被配置钉死的、不能随便挪：

- `.local/dist/` —— `src-tauri/tauri.conf.json` 的 `frontendDist`
- `.local/target/` —— `.cargo/config.toml` 的 `build.target-dir`
