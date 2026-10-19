/**
 * 验证浏览器版（release/浏览器版）是否完整可用
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), '..', 'package.json'))
const puppeteer = require('puppeteer-core')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:4399'
const FIXTURE = path.join(process.cwd(), '.tmp-br-fixture')

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

/* 准备测试仓库 */
fs.rmSync(FIXTURE, { recursive: true, force: true })
for (const d of ['posts', 'notes', 'covers']) {
  fs.mkdirSync(path.join(FIXTURE, d), { recursive: true })
}
fs.writeFileSync(
  path.join(FIXTURE, 'posts', 'demo.md'),
  `---\ntitle: 浏览器版测试\ndate: 2025-11-01\ntags:\n  - 测试\n---\n\n# 标题\n\n正文**粗体**\n`,
)
fs.writeFileSync(path.join(FIXTURE, 'notes', '2025-11-02.md'), `---\ndate: 2025-11-02\n---\n\n手记内容\n`)
const g = (...a) => execFileSync('git', a, { cwd: FIXTURE, stdio: 'pipe' })
g('init', '-q')
g('config', 'user.email', 't@t.com')
g('config', 'user.name', 'T')

/* 指向测试仓库 */
await fetch(BASE + '/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: 'repo.use', args: [FIXTURE] }),
})

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  userDataDir: path.join(process.cwd(), '.tmp', 'br-profile'),
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 940 })

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text())
})

console.log('=== 页面加载 ===')
await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))

ok(await page.evaluate(() => !!window.api), 'window.api 存在')

const st = await page.evaluate(() => ({
  appVisible: !document.querySelector('#screen-app').hidden,
  entries: document.querySelectorAll('.entry').length,
  repoPath: document.querySelector('#btn-repo-path')?.textContent,
}))
console.log('  状态:', JSON.stringify(st))

ok(st.appVisible, '已进入主界面')
ok(st.entries === 1, `文章列表 ${st.entries} 条`)

console.log('\n=== 打开文章 ===')
await page.click('.entry')
await new Promise((r) => setTimeout(r, 1000))

const ed = await page.evaluate(() => ({
  title: document.querySelector('#field-title')?.value,
  body: document.querySelector('#md-input')?.value?.length,
  preview: document.querySelector('#preview')?.innerHTML?.length,
}))
console.log('  编辑器:', JSON.stringify(ed))
ok(ed.title === '浏览器版测试', '标题正确', ed.title)
ok(ed.body > 0, '正文已加载')
ok(ed.preview > 5, '预览已渲染', `${ed.preview} 字节`)

console.log('\n=== 编辑并保存 ===')
await page.click('#field-title', { clickCount: 3 })
await page.type('#field-title', '改过的标题')
await new Promise((r) => setTimeout(r, 2200))

const saved = await page.evaluate(() => document.querySelector('#save-state')?.textContent)
console.log(`  保存状态: "${saved}"`)

const disk = fs.readFileSync(path.join(FIXTURE, 'posts', 'demo.md'), 'utf8')
ok(disk.includes('改过的标题'), '改动已写入磁盘')

console.log('\n=== 手记 ===')
await page.click('.tab[data-kind="note"]')
await new Promise((r) => setTimeout(r, 800))
const noteCount = await page.evaluate(() => document.querySelectorAll('.entry').length)
ok(noteCount === 1, `手记 ${noteCount} 条`)

console.log('\n=== 控制台错误 ===')
ok(errors.length === 0, '无报错', errors.slice(0, 2).join(' | ') || '无')

await browser.close()
fs.rmSync(FIXTURE, { recursive: true, force: true })

console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exitCode = fail > 0 ? 1 : 0
