# 格式支持：EPUB / TXT / PDF

> 状态：🚧 仅 EPUB 已实现。TXT 与 PDF 规划中。
> 相关：[overview](overview.md) 的格式矩阵、[reader-view](reader-view.md)、[platform-and-storage](platform-and-storage.md)

## 1. 为什么需要一层抽象

三种格式的本质差异决定了它们不能用同一套代码直接顶：

| | EPUB | TXT | PDF |
| --- | --- | --- | --- |
| 本质 | XHTML + CSS 的压缩包 | 纯字符流 | 固定版面的绘制指令 |
| 可重排 | 是 | 是 | **否** |
| 自带结构 | spine + TOC | 无 | 页 + 可选书签 |
| 位置标识 | CFI | 字符偏移 | 页码 + 页内偏移 |

上层功能（进度、Pacer、划线、划词）不应该知道这些差异。因此定义两件东西：
**格式无关的位置标识 `Locator`**，和**每种格式一个 `DocumentAdapter`**。

## 2. Locator：格式无关的位置

进度、划线、书签、生词出处**一律用 `Locator` 存储**，不再直接存 CFI。

```ts
type Locator =
  | { format: 'epub'; cfi: string }
  | { format: 'txt';  charOffset: number }
  | { format: 'pdf';  page: number; charOffset?: number }

interface Position {
  locator: Locator
  /** 0–1 全书进度，用于 UI 与排序；不用于精确定位 */
  progress: number | null
}
```

规则：
- `Locator` 的 `format` 必须与书的 `format` 一致，读取时校验，不一致视为损坏并回退到书首。
- **`progress` 永远不能反过来当定位用** —— 它是估算值。定位只认 `locator`。
- `progress` 为 `null` 表示「尚不可知」，不是 0。这条约束的来由见 [reader-view](reader-view.md#8-进度百分比)。

> 迁移说明：当前 schema v1 的 `reading_progress.cfi` 是 EPUB 专用字段。
> 引入多格式时需迁移到 `locator TEXT`（JSON），见 [platform-and-storage](platform-and-storage.md)。

## 3. DocumentAdapter 契约

```ts
interface DocumentAdapter {
  readonly format: BookFormat

  /** 导入时解析元数据，必须在渲染之前可用 */
  parseMetadata(data: Uint8Array): Promise<DocumentMetadata>

  /** 打开并挂载到容器 */
  open(container: HTMLElement, data: Uint8Array, options: RenderOptions): Promise<DocumentView>
}

interface DocumentView {
  navigation(): Promise<TocEntry[]>
  goTo(target: Locator | TocEntry): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  relayout(width: number, height: number): void
  /** 当前可见页的文本 + 几何，供 Pacer 与划词使用 */
  visibleText(): VisibleTextRun[]
  /** 用户选区 → 可持久化的锚点 */
  anchorSelection(): { locator: Locator; text: string } | null
  applyStyle(style: ResolvedStyle): void
  destroy(): void
}
```

`visibleText()` 是 Pacer 与划词的**唯一**数据来源 —— 它们不应各自去摸 DOM。
返回的每个 run 携带文本与其 `Range`，几何由调用方按需计算（见 [pacer](pacer.md)）。

## 4. EPUB

- 渲染：epub.js，全部调用收敛在渲染模块内（见 [reader-view](reader-view.md#7-渲染层边界)）
- 元数据：**不经过 epub.js**，自己解 zip + OPF。导入必须在渲染之前完成，且要能单测。
  - `META-INF/container.xml` → rootfile `full-path` → OPF
  - 标题 `dc:title`、作者所有 `dc:creator` 以 `", "` 连接、语言 `dc:language`
  - 封面：先看 EPUB 3 的 `properties="cover-image"`，再回落到 EPUB 2 的 `<meta name="cover">`
  - 元素查找先按命名空间，再回落到无命名空间同名标签（现实中确有不声明命名空间的 EPUB）
  - href 相对 OPF 目录解析，处理 `.`、`..`、前导 `/`、`%20`
- 目录：`book.navigation.toc`，支持嵌套
- Locator：CFI

## 5. TXT

**设计要点：TXT 归一化成 HTML 之后，走和 EPUB 完全相同的渲染与标注路径。**
这样 Pacer、划线、划词、排版风格全部自动获得，不需要第二套实现。

- **编码探测**：必须做。中文 TXT 大量是 GBK/GB18030，日文有 Shift-JIS。
  策略：先看 BOM → 再试 UTF-8 严格解码 → 失败则按字节分布猜测 → 兜底 GBK。
  **探测结果要能让用户手动改**（猜错时不能没救）。
- **章节切分**：纯文本没有结构，用可配置的正则按行匹配，命中即为章节标题。
  默认规则覆盖：`第X章/节/回`、`Chapter N`、`# 标题`、连续空行 + 短行。
  切分结果生成 TOC；**用户可关闭切分**（当成单章长文）。
- **段落还原**：单换行 vs 双换行的语义在 TXT 里不统一。
  规则：连续空行 = 分段；单换行在中文里通常也是分段，在英文里可能是硬折行 ——
  按主要语种决定，并允许用户切换。
- Locator：`charOffset`，指向**归一化后**的字符流。归一化必须是确定性的，
  否则同一文件两次打开偏移会漂。这条要有测试。

## 6. PDF

**必须先说清楚：PDF 是独立的一条轨，功能天然不对等。**

- 渲染：`pdf.js`（Mozilla，Apache-2.0，与开源目标兼容）
- **排版类功能全部不适用**：PDF 是固定版面，换字体/字号/行距在物理上不成立。
  风格主题最多只能做背景色调（甚至只是滤镜），不能真的重排。
- **文本层是一切的前提**：
  - 数字原生 PDF 有文本层 → 划线、划词、Pacer 可做（基于 `pdf.js` 的 text layer）
  - **扫描版 PDF 没有文本层** → 只能当图片翻页，其余功能全部不可用
  - 产品上必须**明确告知**用户当前 PDF 属于哪一类，而不是让功能静默失效
- Locator：`{ page, charOffset? }`
- 划线锚定：文本层的字符区间 + 页码。跨页选区需要拆成多段。
- 目录：PDF outline（若有）

**建议的实施顺序**：EPUB → TXT → PDF。前两者共用引擎，投入产出比高；
PDF 是一次独立的、体量不小的投入，且大部分特色功能用不上。

## 7. 格式识别

- 优先按内容识别，不只信扩展名：
  - EPUB：zip magic (`PK\x03\x04`) + `mimetype` 为 `application/epub+zip` 或存在 `META-INF/container.xml`
  - PDF：`%PDF-` 开头
  - TXT：以上都不是，且能按某种编码解码成合理文本
- 识别失败给出明确错误，不要静默跳过（现有 EPUB 导入的错误处理已符合此要求）

## 8. 验收要点

- 三种格式各自能导入、显示、翻页、记住并恢复位置
- TXT：UTF-8 / GBK / 带 BOM 各有用例；章节切分对中英文各有用例；
  **同一文件两次打开，`charOffset` 定位到同一处**
- PDF：数字原生与扫描版各一个用例，扫描版必须给出「无文本层」的明确提示
- `Locator` 的 format 与书不匹配时安全回退，不崩溃
