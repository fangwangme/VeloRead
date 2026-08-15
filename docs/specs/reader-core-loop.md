# 阅读最小闭环：平台适配层、书库存储、渲染层

本文记录「导入 EPUB → 渲染翻页 → 进度持久化」这条闭环的架构与数据形状。Pacer、划线、
划词都会挂在这套结构上，改动这里等于改动它们的地基。

## 1. 平台适配层

`AGENTS.md` 的硬性约定：前端组件不直接 `import { invoke }`。所有原生能力走接口，
Tauri 与 web 各一份实现，浏览器目标（`bun run dev`）始终可跑。

```
src/platform/
  types.ts          能力契约（当前只有 StoragePort）
  sort.ts           书架排序，两份实现共用同一套语义
  index.ts          运行时选择实现 + 一次性 init
  tauri/storage.ts  Tauri 实现（IPC → Rust）
  web/storage.ts    浏览器实现（IndexedDB）
```

- `getStorage()` 返回单例 Promise，内部已调用过 `init()`；init 失败不会被缓存，下次调用重试。
- 两份实现走动态 `import()`，所以 web 产物里不会打进 `@tauri-apps/api`。
- 运行时判定用 `'__TAURI_INTERNALS__' in window`，Tauri v2 在应用脚本之前注入。

`fs`（摘抄导出）与 `dict`（词典查询）两类能力本次**没有**定义接口 —— 等到需要它们的功能
落地时再定，避免先写一份必然被推翻的契约。新增时按 `storage` 的同构方式组织。

### StoragePort 契约

| 方法 | 说明 |
| --- | --- |
| `init()` | 打开/创建底层存储，幂等 |
| `listBooks()` | 按书架顺序返回全部书籍元数据（不含书本字节） |
| `addBook({record, data, cover})` | 写入元数据 + `.epub` 字节 + 封面字节 |
| `deleteBook(id)` | 删除元数据、文件、封面、进度，四者一起 |
| `readBookFile(id)` | 书本字节；缺失时抛错 |
| `readCover(id)` | 封面字节，无封面返回 `null` |
| `getProgress(bookId)` | 阅读位置，从未读过返回 `null` |
| `saveProgress(progress)` | upsert 进度，并把 `books.lastReadAt` 更新为同一时间戳 |

**书架顺序**：`lastReadAt` 降序（未读的排后面），并列时 `addedAt` 降序。
web 侧用 `compareBooks()`，Tauri 侧用 `ORDER BY COALESCE(last_read_at,'') DESC, added_at DESC`，
两者语义一致，改一处必须改另一处。

**时间戳**一律由前端生成 ISO-8601 字符串，存储层不自己取时钟。

## 2. Tauri 侧存储

选择**自建 Rust 命令 + `rusqlite`**，而不是 `tauri-plugin-sql`：

- 书页内容是不可信 HTML。`tauri-plugin-sql` 把任意 SQL 执行能力暴露给整个 webview，
  对一个专门加载他人 EPUB 的应用来说是不必要的攻击面。
- 书籍文件仍要落盘。用插件方案还得再引 `tauri-plugin-fs` 并给它开一段目录 scope；
  自建命令让**路径拼接完全留在 Rust**，前端只传 id。
- 导入是「写文件 + 插元数据」的复合操作，放在一个命令里才能在失败时把已写文件清掉。

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
`[A-Za-z0-9-]` 且长度 ≤ 64，非法 id 直接报错 —— 这是唯一一处 webview 能影响路径的地方。

### SQLite schema（`PRAGMA user_version = 1`）

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

迁移按 `user_version` 递进，写在 `src-tauri/src/library.rs` 的 `migrate()` 里。

### IPC 载荷约定

Tauri v2 只在**整个参数就是一个 buffer** 时才走原始 body，因此两个方向用不同策略：

- **读**（`library_read_book_file` / `library_read_cover`）返回 `tauri::ipc::Response`，
  前端拿到 `ArrayBuffer`，零编码开销。无封面时返回空 body，前端按 `null` 处理。
- **写**（`library_add_book`）用 base64 字符串。多花 33% 体积，但只在每本书导入时发生一次，
  换来一个普通的命令签名 —— 若用 `Vec<u8>` 参数，JSON 会把它编码成几百万个数字的数组。

## 3. 浏览器侧存储

IndexedDB（库名 `veloread`，版本 1），四个 object store：

| store | key | value |
| --- | --- | --- |
| `books` | `id`（keyPath） | `BookRecord` |
| `files` | 外部 key = 书 id | `ArrayBuffer` |
| `covers` | 外部 key = 书 id | `ArrayBuffer` |
| `progress` | `bookId`（keyPath） | `ReadingProgress` |

字节单独放 store，列书架时不会反序列化书本内容。没有引入 localforage 之类的依赖。

## 4. EPUB 元数据解析

`src/epub/metadata.ts`，**不经过 epub.js**：导入要在渲染之前完成，而且 zip + XML 这条路径
可以在 jsdom 下直接单测。

- `META-INF/container.xml` → rootfile `full-path` → OPF
- 标题 `dc:title`、作者所有 `dc:creator` 以 `", "` 连接、语言 `dc:language`
- 封面：先看 EPUB 3 的 `properties="cover-image"`，再回落到 EPUB 2 的
  `<meta name="cover" content="…">`
- 元素查找先按命名空间，再回落到无命名空间的同名标签（现实中的 EPUB 确实有不声明命名空间的）
- href 相对 OPF 所在目录解析，处理 `.`、`..`、前导 `/` 与 `%20` 转义
- 任何让文件无法作为 EPUB 使用的问题都抛 `EpubParseError`

标题为空时由调用方回落到文件名（去掉 `.epub`）。

## 5. 渲染层

`src/reader/renderer.ts` 是**唯一**接触 epub.js 的模块。epub.js 的 CFI 与分页有已知毛病，
整体替换渲染层是以后的独立决策，把它关在一个模块后面就是为了让那次决策可控。

对外只暴露 `createReader(container, data, startCfi, options) → ReaderHandle`：

- `next()` / `prev()` / `resize(width, height)` / `destroy()`
- `onLocation({cfi, percentage, atStart, atEnd})` —— 每次翻页与首次显示时触发
- `onKeyDown(event)` —— **书页渲染在 iframe 内，window 上的监听拿不到书页里的按键**，
  所以渲染层通过 `rendition.hooks.content` 把监听装进 iframe document，
  阅读器组件同时在 window 和这里绑同一个 handler。

固定配置：`flow: 'paginated'`、`spread: 'none'`、`allowScriptedContent: false`
（书页是不可信 HTML，没有理由让它执行脚本）。

### 百分比为什么是 `number | null`

`book.locations.generate()` 在**首页显示之后**异步执行：长书上它很慢，而它只影响进度百分比。

关键陷阱：epub.js 是**边生成边往 `book.locations` 里塞**的，所以 `locations.length() > 0`
并不代表当前 CFI 已经被索引 —— 对还没索引到的位置，`percentageFromCfi()` 会返回一个看起来
完全正常的 `0`。照单全收地存下去，就会出现「打开一本读到 50% 的书，进度被改写成 0%」。

因此：

- 渲染层用一个 `locationsReady` 标志，只有 `generate()` **完成之后**读到的数值才算数，
  在那之前 `percentage` 一律是 `null`
- `null` 的含义是「还不知道」，**不是**「在开头」。阅读器收到 `null` 时保留上一个已知值
  （打开书时用存储里的旧值播种），绝不把它当 0 写回去
- 生成失败时百分比一直是未知，阅读位置不受影响

## 6. 阅读器行为契约

- 键盘：`→` / `PageDown` 下一页，`←` / `PageUp` 上一页，`Esc` 返回书库
- 进度：每次 `relocated` 记录 CFI，防抖 400 ms 落库；离开阅读器时立即冲刷
- 重排：`ResizeObserver` 监听容器，防抖 150 ms 后按容器像素尺寸重新排版。
  **必须跳过尺寸没真正变化的那次回调** —— `ResizeObserver` 在 `observe()` 时一定会触发一次，
  拿刚刚排过版的同一个尺寸再排一次，会让 CFI 恢复差整整一页
- 重开一本书从存储里的 CFI 恢复；没有记录时 `display(undefined)` 打开第一页
- 书还没打开完就离开阅读器时，**丢弃**这一轮迟到的 `onLocation`：那是首屏位置，
  写下去会把存好的阅读位置推回开头
- 书架顺序依赖 `lastReadAt`，所以是**阅读器在最后一次进度写入落地之后**自己去刷新书库，
  而不是 `closeBook()` 顺手刷 —— 后者会读到旧顺序

## 7. 拖拽导入

`tauri.conf.json` 里 `dragDropEnabled: false`。Tauri 默认会截获拖放并只给出文件路径，
关掉之后 webview 自己处理 HTML5 拖放，两个目标共用同一段 `onDrop` 代码，
也不需要为读取任意路径开 fs 权限。文件选择用原生 `<input type="file">`，同理不需要 dialog 插件。

## 8. 测试

- fixture EPUB 由 `src/test/fixture-epub.ts` **脚本生成**，不下载任何书籍。
  内容放在 `OEBPS/` 下，好让 href 解析真的被覆盖到。
- `bun run fixture` 把一本 4 章 / 每章 25 段的 fixture 写到 `.local/fixtures/fixture.epub`，
  供浏览器目标手动 smoke 用。
- `bun run test` —— jsdom + `fake-indexeddb`，覆盖元数据解析与 web 侧进度读写一致性。
- `cd src-tauri && cargo test` —— Rust 侧的 SQL 与路径逻辑放在 `library.rs` 的 `store`
  子模块里，是一组只依赖 `&Connection` / `&Path` 的普通函数，因此不用起 Tauri app 就能测：
  迁移幂等、进度 upsert、书架顺序与 web 实现一致、删除级联、重复 id 被拒、
  以及 id 校验挡掉所有可能逃出书库目录的输入。
