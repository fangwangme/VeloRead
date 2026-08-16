# 划词与生词本

> 状态：📋 规划中。
> 参照物：Kindle 的 Vocabulary Builder（`vocab.db`）。
> 相关：[annotations](annotations.md)、[platform-and-storage](platform-and-storage.md)

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

- 选中单词 → 即时查询本地词典，弹出释义（英英为主，可选中文）
- **词形还原**：查询前做基本还原（复数、时态、比较级），避免查不到
- **自动记录查询行为**：查过即入库，不需要用户额外操作 —— 这是 Kindle 做对的地方，
  因为「查词」本身就是「不认识」的信号
- 生词本页面：列表、按书筛选、删除
- **手动导出为 txt**

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

- 英文：规则化处理复数、时态、比较级、副词后缀
- 先查原形，查不到再还原后重查
- 还原结果存 `stem`，去重按 `stem` 而不是 `word` —— 否则 `running` 和 `run` 会是两条

## 6. 词典

- 数据源：`.local/data/dictionary.json`（22 MB，GCIDE 风格英英词典），**不入库**
- **必须导入 SQLite 并建索引，不整包载入内存**（旧实现是整包 fetch，首屏和内存压力都大）
- 查询响应目标 < 50 ms
- 词典导入是一次性的构建步骤，产物落在应用数据目录

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
- 词形还原：`running`/`ran`/`runs` 都归到 `run`
- 同一个词在两本书查询 → 一条 vocabulary、两条 lookups，两个例句都在
- 删除书籍后，该书贡献的生词仍在，`book_id` 变 NULL
- 导入真实 Kindle `vocab.db`，词与例句完整
- 导出文件可被简单脚本解析（用一段 20 行的解析脚本验证）
