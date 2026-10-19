# xilan

一个二次元风格的静态博客。用 [Astro](https://astro.build) 构建，托管在 GitHub Pages 上。

没有数据库，没有后端，不需要服务器。写完 Markdown 文件 push 上去，GitHub Actions 会自动构建并发布。

线上地址：<https://xilandaxiaojie.github.io/xilan/>

---

## 目录结构

```
.
├── posts/                    # 📝 博客文章（一个 .md 一篇）
├── notes/                    # ✏️ 手记（短句、随手记）
├── images/                   # 🖼 文章里用到的图片
├── covers/                   # 🎨 封面图，文章没指定时自动从这里挑
│
├── src/
│   ├── config.ts             # ⚙️ 站点标题、作者、简介、社交链接、菜单
│   ├── lib/
│   │   ├── content.ts        # 读取并解析 posts/ 与 notes/
│   │   └── markdown.ts       # Markdown 渲染
│   ├── pages/                # 各页面
│   ├── components/           # 组件
│   ├── layouts/              # 页面骨架
│   └── styles/               # 样式与设计令牌
│
├── scripts/
│   ├── sync-assets.mjs       # 把 covers/ images/ 同步到 public/
│   ├── build-search-index.mjs# 生成搜索索引
│   └── new-post.mjs          # 新建文章 / 手记
│
└── .github/workflows/deploy.yml   # 自动部署到 GitHub Pages
```

**所有内容都在仓库根目录的那四个文件夹里，写博客不需要改任何代码。**

---

## 快速开始

```bash
npm install

npm run dev      # 本地预览  http://localhost:4321/xilan
npm run build    # 构建到 dist/
npm run preview  # 预览构建结果
```

部署时只管 `git push`，GitHub Actions 会处理剩下的。

---

## 写一篇文章

在 `posts/` 下新建一个 `.md` 文件。文件名会直接变成 URL：

```
posts/my-first-post.md  →  /posts/my-first-post/
```

内容格式：

````markdown
---
title: 你好，世界
date: 2025-08-12
description: 这个小站终于开张了。
tags:
  - 随笔
  - 建站
category: 随笔
pinned: true
---

正文从这里开始。

## 二级标题会进目录

普通段落。

![图片说明](/images/example.png)
````

也可以用命令生成一个带好 frontmatter 的模板：

```bash
npm run new -- 我的文章标题
```

### 文章字段

| 字段 | 必填 | 说明 |
|---|:---:|---|
| `title` | ✅ | 文章标题。缺失时回退用文件名，并打印警告 |
| `date` | ✅ | 日期，支持 `2025-10-08` 或 `2025-10-08 10:30`。缺失时为 1970 |
| `description` | | 摘要，显示在卡片和详情页，也用于 SEO |
| `updated` | | 更新日期，详情页会显示「更新于 …」 |
| `tags` | | 标签，多个。见下方[标签](#标签) |
| `category` | | 分类，**只能一个**。显示为卡片上的小圆角标签 |
| `cover` | | 封面图，见下方[封面](#封面) |
| `draft` | | 写 `true` 则完全不出现（列表、归档、标签、搜索、RSS 全都没有） |
| `pinned` | | 写 `true` 则置顶，见下方[置顶](#置顶) |

---

## 写一条手记

在 `notes/` 下新建 `.md`。手记比文章简单得多——**不需要标题**，正文本身就是内容：

```markdown
---
date: 2025-10-15
tags:
  - 日常
---

今天路过一家便利店，买了瓶热可可。

结账的时候店员说「小心烫」，明明是再普通不过的一句话，却莫名觉得今天还不错。
```

或者：

```bash
npm run new -- 今天路过一家便利店 --note
```

### 手记字段

| 字段 | 必填 | 说明 |
|---|:---:|---|
| `date` | ✅ | 日期 |
| `tags` | | 标签，和文章用法完全一样 |
| `draft` | | 写 `true` 则不显示 |

### 文件名建议用日期

手记**没有独立页面**，全部平铺在「记」页上。文件名会成为页面内的锚点：

```
notes/2025-10-15.md  →  /notes/#2025-10-15
```

所以建议用 `YYYY-MM-DD.md` 命名。同一天写多条就加后缀：`2025-10-15-2.md`。

### 手记 vs 文章

| | 手记 | 文章 |
|---|---|---|
| 位置 | `notes/` | `posts/` |
| 需要 `title` | 不需要（列表显示正文前 40 字） | 必填 |
| 独立页面 | 没有 | 有 |
| 支持封面 | 不支持 | 支持 |
| 支持目录 / 上下一篇 | 不支持 | 支持 |

---

## 标签

文章和手记都用 `tags` 字段，**写法完全一样**。两种格式都可以：

**列表式**（推荐，在 Obsidian 里更好读）：

```yaml
tags:
  - 前端
  - 代码
```

**行内式**：

```yaml
tags: [前端, 代码]
```

写单个值也行：`tags: 随笔`（会当成一个标签）。

不需要预先注册标签。写一个新标签，下次构建时「签」页会自动为它新建分区，标签云的字号也会跟着调整——出现得越多，字号越大。

标签会在这些地方用到：

- **「签」页** — 标签云 + 按标签分组的内容列表（博文标「文」，手记标「记」）
- **文章卡片与详情页** — 显示为 `#前端`
- **搜索** — 命中标签的权重仅次于标题

---

## 分类

用 `category` 字段，**可写可不写**，只能填一个：

```yaml
category: 技术
```

和标签的区别：

| 字段 | 用途 | 数量 |
|---|---|---|
| `category` | 给文章一个唯一的归类 | 只能一个 |
| `tags` | 多个关键词，方便检索 | 可以很多 |

分类不需要预先定义，任意文字都行。例如「随笔」「技术」「教程」「设计」——想加「摄影」直接写就行。留空则不显示那个小标签。

---

## 封面

规则只有一条：**写了路径就用那张图；没写、或者写的文件找不到，就从 `covers/` 里随机取一张。**

### 指定封面

直接写图片路径就行，放在哪个目录都可以：

```yaml
# 仓库里任意位置的图片
cover: images/photo.jpg
cover: assets/banner.webp
cover: posts/2025/spring.png

# 写站点绝对路径也可以
cover: /images/photo.jpg

# 用网上的图
cover: https://example.com/cover.jpg
```

写了路径就会去检查文件是否存在。**如果找不到，构建时会打一条警告，然后自动换成 `covers/` 里的随机封面**，不会让构建失败：

```
[content] cover 找不到: images/不存在.jpg（解析为 /images/不存在.jpg），改用 covers/ 随机封面
```

### 不写会怎样

不写 `cover` 时，会从 `covers/` 里**自动分配**一张，保证前几篇拿到的图互不重复。分配结果是稳定的，不会每次构建都变。

如果 `covers/` 是空的，卡片会显示一个渐变占位块，里面是标题的第一个字。

### 纯文件名

只写文件名（不带 `/`）会被当成 `covers/` 里的图：

```yaml
cover: sakura-hill.svg      # → /covers/sakura-hill.svg
```

### 换成自己的图

把图片放进 `covers/` 即可，支持 `.svg` `.png` `.jpg` `.jpeg` `.webp` `.avif` `.gif`。

建议用 **16:9** 比例——卡片和详情页都是按这个比例裁切的。

### 注意

- **文件名要带扩展名**。写 `cover: sakura-hill` 会找不到（然后退回随机封面），要写 `sakura-hill.svg`
- 放到 `covers/` `images/` 以外目录的图，会被自动同步到 `public/`，无需手动处理
- 草稿（`draft: true`）的文章不显示，但仍然会占掉自动分配里的一个位置

---

## 置顶

```yaml
pinned: true
```

排序规则是**置顶优先，其次按日期倒序**：

- 可以有多篇置顶，它们之间再按日期排
- 只影响「文」页和**首页**的排序
- 「览」（归档）和「签」（标签）始终严格按时间倒序，置顶在那里不生效
- 置顶的文章卡片上会多一个黄色「置顶」小标
- 不写或写 `false` 就是普通文章

---

## 图片

图片放在仓库根目录的 `images/` 下，然后在 Markdown 里用绝对路径引用：

```markdown
![图片说明](/images/example.png)
```

以下写法都会自动归一化到 `/images/`，所以从 Obsidian 里拖拽插入的图也能直接用：

```markdown
![](images/example.png)    →  /images/example.png
![](./example.png)         →  /images/example.png
![](example.png)           →  /images/example.png
```

外链图片（`https://...`）保持原样。

---

## 用 Obsidian 写作

把**仓库根目录**当作 vault 打开就行：

1. Obsidian → 打开仓库 → 选择这个项目文件夹
2. `posts/` 和 `notes/` 会直接出现在文件列表里
3. 在 `images/` 里放图，拖进笔记就能引用

frontmatter 是标准 YAML，Obsidian 的「属性」面板能直接编辑。

---

## 搜索

页头右上角有个放大镜图标。点开会在原地展开输入框，输入关键词后按回车或点「搜索」，才跳转到搜索页：

```
/search?q=关键词
```

也可以按 `/` 直接展开搜索框，`Esc` 收起。

搜索覆盖**标题、标签、摘要、正文**，按相关度排序，命中词会高亮。索引在构建时生成，纯前端检索，不需要任何服务。

---

## 主题配置

站点标题、作者名、简介、头像、社交链接、页脚这些写在 `src/config.ts` 里。**日常写博客用不到**，只有想改站名或换头像时才需要动。

---

## 用到的命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发，热更新 |
| `npm run build` | 完整构建（同步图片 → 生成搜索索引 → 构建） |
| `npm run preview` | 预览构建结果 |
| `npm run new -- <标题>` | 新建文章 |
| `npm run new -- <内容> --note` | 新建手记 |
| `npm run assets` | 只同步 `covers/` `images/` 到 `public/` |
| `npm run search` | 只重建搜索索引 |

---

## 桌面管理工具

不想碰命令行的话，`studio/` 里有一个桌面程序，登录 GitHub 后就能写文章、传图片、提交发布。

- 双击 `studio/release/Xilan Studio-win32-x64/Xilan Studio.exe` 运行
- 打不开就用同目录下的 `启动.bat`
- 或者在 `studio/` 下执行 `npm install && npm run dev`

详情见 [studio/README.md](studio/README.md)，出问题看 [studio/启动排查.md](studio/启动排查.md)。

---

## 部署

仓库已配置好 GitHub Actions。推送到 `main` 分支即可自动部署：

```bash
git add .
git commit -m "新文章"
git push
```

首次部署需要在 GitHub 仓库设置里：

1. **Settings → Pages** → Source 选择 **GitHub Actions**
2. 等待 Actions 完成，站点就会出现在 `https://<用户名>.github.io/xilan/`

如果改了仓库名，记得同步修改 `astro.config.mjs` 里的 `BASE`。

---

## 常见问题

**构建报错说找不到图片？**
检查 `covers/` 或 `images/` 里是否真有那个文件，以及扩展名是否写对。

**文章没出现？**
先看 `draft` 是不是 `true`，再看 `date` 有没有写、格式对不对。

**标签名写错了想改？**
直接改 md 里的 `tags`。标签是构建时从文章汇总出来的，没有独立的配置需要同步。

**想加一个菜单项？**
编辑 `src/config.ts` 的 `menu` 数组，同时要在 `src/pages/` 里建好对应页面。这个需要改代码。
