# 划线摘抄

> 状态：🚧 划线、笔记、书内列表已实现；Kindle 格式导入导出规划中。
> 参照物：Kindle 的 `My Clippings.txt`。
> 相关：[reading-formats](reading-formats.md)、[vocabulary](vocabulary.md)、[platform-and-storage](platform-and-storage.md)

## 1. 范围

**做**：划线、笔记、书内摘抄列表、**导出为一个纯文本文件**、**从 Kindle 导入**。

**不做**：指定导出目录后自动增量同步、Markdown 等附加格式、
划线的间隔重复复习（与「导出优先」的定位冲突 —— 我们把数据交出去，不自己做复习系统）。

## 2. 功能

- 选中文本 → 划线，支持多种颜色 + 可加笔记
- 划线锚定到 `Locator`，重开书能准确回到原位
- 书内划线列表：可查询、跳转、编辑、删除
- **手动导出**为一个 `.txt`，格式与 Kindle `My Clippings.txt` 对齐
- **导入** Kindle 的 `My Clippings.txt`

## 3. 为什么对齐 Kindle 格式

用户是从 Kindle 迁移过来的，且既有的 Kindle 摘抄处理链路（Readwise、Obsidian 脚本、
各类解析器）都消费这个格式。对齐它意味着：

1. 用户的历史数据能**带过来**
2. 我们的数据能被**已有工具直接消费**，不需要为 VeloRead 单独写解析器

这是「导出优先，绝不锁定」原则最直接的体现。

## 4. `My Clippings.txt` 格式

一条记录五行，`==========` 分隔：

```
<书名> (<作者>)
- Your Highlight on page <页> | location <起>-<止> | Added on <星期>, <日期> <时间>
<空行>
<正文>
==========
```

真实样例：

```
The Selfish Gene: 30th Anniversary Edition (Richard Dawkins)
- Your Highlight on page 92 | location 1406-1407 | Added on Saturday, 26 March 2016 14:59:39

Perhaps consciousness arises when the brain's simulation of the world becomes so complete that it must include a model of itself.
==========
```

### 实现必须注意的坑

1. **元数据行是本地化的**。`Your Highlight on` / `Added on` / 星期与月份名
   随 Kindle 固件语言变化（中文固件是「您在第 X 页的标注」）。
   **解析器必须容忍多语言**，不能只匹配英文。
2. **三种类型混在同一个文件**：`Highlight`（划线）、`Note`（笔记）、`Bookmark`（书签）。
   书签**通常没有正文**，只有元数据行 —— 解析时不能因为正文为空就丢弃。
3. **页码与 location 不一定同时存在**。有些书只有 location，没有 page。
4. **日期格式随语言变化**，解析失败时应保留原始字符串而不是丢掉整条。
5. **重复条目很常见** —— 用户修改划线时 Kindle 会追加新条目而非替换。
   导入时需要去重策略（书名 + 位置 + 正文 三者相同视为同一条）。

### 我们导出时

- 采用**英文格式**输出（兼容性最好，绝大多数解析器按英文写的）
- 位置：EPUB 没有 Kindle 的 location 概念，用我们的 `Locator` 折算成一个稳定的整数序号，
  并在 `page` 位置写我们的页码。**必须在文档里说明这个数字不与 Kindle 的 location 等价。**
- 时间用本地时区

## 5. 数据模型

```sql
CREATE TABLE annotations (
    id            TEXT PRIMARY KEY,
    book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    cfi_range     TEXT NOT NULL,    -- 覆盖整个选区的 EPUB CFI range
    text          TEXT NOT NULL,    -- 划线时的原文
    note          TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL,    -- yellow | green | blue | pink | purple
    chapter_title TEXT,             -- 建立时捕获，列表离线可读
    source        TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'kindle-import'
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_annotations_book ON annotations(book_id, created_at);
```

### 与早期设计的两处差异

1. **书签不在这张表里。** 书签保留独立的 `bookmarks` 表：书签是一个*位置*，划线是一段
   被刻意留下的*文本*，两者的字段、列表形态和交互都不同。导出 Kindle 格式时再把两张表
   合并成一个文件（`My Clippings.txt` 本来就把三种类型混在一起）。
2. **没有 `kind` 列，笔记是划线的一个字段。** 本应用里笔记永远依附于一段划线，一行同时
   持有原文和笔记比拆成两行更贴近实际操作。导出时若 `note` 非空，再拆成 Highlight 与
   Note 两条记录写出去。

**一个 CFI range 只能对应一条划线。** 重新选中一段已划线的文字，是*编辑那一条*，
不是新建第二条：epub.js 按 cfiRange 存 mark，重复的行在页面上看不出来，却会在抽屉里
出现两条一模一样的记录，而删掉任意一条都会把另一条的着色一并抹掉。

`locator` 抽象（格式无关的位置标识）尚未落地，当前直接存 EPUB CFI range；TXT / PDF 接入时
与 `bookmarks`、`reading_progress` 一起迁移，见 [reading-formats](reading-formats.md)。

`source` 用于区分导入数据与本地数据 —— 导入的 Kindle 条目往往无法精确锚定，UI 必须区别
对待，不要给一个点了没反应的跳转按钮。

导入的 Kindle 条目往往无法精确锚定到 CFI（Kindle location 与 CFI 之间没有可靠映射），
这类条目应保留原文与元数据、**可查看、可导出**，但**不保证能跳转定位**。
这是诚实处理导入数据的关键 —— 假装能定位比不能定位更糟。

划线浮层的颜色与笔记是组件本地状态，**必须按段落重新挂载**（以 annotation id 或 cfiRange 作 key）。
浮层在选色后保持打开是为了接着写笔记；此时另选一段文字，若沿用同一个实例，
新段落会带着上一段的笔记，下一次点色就把它存了进去。

## 6. 导出

- 一次导出全部，或按书导出
- 输出单个 `.txt`
- 文件写入走 `fs` 平台能力（见 [platform-and-storage](platform-and-storage.md)），
  浏览器目标退化为下载

## 7. 验收要点

- 导出的文件能被至少一个既有 Kindle 解析器正确读取（拿开源解析器实测）
- 导入自己导出的文件，得到等价数据（round-trip）
- 导入真实 Kindle `My Clippings.txt`：英文与中文固件各一份样例
- 书签（无正文）不被丢弃
- 重复条目按规则去重
- 导入条目在 UI 上明确标注「来自 Kindle，无法跳转」
