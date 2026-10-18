---
title: 用 Obsidian 写这个博客
description: 这套站点结构天生兼容 Obsidian——直接把 content 文件夹当作 Vault 打开就行。
date: 2025-09-20
tags:
  - 工具
  - Obsidian
  - 教程
category: 教程
---

如果你也用 Obsidian 写作，那么这个仓库可以直接当作 Vault 打开。

## 怎么做

1. 克隆仓库到本地
2. 打开 Obsidian → **打开文件夹作为仓库**
3. 选择 `src/content` 目录

这样 `posts` 和 `notes` 就变成了你的两个文件夹，新建笔记直接写就行。

## Frontmatter 格式

每篇文章开头需要一段 YAML：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | 字符串 | 是 | 文章标题 |
| `date` | 日期 | 是 | 发布时间 |
| `description` | 字符串 | 否 | 摘要，用于列表和 SEO |
| `tags` | 数组 | 否 | 标签 |
| `category` | 字符串 | 否 | 分类 |
| `cover` | 字符串 | 否 | 封面图 |
| `draft` | 布尔 | 否 | 设为 `true` 则不上线 |
| `pinned` | 布尔 | 否 | 置顶 |

一个完整的例子：

```yaml
---
title: 我的第一篇文章
date: 2025-09-20
description: 试试看
tags:
  - 随笔
category: 生活
draft: false
---
```

## Obsidian 的小脾气

有几个地方需要注意：

- **`draft: true` 的文章不会出现在站点上**，但你本地能看到——很适合存草稿
- 图片建议放在 `public/assets/` 下，正文里用 `/assets/xxx.png` 引用
- Obsidian 的 `[[双链]]` 语法不会被渲染成链接，需要写成标准 Markdown 的 `[文字](路径)`

## 发布流程

写完只需三步：

```bash
git add .
git commit -m "新文章：xxx"
git push
```

推送之后，GitHub Actions 会自动构建，一两分钟后站点就更新了。

---

写东西这件事，最重要的永远是「写」本身。工具只要能让你少分心，就是好工具。
