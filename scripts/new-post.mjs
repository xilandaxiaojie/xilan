#!/usr/bin/env node
/**
 * 新建一篇文章。
 *
 *   npm run new -- 我的文章标题
 *   npm run new -- 我的文章标题 --note      # 新建一条手记
 *
 * 会在 posts/ 或 notes/ 下生成一个带 frontmatter 的 .md 文件，
 * 文件名使用标题的 slug，方便直接对应 URL。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const isNote = args.includes('--note')
const titleParts = args.filter((a) => !a.startsWith('--'))
const title = titleParts.join(' ').trim()

if (!title) {
  console.error('用法: npm run new -- <标题> [--note]')
  process.exit(1)
}

/** 生成适合做文件名的 slug：保留中英文与数字，其余转 - */
function slugify(s) {
  const slug = s
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Script=Han}a-z0-9-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || `post-${Date.now()}`
}

const today = new Date()
const pad = (n) => String(n).padStart(2, '0')
const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

if (isNote) {
  const dir = path.join(ROOT, 'notes')
  fs.mkdirSync(dir, { recursive: true })
  // 手记用日期命名，一天一条时直接对应
  let file = path.join(dir, `${dateStr}.md`)
  let i = 2
  while (fs.existsSync(file)) {
    file = path.join(dir, `${dateStr}-${i}.md`)
    i++
  }
  const content = `---
date: ${dateStr}
tags: []
---

${title}
`
  fs.writeFileSync(file, content, 'utf8')
  console.log(`已创建手记: ${path.relative(ROOT, file)}`)
  console.log('提示：手记正文就是文件内容，frontmatter 里只需要 date 和 tags。')
} else {
  const dir = path.join(ROOT, 'posts')
  fs.mkdirSync(dir, { recursive: true })
  const slug = slugify(title)
  let file = path.join(dir, `${slug}.md`)
  let i = 2
  while (fs.existsSync(file)) {
    file = path.join(dir, `${slug}-${i}.md`)
    i++
  }
  const content = `---
title: ${title}
date: ${dateStr}
description: ${title}
tags: []
# category: 随笔
# cover: 挑选 covers/ 下的一张图，例如 sakura-hill.svg
# cover: sakura-hill.svg
# draft: true
# pinned: false
---

在这里开始写正文。

## 小标题

图片放在仓库根目录的 images/ 下，然后用相对路径引用即可：

![图片说明](/images/example.png)
`
  fs.writeFileSync(file, content, 'utf8')
  console.log(`已创建文章: ${path.relative(ROOT, file)}`)
  console.log('提示：封面未指定时会自动从 covers/ 里挑一张。')
}
