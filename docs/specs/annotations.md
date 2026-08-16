# 划线摘抄

> 状态：📋 规划中。
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
    id          TEXT PRIMARY KEY,
    book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,      -- 'highlight' | 'note' | 'bookmark'
    locator     TEXT NOT NULL,      -- JSON Locator
    locator_end TEXT,               -- JSON Locator，选区终点；书签为 NULL
    text        TEXT,               -- 划线的原文；书签为 NULL
    note        TEXT,               -- 用户笔记
    color       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    source      TEXT NOT NULL       -- 'local' | 'kindle-import'
);
CREATE INDEX annotations_book ON annotations(book_id, created_at DESC);
```

`source` 用于区分导入数据与本地数据 —— 导入的 Kindle 条目往往无法精确锚定到我们的
`Locator`（Kindle location 与 CFI 之间没有可靠映射），这类条目应：
- 保留原文与元数据，**可查看、可导出**
- 但**不保证能跳转定位**，UI 上要区别对待，不要给一个点了没反应的跳转按钮

这是诚实处理导入数据的关键 —— 假装能定位比不能定位更糟。

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
