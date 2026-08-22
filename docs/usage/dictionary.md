# 安装词典

VeloRead 的划词释义需要一份本地英英词典。**词典不进安装包** —— 安装体积目标是 30 MB 以内，
而词典源文件本身就有 22 MB（102,217 条）。所以它是装好应用之后单独放进去的一份资产。

放进去只需要做一次。之后每次查词都是一条走索引的 SQLite 查询，词典**不会**整包进内存。
背景与取舍见 [`docs/specs/vocabulary.md` §6](../specs/vocabulary.md#6-词典)。

## 词典源文件长什么样

一个扁平的 JSON 对象，键是词头，值是一整段释义散文：

```json
{
  "obviation": "The act of obviating, or the state of being obviated.",
  "silkness": "Silkiness. [Obs.] B. Jonson."
}
```

本仓库开发时用的那份在 `.local/data/dictionary.json`（**不入库**，见 `AGENTS.md`）。
任何同样形状的 JSON 都能用。

## 方式一：交给应用自己导入（推荐）

把源文件命名为 `dictionary.json`，放到应用数据目录，与 `veloread.db` 同级：

| 平台 | 应用数据目录 |
| --- | --- |
| macOS | `~/Library/Application Support/me.fangwang.veloread/` |
| Linux | `~/.local/share/me.fangwang.veloread/` |
| Windows | `%APPDATA%\me.fangwang.veloread\` |

下次启动时应用会流式导入一次，生成同目录下的 `dictionary.db`（约 26 MB）。
导入完成后源文件就没用了，可以删掉。

> 目录名以 `src-tauri/tauri.conf.json` 里的 `identifier` 为准。

## 方式二：命令行先建好

在仓库里：

```bash
bun run dict:import -- .local/data/dictionary.json ~/.local/share/me.fangwang.veloread/dictionary.db
```

输出形如：

```
imported 102217 entries into …/dictionary.db in 0.4s
```

这条命令跟应用内导入走的是同一份实现（`src-tauri/src/dictionary.rs`），
只是入口不同。适合在跑不了应用的机器上准备词典，或者想先确认源文件没问题。

## 确认装好了

打开书库 → **生词本**，面板底部会写着词典条目数（例如「词典 102,217 条」）；
没装则写「未安装词典」。装好之后，在书里选中一个英文单词，释义会直接弹出来。

## 没有词典会怎样

不会坏，只是查不到词：

- 浮层照常弹出，释义区写明「此版本没有词典」；
- 划线、笔记、全书搜索、复制、**收进生词本**全都照常可用；
- 生词本里的词形归并退化成纯规则版（`runs` / `ran` / `stopped` 仍然正确，
  `anopheles` 这类会被误还原）。

浏览器构建（`bun run dev`）**始终**处于这个状态：页面里没法给 22 MB 建磁盘索引，
而整包读进内存正是桌面版存在的理由所要避免的事。
