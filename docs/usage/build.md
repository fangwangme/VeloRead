# 构建与运行

**VeloRead 提供 GitHub Releases 自动构建的 `.dmg` 安装包，也可以在本地直接通过源码构建。**

### 关于预编译包与 macOS Gatekeeper

由于开源构建尚未集成付费的 Apple Developer ID 证书签名，从 GitHub Releases 下载的 `.dmg` / `.app` 在 macOS 上初次打开时可能被 Gatekeeper 拦截（提示无法验证开发者或文件损坏）。

- **打开方式**：在 Finder 中右键点击应用并选择「打开」，或在终端执行 `xattr -cr /Applications/VeloRead.app` 移除隔离属性。
- **本地构建优势**：本地通过 `bun run app:build` 编译生成的产物由系统认定为本地创建，不会被打上隔离标记，双击即可直接运行。

## 前置

- [bun](https://bun.sh)
- Rust 工具链（[rustup](https://rustup.rs)）
- Xcode Command Line Tools：`xcode-select --install`

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
在 gtk/webkit2gtk 上编译过只能证明另一件事）。Rust job 会先构建前端产物，
因为 `generate_context!` 要读 `frontendDist`。

## 打包

```bash
bun run app:build              # 本机架构
bun run app:build:universal    # Intel + Apple silicon 合一
```

产物落在 **`.local/release/<version>/`**，一个版本一个目录：

```
.local/release/0.1.0/
  VeloRead.app
  VeloRead_0.1.0_x64.dmg
```

脚本是 [`scripts/build-app.ts`](../../scripts/build-app.ts)，它在 `tauri build` 之外做三件事：

1. **先卸载残留的磁盘映像。** 被中断的 `bundle_dmg.sh` 会把它的临时卷留在 `/Volumes/dmg.*`，
   下一次打包会在最后一步失败，而且只给你一句 `failed to run bundle_dmg.sh`——
   此时整个 Rust release 编译已经白跑了。
2. **把产物从四层深的目录复制出来。** `tauri build` 的输出路径还会随 `--target` 变化，
   `.local/release/<version>/` 不会。
3. **报告架构和签名状态**，因为这两条决定了产物能不能给别人。

`bun run clean` 清掉 `dist/` 和 `release/`；`bun run clean:all` 连 `target/` 一起（4 GB 左右）。

## 版本号

**改 `src-tauri/tauri.conf.json` 的 `version`，那是唯一来源**，并在
[`CHANGELOG.md`](../../CHANGELOG.md) 里同时开一节。 `package.json` 跟着它写，
打包脚本也从它读——产物文件名、`.local/release/` 的目录名都由它决定。

## 关于架构

默认只出本机架构。Intel 机器上打出来的是 x86_64，拿到 Apple silicon 上要装 Rosetta 才能跑。
自己构建不会遇到这个问题——你就在目标机器上。`app:build:universal` 是给「一台机器打包、
另一台机器用」准备的，代价是编译两遍。

## 关于代码签名与分发

如果要消除 Gatekeeper 拦截提示，需要配置：

1. **Developer ID 证书**签名，加 `notarytool` 公证。仅签名不公证，Gatekeeper 一样拦截。
2. **universal binary**（`bun run app:build:universal`），以兼顾 Intel 和 Apple silicon 架构。

## 产物目录

`.local/` 的完整布局见 [`.local/README.md`](../../.local/README.md)。
两条路径是被配置钉死的、不能随便挪：

- `.local/dist/` —— `src-tauri/tauri.conf.json` 的 `frontendDist`
- `.local/target/` —— `.cargo/config.toml` 的 `build.target-dir`
