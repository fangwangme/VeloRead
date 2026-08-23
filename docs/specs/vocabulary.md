# 划词与生词本

> 状态：✅ 已实现（划词释义、生词本、导出）。**从 Kindle `vocab.db` 导入（§7）仍是 📋 规划中**。
> 参照物：Kindle 的 Vocabulary Builder（`vocab.db`）。
> 相关：[annotations](annotations.md)、[platform-and-storage](platform-and-storage.md)、
> [用法：安装词典](../usage/dictionary.md)

## 1. 范围

**做**：划词查询、词形还原、生词本、**导出 txt**、**从 Kindle 导入**。

**不做**：`.apkg` 生成、AnkiConnect 直连、内置背单词/间隔重复。
我们的立场是**把数据交出去**，让用户用自己的工具处理。

## 2. 核心动机

Kindle 有生词本，会自动记录你查过的词和**所在句子**。
但它**导不出来** —— 数据锁在设备里。

**这正是 VeloRead 要解决的**：同样记录查词行为，但数据完全属于用户，
随时能导出成纯文本用于扩充词库、做卡片、或任何后续处理。

## 3. 功能

- 选中单词 → 即时查询本地词典，弹出释义（英英）
- **词形还原**：查询前做基本还原（复数、时态、比较级），避免查不到
- **记录查询行为**：查过入库，但桌面端有一道入库门槛，见 §3.2
- 生词本页面：列表、按书筛选、删除
- **手动导出为 txt**

以下三条是实现期谈定的行为契约，此前不在 spec 里。

### 3.1 释义零点击，浮层是动作枢纽

选中单个词**直接弹出释义**，不需要再点一次「查询」。对标 Kindle 的长按即出释义。
Apple Books 走 macOS 通用文本菜单、Look Up 要多一步，**明确不采纳** ——
那把最高频的动作放进了第二层。

浏览器与桌面 App 必须走同一结果契约，但不能假设它们派发相同事件：Chromium 可由
`selectionchange` 通知，WebKitGTK / WKWebView 必须在 `mouseup` / `dblclick` 手势结束后延迟读取
已经稳定的原生 `Selection`。`dblclick` 不得取消延迟读取后只做一次同步读取；那一刻 WebKit 可能
还没有提交选区，词典与划线会一起静默失效。部分 WebKit 端口会画出原生选区却完全不派发这些
DOM 通知，实机还会同时漏掉 iframe 内的 `mouseup` / `dblclick`，因此 Tauri 桌面端必须持续观察
当前 EPUB iframe 的 `Selection`；浏览器端已有可靠事件，不能承担这条常驻轮询。轮询读到的 CFI
必须幂等：一次短暂空读不得清空已观察 CFI、让静止选区再次上报；新手势才重置去重边界，因此
一次手势只能打开一个浮层，用户发起新手势后则可以立刻再次选中同一个词。

弹出的浮层是**枢纽而不是终点**：查完可以直接收进生词本 / 标已掌握、划线（复用已有颜色与笔记）、
全书搜这个词、复制，全程不需要重新选中。这条继承划线浮层已有的原则 ——
选颜色会保存但不关闭浮层，好让笔记接着写。

**查词不等于划线**：选词只创建内存中的临时选区并打开浮层，不能写入 `annotations`。只有用户
明确选择划线颜色，或保存一条附着于该选区的笔记之后，才创建/更新 highlight 记录。

桌面端第一次查词而词典尚未安装时，释义区原地提供一次明确的下载确认，显示资产大小；不能因为
双击了一个词就静默消耗网络。下载显示进度，成功后自动重试当前仍然打开的单词。失败可重试，且
不得影响同一浮层里的划线、笔记、搜索、复制和生词本动作。浏览器端没有原生 SQLite 安装目标，
继续显示不可用说明，不展示一个注定失败的下载按钮。

安装期间词典文件需要关闭，才能在 Windows 上原子替换；这时只有实际 `lookup` 暂停，`init/status`
仍必须返回「未就绪 + 可下载」状态。用户中途换词或打开生词本，下载进度不能消失，用户数据列表
也不能因为词典安装锁而报错。

### 3.2 桌面端的入库门槛

§3 原本写的「查过即入库，不需要用户额外操作」是照 Kindle 长按写的。桌面上双击选词极容易误触
（定位光标、清选区、手滑都会选中一个词），自动入库会污染生词本的信噪比 ——
而生词本的价值恰恰在信噪比。

**弹释义免费，入库需要意向证据**，二者取其一即可：

- 浮层存活超过 `LOOKUP_INTENT_DWELL_MS`（当前 1200 ms）；或
- 用户对该词做了任何进一步动作（收进生词本、标已掌握、划线、全书搜、复制）

阈值是 `src/vocabulary/intent.ts` 里的具名常量，判定逻辑是一个不碰 React 的纯函数，有单测覆盖
两个方向：立刻取消不产生 `vocabulary_lookups` 行，超过阈值或有后续动作才产生。

**重开已有划线不是一次新查词**：点击或重新选中已有划线可以显示同一个释义/操作浮层，但仅仅
停留或复制、搜索都不新增 `vocabulary_lookups`；用户明确点击加入生词本时才允许写入。

### 3.3 浮层「结构固定，内容可空」

- **释义区永远在浮层顶部**。选中多个词时**整区不渲染** —— 一个句子没有词典释义，
  渲染一个空盒子说「没有释义」只是家具。这是「某一区有没有内容」，不是两套不同的浮层。
- **操作行的按钮在两种情况下完全一致**：同样的按钮、同样的顺序，不因选中长度重排。
  位置一飘，肌肉记忆就建立不起来。因此**不适用的按钮是原地置灰，而不是移除** ——
  「删除划线」也因此从「有划线才出现」改成常驻、无划线时禁用。
- 释义区高度封顶并自行滚动：当前上限为 `12rem`（原 `6rem` 的两倍）。Webster 的一条释义可以
  长达数百词，浮层高度随词变化会让它下面的操作行跟着动。
- Webster 同一词性的连续义项按编号换行，`1.`、`2.`、`3.` 各自另起一行；章节引文中的
  `Gen. vii. 17.`、`Col. iii. 2.` 等编号不作为义项误断行。

操作行顺序（由组件测试锁定）：`vocabulary` · `note` · `search` · `copy` · `delete`。

## 4. 数据模型（借鉴 Kindle vocab.db）

Kindle 的结构值得直接借鉴，因为它抓对了要点：**词 + 词干 + 出处 + 例句**。

Kindle 的 `WORDS(id, word, stem, lang, category, timestamp)` 与
`LOOKUPS(id, word_key, book_key, dict_key, pos, usage, timestamp)`，
其中 `usage` 就是包含该词的原句。

我们的版本：

```sql
-- 一个词一行
CREATE TABLE vocabulary (
    id         TEXT PRIMARY KEY,
    word       TEXT NOT NULL,      -- 原始形态
    stem       TEXT NOT NULL,      -- 词形还原后的词干
    lang       TEXT NOT NULL,
    status     TEXT NOT NULL,      -- 'learning' | 'known'
    created_at TEXT NOT NULL,
    UNIQUE(stem, lang)
);

-- 每次查询一行：同一个词在不同书里的多次出现都保留
CREATE TABLE vocabulary_lookups (
    id            TEXT PRIMARY KEY,
    vocabulary_id TEXT NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
    book_id       TEXT REFERENCES books(id) ON DELETE SET NULL,
    locator       TEXT,            -- JSON Locator，出处
    sentence      TEXT NOT NULL,   -- 所在句子，对应 Kindle 的 usage
    created_at    TEXT NOT NULL
);
CREATE INDEX vocab_lookups_word ON vocabulary_lookups(vocabulary_id, created_at DESC);
```

**为什么 lookups 单独一张表**：同一个词你可能在三本书里查过三次，
三个例句都有价值。Kindle 就是这么设计的，合并成一行会丢信息。

**`book_id` 用 `ON DELETE SET NULL`** 而不是 CASCADE：删掉书不该连带删掉学过的词。

## 5. 词形还原

- 英文：规则化处理复数、时态、比较级、副词后缀，外加一张不规则形态表（`ran` → `run`）
- 先查原形，查不到再还原后重查
- 还原结果存 `stem`，去重按 `stem` 而不是 `word` —— 否则 `running` 和 `run` 会是两条

实现（`src/vocabulary/lemma.ts`）：**「读哪条词条」和「归到哪一行」是两个不同的问题**，
一次查询同时回答。前端把「原形 + 各级还原形」按顺序发给平台层，平台层返回**所有命中的候选**：

- **释义**取第一个命中的候选 —— 这就是「先查原形」。
- **`stem`** 取第一个命中的**还原形**；一个都没命中时，若原形自己是词条则用原形，否则用首选还原形。

这两条分开是必要的：`running` 自己有词条（读它的词条是对的），但仍必须归到 `run`，
否则生词本里会有两条 `run`；反过来 `anopheles` 以 `s` 结尾，规则会造出 `anophele`，
只有词典能说明它本身就是原形。

浏览器实现没有词典，只剩规则，规则形态（`runs` / `ran` / `cities` / `stopped`）仍然正确，
`anopheles` 这类则会退化 —— 这是降级实现讲明的代价。

## 6. 词典

- 数据源：`.local/data/dictionary.json`（22 MB / 102,217 条，Project Gutenberg 的 Webster
  英英词典 JSON 输出），**不入库**
- **必须导入 SQLite 并建索引，不整包载入内存**（旧实现是整包 fetch，首屏和内存压力都大）
- 查询响应目标 < 50 ms
- 词典导入是一次性的构建步骤，产物落在应用数据目录

### 6.1 独立文件，不是 `veloread.db` 里的一张表（本次谈定）

产物是 `<app_data_dir>/dictionary.db`，与 `veloread.db` 同级但**互不相干**。理由：

- 词典是**只读派生资产** —— 由源文件生成、人人相同、删掉重建谁也不会丢东西。
- 放进 `veloread.db` 会让 10 万条散文跟着用户数据的 `PRAGMA user_version` 迁移阶梯走，
  跟着每一次用户数据备份走，并且把「重建词典」从「删一个文件」变成一次迁移。
- 因此它有**自己的** `DICTIONARY_SCHEMA_VERSION`，抬版本号的含义就是「扔掉重导」。

表结构是普通 rowid 表 + 词头唯一索引，**不用 `WITHOUT ROWID`**：一条释义是一整段散文，
在 `WITHOUT ROWID` 表里这些散文会挤在主键 B-tree 里、溢出到 overflow page，
每次查询要走的树反而更大。把正文留在表里、只检索一份纯词头的索引，被搜的那部分才够小。

### 6.2 构建与按需安装

源文件不进安装包（安装体积目标 < 30 MB，见 [overview §8](overview.md#8-非功能要求)）。
维护者用同一份流式导入实现生成预建 SQLite：

- **构建入口**：`bun run dict:import -- <source.json> <dictionary.db>`。
- **发布位置**：独立的 GitHub Release `dictionary-v1`，不提交进 Git，也不随每个应用版本重复上传。
- **用户入口**：第一次查词浮层中的「下载词典」。应用下载预建 `dictionary.db`，不下载 JSON，
  不要求用户操作隐藏目录。

导入用 serde 的 map visitor **流式**写入，而不是先反序列化成 `HashMap` ——
否则「词典不进内存」这条规矩会恰好在导入那一刻被自己破坏。

下载资产契约固定为 `dictionary-v1`：102,217 条、27,324,416 bytes、schema 1、SHA-256
`a1a35b05a3367dd0b58f73dcb69109f8a014db8219917a242fb455f58058a6fa`。Rust 端流式写入
`.part`，依次验证大小、摘要、schema、真实词条数与 `PRAGMA quick_check`，通过后才替换正式库。
大小与 SHA-256 是已发布资产的下载安全契约；本地重新导入的开发测试只断言 schema、条数与
`quick_check`，不把 SQLite/rusqlite 未来版本生成的文件误要求为字节级可复现。
本地源文件的 SHA-256 与上游 `matthewreagan/WebstersEnglishDictionary` 的
`dictionary_compact.json` 完全一致；其 JSON 输出按 GPL-2.0-only 分发。Release 必须随
`dictionary.db` 提供完整许可证、上游来源及源文件/数据库摘要。

## 7. 从 Kindle 导入

解析 `Kindle/system/vocabulary/vocab.db`（SQLite）：

- `WORDS.word` → `vocabulary.word`，`WORDS.stem` → `stem`
- `LOOKUPS.usage` → `vocabulary_lookups.sentence`
- `LOOKUPS.book_key` → 尝试按书名匹配本地书库；匹配不上则 `book_id = NULL`，
  但**保留例句**（例句本身就有价值，即使找不到出处）
- `locator` 留空 —— Kindle 的位置无法映射到我们的 `Locator`，不要假装可以

## 8. 导出

纯文本，一词一段，包含：单词 / 词干 / 释义 / 例句 / 出处 / 时间。
格式要便于脚本处理（稳定的分隔符），并在文件头写明字段顺序。

导出后不做「已导出」标记 —— 保持简单，每次都是全量。

## 9. 验收要点

- 查询响应 < 50 ms（词典入 SQLite 后实测）
- 浮层：选中单词与选中句子，操作行按钮的顺序与结构完全相同（组件测试锁定）
- 入库门槛：选中后立刻取消不产生 lookup 行；超过阈值或有后续动作才产生
- 词形还原：`running`/`ran`/`runs` 都归到 `run`
- 同一个词在两本书查询 → 一条 vocabulary、两条 lookups，两个例句都在
- 删除书籍后，该书贡献的生词仍在，`book_id` 变 NULL
- 导入真实 Kindle `vocab.db`，词与例句完整
- 导出文件可被简单脚本解析（用一段 20 行的解析脚本验证）
