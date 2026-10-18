// 端到端验证：目录结构、封面、搜索
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = process.cwd()
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:4321/xilan'

let failed = 0
const ok = (cond, label) => {
  if (!cond) failed++
  console.log(`  ${cond ? '✓' : '✗'} ${label}`)
}

/* ---------- 1. 目录结构 ---------- */
console.log('=== 目录结构 ===')
for (const dir of ['posts', 'notes', 'images', 'covers']) {
  ok(fs.existsSync(path.join(ROOT, dir)), `表层目录 ${dir}/ 存在`)
}
ok(!fs.existsSync(path.join(ROOT, 'src', 'content')), 'src/content 已移除')
ok(
  fs.readdirSync(path.join(ROOT, 'posts')).filter((f) => f.endsWith('.md')).length === 4,
  'posts/ 有 4 篇文章',
)
ok(
  fs.readdirSync(path.join(ROOT, 'notes')).filter((f) => f.endsWith('.md')).length === 3,
  'notes/ 有 3 条手记',
)
const coverCount = fs.readdirSync(path.join(ROOT, 'covers')).filter((f) => /\.(svg|png|jpe?g|webp)$/i.test(f)).length
ok(coverCount >= 4, `covers/ 有 ${coverCount} 张封面`)

/* ---------- 2. 搜索索引 ---------- */
console.log('\n=== 搜索索引 ===')
const idxRes = await fetch(BASE + '/search-index.json')
ok(idxRes.ok, `search-index.json 可访问 (${idxRes.status})`)
const idx = await idxRes.json()
ok(idx.count === 7, `索引包含 ${idx.count} 条`)
ok(
  idx.items.some((i) => i.type === 'post') && idx.items.some((i) => i.type === 'note'),
  '索引同时包含博文与手记',
)

/* ---------- 3. 页面与封面 ---------- */
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  userDataDir: 'D:\\DSH\\博客\\.tmp\\puppeteer-profile',
  args: ['--no-sandbox', '--disable-gpu'],
})

console.log('\n=== 首页封面 ===')
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
  const covers = await page.evaluate(() =>
    [...document.querySelectorAll('.card__cover img')].map((img) => ({
      src: img.getAttribute('src'),
      loaded: img.complete && img.naturalWidth > 0,
    })),
  )
  ok(covers.length === 4, `首页 4 张文章卡片都有封面占位 (${covers.length})`)
  ok(covers.every((c) => c.loaded), '封面图片全部加载成功')
  console.log('    封面:', covers.map((c) => c.src.split('/').pop()).join(', '))
  await page.close()
}

console.log('\n=== 搜索页交互 ===')
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(BASE + '/search/', { waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => /共 \d+ 条内容可以被搜到/.test(document.getElementById('search-hint')?.textContent ?? ''),
    { timeout: 10000 },
  )

  const ready = await page.$eval('#search-hint', (el) => el.textContent)
  ok(/共 7 条内容可以被搜到/.test(ready), `索引加载完成: "${ready}"`)

  // 搜索「代码」
  await page.type('#search-input', '代码')
  await page.waitForFunction(() => document.querySelectorAll('.r-card').length > 0, { timeout: 5000 })
  const r1 = await page.evaluate(() => ({
    n: document.querySelectorAll('.r-card').length,
    hint: document.getElementById('search-hint')?.textContent,
    hasMark: document.querySelectorAll('mark').length > 0,
  }))
  ok(r1.n > 0, `搜「代码」得到 ${r1.n} 条结果`)
  ok(r1.hasMark, '关键词被高亮标记')

  // 搜索不存在的词
  await page.$eval('#search-input', (el) => (el.value = ''))
  await page.type('#search-input', 'zzzzzz不存在')
  await page.waitForFunction(() => !document.getElementById('search-empty')?.hidden, { timeout: 5000 })
  ok(true, '无结果时显示空状态提示')

  // 清空
  await page.click('#search-clear')
  const cleared = await page.$eval('#search-input', (el) => el.value)
  ok(cleared === '', '清空按钮生效')
  await page.close()
}

console.log('\n=== 各页面渲染 ===')
for (const [p, label] of [
  ['/', '首页'],
  ['/posts/', '博文'],
  ['/notes/', '手记'],
  ['/archive/', '归档'],
  ['/search/', '搜索'],
  ['/about/', '关于'],
  ['/posts/hello-world/', '文章详情'],
]) {
  const res = await fetch(BASE + p)
  ok(res.status === 200, `${label} ${p} -> ${res.status}`)
}

/* ---------- 4. Markdown 渲染是否正常 ---------- */
console.log('\n=== Markdown 渲染 ===')
{
  const html = await (await fetch(BASE + '/posts/markdown-showcase/')).text()
  ok(/<pre[^>]*class="astro-code/.test(html), '代码块有 Shiki 高亮')
  ok(/<table/.test(html), '表格渲染正常')
  ok(/<h2/.test(html), '标题渲染正常')
  ok(!/\uFFFD/.test(html), '无乱码字符')
  ok(/article__cover/.test(html), '文章详情页显示封面')
}

console.log('\n=== 导航 ===')
{
  const html = await (await fetch(BASE + '/')).text()
  const chars = [...html.matchAll(/header__link-char[^>]*>([^<])</g)].map((m) => m[1])
  ok(chars.join(' ') === '源 文 记 览 签 余', `菜单: ${chars.join(' ')}`)
}

await browser.close()
console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}`)
process.exitCode = failed > 0 ? 1 : 0
