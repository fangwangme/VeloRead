# 平台适配层与存储

> 状态：✅ `storage` 已实现（Tauri + web 两份）。`fs` / `dict` 待各自功能落地时定义。
> 相关：[overview](overview.md)、[reading-formats](reading-formats.md)

## 1. 适配层

`AGENTS.md` 的硬性约定：**前端组件不直接 `import { invoke }`**。
所有原生能力走接口，Tauri 与 web 各一份实现，浏览器目标（`bun run dev`）始终可跑。

```
src/platform/
  types.ts          能力契约
  sort.ts           书架排序，两份实现共用同一套语义
  index.ts          运行时选择实现 + 一次性 init
  tauri/storage.ts  Tauri 实现（IPC → Rust）
  web/storage.ts    浏览器实现（IndexedDB）
```

- `getStorage()` 返回单例 Promise，内部已调用过 `init()`；init 失败不缓存，下次调用重试
- 两份实现走动态 `import()`，web 产物里不会打进 `@tauri-apps/api`
- 运行时判定用 `'__TAURI_INTERNALS__' in window`（Tauri v2 在应用脚本之前注入）

三类能力：

| 能力 | 用途 | 状态 |
| --- | --- | --- |
| `storage` | 书库、进度、按书/应用设置、书签、阅读统计 | ✅ 已实现 |
| `fs` | 摘抄/生词导出，Kindle 文件导入 | 📋 待 [annotations](annotations.md) 落地时定义 |
| `dict` | 词典查询 | 📋 待 [vocabulary](vocabulary.md) 落地时定义 |

`fs` / `dict` **刻意还没定义接口** —— 先写一份必然被推翻的契约没有价值。
新增时按 `storage` 的同构方式组织。

## 2. StoragePort（当前）

| 方法 | 说明 |
| --- | --- |
| `init()` | 打开/创建底层存储，幂等 |
| `listBooks()` | 按书架顺序返回全部书籍元数据（不含书本字节） |
| `addBook({record, data, cover})` | 写入元数据 + 文件字节 + 封面字节 |
| `deleteBook(id)` | 删除元数据、文件、封面、进度、按书设置、书签与阅读 session |
| `readBookFile(id)` | 书本字节；缺失时抛错 |
| `readCover(id)` | 封面字节，无封面返回 `null` |
| `getProgress(bookId)` | 阅读位置，从未读过返回 `null` |
| `saveProgress(progress)` | upsert 进度，并把 `books.lastReadAt` 更新为同一时间戳 |
| `listCollections()` / `saveCollection(c)` / `deleteCollection(id)` | 合集的增删改；删除合集不动书籍 |
| `setBookCollections(bookId, ids)` / `listCollectionMembership()` | 整体替换一本书的归属；一次取回全部归属供书架筛选 |
| `listAnnotations(bookId)` / `saveAnnotation(a)` / `deleteAnnotation(id)` | 划线与笔记的增删改，`saveAnnotation` 是 upsert |
| `getBookSettings(bookId)` / `saveBookSettings(settings)` | 读取 / upsert 当前书籍的排版、flow 与 Pacer 覆盖值 |
| `getAppSettings()` / `saveAppSettings(partial)` | 读取 / 合并保存全局外观、界面语言、Pacer 默认值、高亮样式与每日目标 |
| `listBookmarks(bookId)` / `addBookmark()` / `deleteBookmark()` | 按书管理书签 |
| `recordReadingSession(session)` | 按稳定 session id 累加有效时长、英文词数与 CJK 字符数 |
| `getReadingStats()` | 汇总总量、每日数据、阅读书数与连续天数 |

**书架顺序**：`lastReadAt` 降序（未读的排后面），并列时 `addedAt` 降序。
web 侧用 `compareBooks()`，Tauri 侧用 `ORDER BY COALESCE(last_read_at,'') DESC, added_at DESC`。
**两者语义必须一致，改一处必须改另一处。**

**合集顺序**：按名称的 **Unicode 码点**升序，同名以 `id` 兜底成全序。
SQLite 的 `ORDER BY name` 是 UTF-8 字节序，等价于码点序；JS 的 `<` 比的是 UTF-16 码元，
星平面字符（合集名里的 emoji）会排到 U+E000–U+FFFF 之前，和 SQLite 相反。
`compareCodePoints()` 逐码点比较，两端因此一致。

**`AppSettings` 是一个 JSON 值**（`app_settings` 表的 `global` 行），不拆列：
它是一组松散的偏好，加一项不该动 schema。当前包含
`themeMode` / `language` / `defaultStyleId` / `flow` /
`pacerWpm` `pacerCpm` `pacerChunkSize` `pacerCjkCharCount` /
`pacerHighlightColor` `pacerHighlightOpacity` `pacerHighlightShape` /
`dailyReadingGoalMinutes`。缺省一律由读取处补全，**存储层不写默认值**，
这样改默认值不需要迁移已存的行。

**时间戳**一律由前端生成 ISO-8601 字符串，存储层不自己取时钟。

## 3. Tauri 侧

选择**自建 Rust 命令 + `rusqlite`**，而不是 `tauri-plugin-sql`：

- 书页内容是不可信 HTML。该插件把任意 SQL 执行能力暴露给整个 webview，
  对一个专门加载他人书籍的应用是不必要的攻击面。
- 书籍文件仍要落盘。用插件还得再引 `tauri-plugin-fs` 并给它开目录 scope；
  自建命令让**路径拼接完全留在 Rust**，前端只传 id。
- 导入是「插元数据 + 写文件」的复合操作，放在一个命令里才能在失败时回滚。

代价：SQLite 由 `rusqlite` 的 `bundled` feature 编进产物，首次编译较慢。
capabilities 保持 `core:default` —— 应用自己的命令不需要声明权限，没有开任何通配 scope。

### 磁盘布局

```
<app_data_dir>/
  veloread.db            SQLite
  library/<id>.epub      书本原文件
  library/<id>.cover     封面原始字节（mime 记在 books.cover_mime）
```

`<id>` 来自前端 `crypto.randomUUID()`。Rust 在拼路径前校验它只含
`[A-Za-z0-9-]` 且长度 ≤ 64 —— 这是 webview 唯一能影响文件路径的地方。

### IPC 载荷约定

Tauri v2 只在**整个参数就是一个 buffer** 时才走原始 body，因此两个方向策略不同：

- **读** 返回 `tauri::ipc::Response`，前端拿到 `ArrayBuffer`，零编码开销。
  无封面时返回空 body，前端按 `null` 处理。
- **写** 用 base64 字符串。多花 33% 体积，但只在每本书导入时发生一次，
  换来一个普通的命令签名（用 `Vec<u8>` 参数会被 JSON 编码成几百万个数字的数组）。

### 代码组织

SQL 与路径逻辑放在 `library.rs` 的 `store` 子模块 —— 一组只依赖 `&Connection` / `&Path`
的普通函数，因此不用起 Tauri app 就能测。

## 4. 浏览器侧

IndexedDB（库名 `veloread`），字节单独放 store，列书架时不会反序列化书本内容：

| store | key | value |
| --- | --- | --- |
| `books` | `id`（keyPath） | `BookRecord` |
| `files` | 外部 key = 书 id | `ArrayBuffer` |
| `covers` | 外部 key = 书 id | `ArrayBuffer` |
| `progress` | `bookId`（keyPath） | `ReadingProgress` |
| `book_settings` | `bookId`（keyPath） | `BookSettings` |
| `app_settings` | `key = global`（keyPath） | `AppSettings` |
| `bookmarks` | `id`（keyPath），`by_bookId` 索引 | `Bookmark` |
| `annotations` | `id`（keyPath），`by_bookId` 索引 | `Annotation` |
| `collections` | `id`（keyPath） | `Collection` |
| `collection_books` | 复合 keyPath `[collectionId, bookId]`，`by_bookId` / `by_collectionId` 索引 | 关联行 |
| `reading_sessions` | `id`（keyPath），`by_date` / `by_bookId` 索引 | `ReadingSession` |

`collection_books` 用复合主键而不是自增 id：同一对「合集 × 书」重复写入只会覆盖同一行，
归类操作因此天然幂等。

## 5. SQLite schema

### v1（历史基线）

```sql
CREATE TABLE books (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    author       TEXT,
    language     TEXT,
    cover_mime   TEXT,
    file_size    INTEGER NOT NULL,
    added_at     TEXT NOT NULL,
    last_read_at TEXT
);
CREATE TABLE reading_progress (
    book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    cfi        TEXT,
    percentage REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
```

### v2（历史开发基线）

配合多格式与阅读设置：

```sql
ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub';

-- cfi → 格式无关的 locator
ALTER TABLE reading_progress ADD COLUMN locator TEXT;   -- JSON Locator
-- 迁移：把已有 cfi 包成 {"format":"epub","cfi":...} 写入 locator

CREATE TABLE book_settings (
    book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    style_id   TEXT NOT NULL,
    overrides  TEXT NOT NULL,        -- JSON StyleOverride
    flow       TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL              -- JSON
);

CREATE TABLE bookmarks (
    id         TEXT PRIMARY KEY,
    book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    cfi        TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE reading_sessions (
    id               TEXT PRIMARY KEY,
    book_id          TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    date             TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    words_read       INTEGER NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX idx_sessions_date ON reading_sessions(date);
```

### v3（英文 / CJK 两套阅读量）

Pacer 使用英文 / CJK 两套参数，统计也拆成含义明确的两类阅读量：

```sql
CREATE TABLE book_settings (
    book_id              TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    style_id             TEXT NOT NULL,
    overrides            TEXT NOT NULL,
    flow                 TEXT,
    pacer_wpm            INTEGER,
    pacer_cpm            INTEGER,
    pacer_chunk_size     INTEGER,
    pacer_cjk_char_count INTEGER,
    updated_at           TEXT NOT NULL
);

CREATE TABLE reading_sessions (
    id                  TEXT PRIMARY KEY,
    book_id             TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    date                TEXT NOT NULL,
    duration_seconds    INTEGER NOT NULL,
    latin_words_read    INTEGER NOT NULL,
    cjk_characters_read INTEGER NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX idx_sessions_date ON reading_sessions(date);
```

### v4 / v5（当前，已实现）

划线笔记与书库合集各自新增表，都只是 `CREATE TABLE IF NOT EXISTS`，不触碰已有数据：

```sql
-- v4：划线与笔记。字段说明与设计取舍见 annotations.md
CREATE TABLE annotations (
    id            TEXT PRIMARY KEY,
    book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    cfi_range     TEXT NOT NULL,
    text          TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL,
    chapter_title TEXT,
    source        TEXT NOT NULL DEFAULT 'local',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_annotations_book ON annotations(book_id, created_at);

-- v5：书库合集。一本书可属于多个，成员关系单独成表
CREATE TABLE collections (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE collection_books (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, book_id)
);
CREATE INDEX idx_collection_books_book ON collection_books(book_id);
```

`collections` 的列表顺序是 `ORDER BY name`（码点序），**web 端必须给出同样的顺序** ——
两端对同一份数据返回不同排序是真实的实现分歧，排序规则因此收在 `platform/sort.ts`。

后续模块各自新增的表见
[vocabulary](vocabulary.md#4-数据模型借鉴-kindle-vocabdb)。

schema 版本由 Tauri 的 `PRAGMA user_version` 与 Web IndexedDB version 共同维护。当前应用尚未发布，
v2 的 `words_read` 是英文词与 CJK 字符的混合值，无法可靠拆分；升级到 v3 时会重建
`book_settings` 与 `reading_sessions`，不承担这两类开发数据的迁移。`books`、书籍文件、封面与
`reading_progress` 必须保留，并由两端测试锁定。正式发布后，schema 升级必须提供非破坏性迁移。

**那段重建逻辑的上界必须钉死在 3，不能写成 `< SCHEMA_VERSION`。** 它存在的唯一理由是 v3 之前
的混合字数，写成开放上界的话，此后每次抬版本号都会顺带删掉用户真实的按书设置与阅读统计。
两端各有一处：Rust 的 `version > 0 && version < 3`，web 的 `MIXED_WORD_COUNT_VERSION`。

## 6. 测试约定

- **测试用书由脚本现场生成，不下载任何书籍**。`src/test/fixture-epub.ts` 用 JSZip
  拼一本最小但合法的 EPUB；内容刻意放在 `OEBPS/` 下，好让 href 解析真的被覆盖到。
  `bun run fixture` 可把一本较长的 fixture 写到 `.local/fixtures/`，供手动 smoke 用。
- 前端单测跑在 jsdom + `fake-indexeddb` 上 —— 测真实的 IndexedDB 实现，而不是手写的桩。
- Rust 侧 SQL 与路径逻辑是纯函数，用内存 SQLite 测，不起 Tauri app。
- **真实用户书籍（大体积、复杂排版）的表现，fixture 覆盖不到** ——
  性能类验收必须用真实书籍手动验证。

## 7. 验收要点

- 两份实现的书架顺序语义一致（各自有测试）
- 进度写入后读回完全一致
- 删除书籍后元数据、文件、封面、进度、设置、书签和阅读 session 都不残留
- id 校验挡掉所有可能逃出书库目录的输入（`..`、`a/b`、`/absolute`、超长）
- 开发期 v2 → v3 重建设置/统计时，书籍与阅读进度仍可读；正式发布后的升版必须有数据迁移测试
