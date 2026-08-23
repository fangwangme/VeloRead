# 安装词典

VeloRead 的划词释义使用一份本地英英词典。词典不进应用安装包：安装包目标小于 30 MB，词典则是
一份可以独立更新的 27.3 MB SQLite 资产。

## 第一次使用

1. 在桌面 App 里双击一个英文单词。
2. 释义浮层提示「离线英英词典尚未安装」，并显示下载大小。
3. 点击「下载词典」。浮层显示进度；下载完成后自动重新查询刚才仍然打开的单词。

只需下载一次。之后每次查词都是一条走索引的本地 SQLite 查询，不需要网络，也不会把整份词典
载入内存。下载失败可以原地重试；划线、笔记、全书搜索、复制和生词本仍然照常工作。

浏览器构建没有可以直接查询的原生 SQLite 文件，因此不会显示下载按钮；它仍可用于开发同一套
选词、划线和生词本交互。

## 下载安全

App 只从 VeloRead 固定的 GitHub Release 地址下载 `dictionary-v1`。响应先写入
`dictionary.db.part`，并在安装前验证：

- 文件大小：27,324,416 bytes
- SHA-256：`a1a35b05a3367dd0b58f73dcb69109f8a014db8219917a242fb455f58058a6fa`
- SQLite schema：1
- 词条数：102,217
- `PRAGMA quick_check`：`ok`

任一校验失败都会删除临时文件，不会替换已经安装的词典或影响用户数据库。

## 发布维护者

词典源文件是仓库外的 `.local/data/dictionary.json`。它是扁平的
`{ "word": "definition" }` JSON；用流式导入器生成发布资产：

```bash
bun run dict:import -- \
  .local/data/dictionary.json \
  .local/release/dictionary-v1/dictionary.db

sha256sum .local/release/dictionary-v1/dictionary.db
sqlite3 .local/release/dictionary-v1/dictionary.db \
  'PRAGMA user_version; SELECT COUNT(*) FROM entries; PRAGMA quick_check;'
```

发布位置是本仓库独立的 GitHub Release/tag `dictionary-v1`，资产名固定为 `dictionary.db`。
它不提交进 Git，也不需要跟随每个应用版本重复上传；只有词典内容或 schema 改变时才发布
`dictionary-v2` 并更新 App 内的固定资产契约。

源文件已通过 SHA-256 确认为
[`matthewreagan/WebstersEnglishDictionary` 的 `dictionary_compact.json`](https://github.com/matthewreagan/WebstersEnglishDictionary/blob/master/dictionary_compact.json)
精确副本（源文件 SHA-256：`16b12847a47cc1202e5e40a3a44b9ed2f749d23c0a5f0ad11fcbd4e8c6c3e33d`）。
上游说明原始词典来自 Project Gutenberg 的 *Webster's Unabridged English Dictionary*（2009 汇编），
JSON 示例输出按 GNU GPL v2 分发。

因此 `dictionary-v1` Release 必须同时上传：

- `dictionary.db`；
- `LICENSE-DICTIONARY.txt`：包含上面的来源、源文件 SHA-256、数据库 SHA-256，以及完整的
  GPL-2.0-only 许可证文本。

词典是独立下载的数据资产，不改变 VeloRead 程序代码本身的 MIT 许可证。
