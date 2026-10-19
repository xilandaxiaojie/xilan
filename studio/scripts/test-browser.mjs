/**
 * 用真实浏览器验证界面渲染与交互
 *
 * 注意：测试会在临时副本仓库里操作，绝不碰真实博客文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

// puppeteer-core 装在博客根目录（studio 本身不依赖它）
const require = createRequire(path.join(process.cwd(), '..', 'package.json'))
const puppeteer = require('puppeteer-core')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:4322'
const PROFILE = path.join(process.cwd(), '.tmp', 'studio-profile')

/* ---------- 准备一份一次性的测试仓库 ---------- */
const FIXTURE = path.join(process.cwd(), '.tmp-fixture')
fs.rmSync(FIXTURE, { recursive: true, force: true })
for (const d of ['posts', 'notes', 'covers']) {
  fs.mkdirSync(path.join(FIXTURE, d), { recursive: true })
}

fs.writeFileSync(
  path.join(FIXTURE, 'posts', 'first-post.md'),
  `---
title: 测试文章一
description: 用于界面测试
date: 2025-10-01
tags:
  - 测试
  - 随笔
category: 日常
pinned: true
---

# 一级标题

这是一段**正文**，带 \`行内代码\`。

## 二级标题

\`\`\`js
const a = 1
\`\`\`

- 列表项
`,
  'utf8',
)

fs.writeFileSync(
  path.join(FIXTURE, 'posts', 'second-post.md'),
  `---
title: 测试文章二
date: 2025-10-02
tags:
  - 测试
---

第二篇的内容。
`,
  'utf8',
)

fs.writeFileSync(
  path.join(FIXTURE, 'notes', '2025-10-05.md'),
  `---
date: 2025-10-05
tags:
  - 日常
---

今天做了一条手记。
`,
  'utf8',
)

fs.writeFileSync(
  path.join(FIXTURE, 'covers', 'test-cover.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#39c5bb"/></svg>',
  'utf8',
)

const g = (...args) =>
  execFileSync('git', args, { cwd: FIXTURE, encoding: 'utf8', stdio: 'pipe' })
g('init', '-q')
g('config', 'user.email', 'test@example.com')
g('config', 'user.name', 'Test')

/* ---------- 让预览服务器指向这份副本 ---------- */
await fetch(BASE + '/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: 'repo.use', args: [FIXTURE] }),
})

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`)
  }
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,940'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 940 })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

console.log('=== 加载界面 ===')
await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 800))

ok(await page.evaluate(() => !!window.api), 'window.api 桥接已注入')
ok(await page.evaluate(() => !!document.querySelector('#screen-welcome')), '欢迎页存在')

// 登录步骤应显示（浏览器模式无 token）
const loginVisible = await page.evaluate(
  () => !document.querySelector('#welcome-login').hidden,
)
console.log(`  登录步骤可见: ${loginVisible}`)

// 直接跳过登录：手动调用 enterApp
console.log('\n=== 进入主界面 ===')
await page.evaluate(async () => {
  // 模拟已登录直接进入
  document.querySelector('#screen-welcome').hidden = true
  document.querySelector('#screen-app').hidden = false
})
await new Promise((r) => setTimeout(r, 300))

// 通过 UI 层的方式初始化（accessing internal via reload with repo already set）
await page.reload({ waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1200))

const appState = await page.evaluate(() => ({
  welcomeHidden: document.querySelector('#screen-welcome').hidden,
  appHidden: document.querySelector('#screen-app').hidden,
  entries: document.querySelectorAll('.entry').length,
  repoPath: document.querySelector('#btn-repo-path')?.textContent,
  badge: document.querySelector('#git-badge')?.textContent,
}))
console.log('  状态:', JSON.stringify(appState))

ok(appState.appHidden === false || appState.entries > 0, '已自动进入主界面（记住的仓库）')
ok(appState.entries === 2, `文章列表渲染 ${appState.entries} 条（期望 2）`)
ok(
  String(appState.repoPath || '').includes('.tmp-fixture'),
  '指向测试副本仓库',
  appState.repoPath,
)

console.log('\n=== 界面元素 ===')
if (!appState.appHidden) {
  ok(!!appState.badge, 'git 徽章', appState.badge)

  // 检查菜单
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim()),
  )
  ok(tabs.join('/') === '文章/手记', '标签页', tabs.join('/'))

  // 点击第一篇文章
  await page.click('.entry')
  await new Promise((r) => setTimeout(r, 900))

  const editorState = await page.evaluate(() => ({
    editorVisible: !document.querySelector('#editor-main').hidden,
    title: document.querySelector('#field-title')?.value,
    bodyLen: document.querySelector('#md-input')?.value?.length,
    previewHtml: document.querySelector('#preview')?.innerHTML?.length,
    tags: [...document.querySelectorAll('.tag-chip')].map((c) => c.textContent.replace('×', '').trim()),
    date: document.querySelector('#field-date')?.value,
    hasCover: document.querySelector('#cover-preview')?.style.backgroundImage !== '',
  }))
  console.log('  编辑器:', JSON.stringify(editorState, null, 2).replace(/\n/g, ' '))

  ok(editorState.editorVisible, '编辑器已打开')
  ok(editorState.title && editorState.title.length > 0, '标题已填充', editorState.title)
  ok(editorState.bodyLen > 0, '正文已填充', `${editorState.bodyLen} 字符`)
  ok(editorState.previewHtml > 100, '预览已渲染', `${editorState.previewHtml} 字节`)
  ok(editorState.tags.length > 0, '标签已渲染', editorState.tags.join(','))
  ok(!!editorState.date, '日期已填充', editorState.date)

  console.log('\n=== 编辑交互 ===')
  // 修改标题，检查脏标记
  await page.click('#field-title', { clickCount: 3 })
  await page.type('#field-title', '测试标题')
  await new Promise((r) => setTimeout(r, 300))

  const dirty = await page.evaluate(() => ({
    state: document.querySelector('#save-state')?.textContent,
    cls: document.querySelector('#save-state')?.className,
  }))
  ok(dirty.cls.includes('dirty'), '修改后显示未保存', dirty.state)

  // 等自动保存
  await new Promise((r) => setTimeout(r, 1800))
  const saved = await page.evaluate(() => document.querySelector('#save-state')?.textContent)
  console.log(`  自动保存后状态: ${saved}`)

  console.log('\n=== 视图切换 ===')
  await page.click('.view-btn[data-view="preview"]')
  await new Promise((r) => setTimeout(r, 300))
  const previewOnly = await page.evaluate(() => {
    const body = document.querySelector('#editor-body')
    return {
      view: body.dataset.view,
      writeHidden: getComputedStyle(document.querySelector('.editor__pane--write')).display === 'none',
    }
  })
  ok(previewOnly.writeHidden, '切到预览后编辑区隐藏')

  await page.click('.view-btn[data-view="split"]')
  await new Promise((r) => setTimeout(r, 300))

  console.log('\n=== 手记切换 ===')
  await page.click('.tab[data-kind="note"]')
  await new Promise((r) => setTimeout(r, 600))
  const noteCount = await page.evaluate(() => document.querySelectorAll('.entry').length)
  ok(noteCount > 0, `手记列表 ${noteCount} 条`)

  await page.click('.entry')
  await new Promise((r) => setTimeout(r, 800))
  const noteEditor = await page.evaluate(() => ({
    titleFieldHidden:
      document.querySelector('#field-title').closest('.meta-field').style.display === 'none',
    bodyLen: document.querySelector('#md-input')?.value?.length,
  }))
  ok(noteEditor.titleFieldHidden, '手记隐藏标题字段')
  ok(noteEditor.bodyLen > 0, '手记正文已加载')
}

console.log('\n=== 控制台错误 ===')
const realErrors = errors.filter(
  (e) => !e.includes('favicon') && !e.includes('DevTools'),
)
ok(realErrors.length === 0, `无 JS 错误`, realErrors.slice(0, 3).join(' | ') || '无')

await browser.close()

// 清理测试仓库
fs.rmSync(FIXTURE, { recursive: true, force: true })

console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exitCode = fail > 0 ? 1 : 0
