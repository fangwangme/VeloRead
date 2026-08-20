# Specs

产品与技术规格。**从 [overview.md](overview.md) 开始** —— 它是入口，
包含产品定位、模块地图、格式支持矩阵和术语表。

## 结构

一个总览 + 每个模块一份 spec。没有单一的大 PRD：需求按模块就近记录，
和实现一起演进。

| Spec | 内容 | 状态 |
| --- | --- | --- |
| [overview.md](overview.md) | 产品定位、模块地图、格式矩阵、术语、候选功能 | — |
| [library.md](library.md) | 书库：导入、书架、合集、组织 | 🚧 |
| [reading-formats.md](reading-formats.md) | EPUB / TXT / PDF、`Locator` 抽象、元数据解析 | 🚧 |
| [reader-view.md](reader-view.md) | 排版、视觉风格、字体设置、目录、书签、书内搜索、翻页热区 | ✅ |
| [pacer.md](pacer.md) | 自动阅读 / 速读训练 | ✅ |
| [reading-activity.md](reading-activity.md) | 有效阅读计时、字数、连续天数与四档自动打卡 | ✅ |
| [annotations.md](annotations.md) | 划线笔记、摘抄导出、Kindle 格式导入导出 | 🚧 |
| [vocabulary.md](vocabulary.md) | 划词、词典、生词本、导出 | 📋 |
| [platform-and-storage.md](platform-and-storage.md) | 平台适配层、SQLite / IndexedDB 数据模型 | ✅ |
| [i18n.md](i18n.md) | 界面语言：字典结构、复数、语言解析 | ✅ |

状态图例：✅ 已实现 · 🚧 部分实现 · 📋 规划中

## 约定

- **每份 spec 顶部必须标状态**。规划中的内容不能被误读成当前行为。
- 按模块或长期存在的产品面命名，**不加日期前缀**：`module-name.md`
- 功能开发前先更新或新建相关 spec，再做实现规划
- 带日期的决策记录、研究、评审笔记放 `.agents/notes/` 或 `.agents/plans/`，不放这里
- 可执行的单次任务契约写在 GitHub issue 里，不写进 spec
