// 核心层测试：frontmatter 往返、文章 CRUD、图片、markdown
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  parseFrontmatter,
  stringifyFrontmatter,
  buildMarkdown,
  normalizeDate,
  slugify,
  toDate,
} from '../src/core/frontmatter.js'
import {
  listEntries,
  readEntry,
  saveEntry,
  createEntry,
  deleteEntry,
  renameEntry,
  listArticleImages,
  saveImage,
  imageDirOf,
  collectTags,
  listCovers,
  isValidRepo,
} from '../src/core/repo.js'
import { renderMarkdown, extractHeadings } from '../src/core/markdown.js'
import * as git from '../src/core/git.js'

let pass = 0
let fail = 0
const t = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}

/* ============ frontmatter ============ */
console.log('=== frontmatter ===')

t('解析基本字段', () => {
  const { data, body } = parseFrontmatter(`---
title: 你好
date: 2025-08-12
---

正文`)
  assert.equal(data.title, '你好')
  assert.equal(data.date, '2025-08-12')
  assert.equal(body.trim(), '正文')
})

t('解析块状数组', () => {
  const { data } = parseFrontmatter(`---
tags:
  - 前端
  - 代码
---`)
  assert.deepEqual(data.tags, ['前端', '代码'])
})

t('解析行内数组', () => {
  const { data } = parseFrontmatter(`---
tags: [前端, 代码]
---`)
  assert.deepEqual(data.tags, ['前端', '代码'])
})

t('解析布尔值', () => {
  const { data } = parseFrontmatter(`---
pinned: true
draft: false
---`)
  assert.equal(data.pinned, true)
  assert.equal(data.draft, false)
})

t('无 frontmatter 时全文当正文', () => {
  const r = parseFrontmatter('# 标题\n正文')
  assert.equal(r.hasFrontmatter, false)
  assert.ok(r.body.includes('标题'))
})

t('往返不丢字段', () => {
  const src = `---
title: 测试文章
date: 2025-10-08
tags:
  - 前端
  - 随笔
category: 技术
pinned: true
---

正文内容`
  const { data, body } = parseFrontmatter(src)
  const out = buildMarkdown(data, body)
  const again = parseFrontmatter(out)
  assert.equal(again.data.title, '测试文章')
  assert.deepEqual(again.data.tags, ['前端', '随笔'])
  assert.equal(again.data.category, '技术')
  assert.equal(again.data.pinned, true)
  assert.equal(again.body.trim(), '正文内容')
})

t('日期规范化', () => {
  assert.equal(normalizeDate('2025-8-1'), '2025-8-1') // 已是字符串，保持
  assert.equal(normalizeDate('2025/08/01'), '2025-08-01')
  assert.equal(normalizeDate('2025-08-01 10:30'), '2025-08-01 10:30')
  assert.equal(normalizeDate('2025-08-01T10:30:00'), '2025-08-01 10:30')
})

t('slug 生成', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
  assert.equal(slugify('你好 世界'), '你好-世界')
  assert.equal(slugify('a_b c'), 'a-b-c')
})

t('日期排序', () => {
  assert.ok(toDate('2025-10-08') > toDate('2025-08-12'))
})

/* ============ 仓库操作 ============ */
console.log('\n=== 仓库操作 ===')

const tmpRoot = path.join(process.cwd(), '.tmp-test')
fs.mkdirSync(tmpRoot, { recursive: true })
const tmp = fs.mkdtempSync(path.join(tmpRoot, 'studio-'))
const repo = path.join(tmp, 'blog')
fs.mkdirSync(path.join(repo, 'posts'), { recursive: true })
fs.mkdirSync(path.join(repo, 'notes'), { recursive: true })
fs.mkdirSync(path.join(repo, 'covers'), { recursive: true })

fs.writeFileSync(
  path.join(repo, 'posts', 'hello.md'),
  `---
title: 你好
date: 2025-08-12
tags:
  - 随笔
---

第一篇文章`,
)
fs.writeFileSync(
  path.join(repo, 'posts', 'tech.md'),
  `---
title: 技术文章
date: 2025-10-08
tags: [前端, 代码]
category: 技术
pinned: true
---

技术内容`,
)
fs.writeFileSync(
  path.join(repo, 'notes', '2025-10-15.md'),
  `---
date: 2025-10-15
tags:
  - 日常
---

今天天气不错`,
)
fs.writeFileSync(path.join(repo, 'covers', 'a.svg'), '<svg/>')

// 提前初始化 git，后续 git 相关测试都基于此
execFileSync('git', ['init', '-q'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo })

t('列出条目', () => {
  const { posts, notes } = listEntries(repo)
  assert.equal(posts.length, 2)
  assert.equal(notes.length, 1)
  assert.equal(posts[0].title, '技术文章') // 按日期倒序
  assert.equal(posts[0].pinned, true)
})

t('读取单篇', () => {
  const e = readEntry(repo, 'tech')
  assert.equal(e.data.title, '技术文章')
  assert.deepEqual(e.data.tags, ['前端', '代码'])
  assert.equal(e.data.category, '技术')
  assert.ok(e.body.includes('技术内容'))
})

t('保存文章', () => {
  saveEntry(repo, {
    id: 'tech',
    kind: 'post',
    data: {
      title: '技术文章（改）',
      date: '2025-10-08',
      tags: ['前端', '新标签'],
      category: '技术',
      pinned: true,
    },
    body: '修改后的内容',
  })
  const e = readEntry(repo, 'tech')
  assert.equal(e.data.title, '技术文章（改）')
  assert.deepEqual(e.data.tags, ['前端', '新标签'])
  assert.ok(e.body.includes('修改后的内容'))
})

t('新建文章', () => {
  const id = createEntry(repo, { title: 'My New Post' })
  assert.equal(id, 'my-new-post')
  assert.ok(fs.existsSync(path.join(repo, 'posts', 'my-new-post.md')))
})

t('新建文章重名加后缀', () => {
  const id = createEntry(repo, { title: 'My New Post' })
  assert.equal(id, 'my-new-post-2')
})

t('新建手记用日期', () => {
  const id = createEntry(repo, { kind: 'note', date: '2025-11-01' })
  assert.equal(id, '2025-11-01')
  const id2 = createEntry(repo, { kind: 'note', date: '2025-11-01' })
  assert.equal(id2, '2025-11-01-2')
})

t('删除文章', () => {
  assert.ok(deleteEntry(repo, 'my-new-post'))
  assert.ok(!fs.existsSync(path.join(repo, 'posts', 'my-new-post.md')))
})

t('重命名文章', () => {
  renameEntry(repo, 'my-new-post-2', 'renamed')
  assert.ok(fs.existsSync(path.join(repo, 'posts', 'renamed.md')))
})

t('图片保存到文章独立目录', () => {
  const r = saveImage(repo, 'tech', 'post', '测试图.png', Buffer.from('fake'))
  assert.equal(r.webPath, 'posts/tech/images/测试图.png')
  const dir = imageDirOf(repo, 'tech', 'post')
  assert.ok(fs.existsSync(path.join(dir, '测试图.png')))
})

t('同名图片自动加后缀', () => {
  saveImage(repo, 'tech', 'post', '测试图.png', Buffer.from('fake2'))
  const list = listArticleImages(repo, 'tech', 'post')
  assert.equal(list.length, 2)
  assert.ok(list.some((i) => i.name === '测试图-2.png'))
})

t('列出封面', () => {
  const covers = listCovers(repo)
  assert.equal(covers.length, 1)
  assert.equal(covers[0].webPath, 'covers/a.svg')
})

t('汇总标签', () => {
  const tags = collectTags(repo)
  const names = tags.map((x) => x.name)
  assert.ok(names.includes('前端'))
  assert.ok(names.includes('日常'))
})

t('仓库校验', () => {
  // 有 .git 且有 posts/ → 有效
  assert.equal(isValidRepo(repo), true)
  // 没有 .git 的目录 → 无效
  const noGit = path.join(tmp, 'norepo')
  fs.mkdirSync(path.join(noGit, 'posts'), { recursive: true })
  assert.equal(isValidRepo(noGit), false)
  // 不存在的路径 → 无效
  assert.equal(isValidRepo(path.join(tmp, 'nope')), false)
})

/* ============ markdown ============ */
console.log('\n=== markdown 渲染 ===')

t('标题', () => {
  const h = renderMarkdown('# 一级\n## 二级')
  assert.ok(h.includes('<h1'))
  assert.ok(h.includes('<h2'))
})

t('段落与粗体', () => {
  const h = renderMarkdown('这是 **粗体** 文字')
  assert.ok(h.includes('<strong>粗体</strong>'))
})

t('行内代码', () => {
  const h = renderMarkdown('用 `npm run dev` 启动')
  assert.ok(h.includes('<code class="md-code-inline">npm run dev</code>'))
})

t('代码块带着色', () => {
  const h = renderMarkdown('```js\nconst a = 1\n```')
  assert.ok(h.includes('md-code'))
  assert.ok(h.includes('tok-kw'))
})

t('列表', () => {
  const h = renderMarkdown('- a\n- b')
  assert.ok(h.includes('<ul>'))
  assert.ok(h.includes('<li>a</li>'))
})

t('有序列表', () => {
  const h = renderMarkdown('1. a\n2. b')
  assert.ok(h.includes('<ol>'))
})

t('任务列表', () => {
  const h = renderMarkdown('- [x] 完成\n- [ ] 未完成')
  assert.ok(h.includes('type="checkbox"'))
  assert.ok(h.includes('checked'))
})

t('链接与图片', () => {
  const h = renderMarkdown('[链接](https://a.com) ![图](posts/x/images/a.png)')
  assert.ok(h.includes('href="https://a.com"'))
  assert.ok(h.includes('src="posts/x/images/a.png"'))
})

t('表格', () => {
  const h = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
  assert.ok(h.includes('<table>'))
  assert.ok(h.includes('<th'))
})

t('引用', () => {
  const h = renderMarkdown('> 引用内容')
  assert.ok(h.includes('<blockquote>'))
})

t('HTML 转义', () => {
  const h = renderMarkdown('<script>alert(1)</script>')
  assert.ok(!h.includes('<script>'))
  assert.ok(h.includes('&lt;script&gt;'))
})

t('提取大纲', () => {
  const hs = extractHeadings('# A\n## B\n```\n# 不应出现\n```')
  assert.equal(hs.length, 2)
  assert.equal(hs[1].text, 'B')
})

/* ============ git ============ */
console.log('\n=== git 操作 ===')

t('git 可用', () => {
  const v = git.gitVersion()
  assert.ok(v && v.includes('git'))
})

t('状态读取', () => {
  const st = git.status(repo)
  assert.ok(Array.isArray(st.files))
  assert.ok(st.branch === 'master' || st.branch === 'main')
})

t('提交', () => {
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo })
  const r = git.commit(repo, '测试提交')
  assert.equal(r.ok, true)
  const st = git.status(repo)
  assert.equal(st.dirty, false)
})

t('提交记录', () => {
  const logs = git.log(repo, 5)
  assert.ok(logs.length >= 1)
  assert.equal(logs[0].subject, '测试提交')
})

t('新文件 diff', () => {
  fs.writeFileSync(path.join(repo, 'posts', 'new.md'), '---\ntitle: 新的\n---\n\n内容')
  const st = git.status(repo)
  assert.ok(st.dirty)
  const d = git.fileDiff(repo, 'posts/new.md')
  assert.ok(d.includes('+') || d.includes('新的'))
})

/* ============ 结果 ============ */
console.log(`\n${'='.repeat(40)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exitCode = fail > 0 ? 1 : 0
