// 验证标签页已恢复且功能正常
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:4321/xilan'

let failed = 0
const ok = (cond, label) => {
  if (!cond) failed++
  console.log(`  ${cond ? '✓' : '✗'} ${label}`)
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  userDataDir: 'D:\\DSH\\博客\\.tmp\\puppeteer-profile',
  args: ['--no-sandbox', '--disable-gpu'],
})

console.log('=== 菜单 ===')
{
  const page = await browser.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('.header__link-char')].map((s) => s.textContent.trim()),
  )
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.header__link-label')].map((s) => s.textContent.trim()),
  )
  ok(menu.join(' ') === '源 文 记 览 签 余', `菜单: ${menu.join(' ')}`)
  ok(labels.join(' ') === '首页 博文 手记 归档 标签 关于', `标签名: ${labels.join(' ')}`)
  await page.close()
}

console.log('\n=== 标签页内容 ===')
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  const res = await page.goto(BASE + '/tags/', { waitUntil: 'networkidle0' })
  ok(res.status() < 400, `/tags/ -> ${res.status()}`)

  const data = await page.evaluate(() => ({
    cloudItems: document.querySelectorAll('.cloud__item').length,
    sections: [...document.querySelectorAll('.tag-section')].map((s) => ({
      id: s.id,
      name: s.querySelector('.tag-section__name')?.textContent?.replace('#', '').trim(),
      count: s.querySelector('.tag-section__count')?.textContent?.trim(),
      entries: s.querySelectorAll('.entry').length,
    })),
    hasPost: document.querySelectorAll('.entry--post').length,
    hasNote: document.querySelectorAll('.entry--note').length,
    heading: document.querySelector('.page-head__title')?.textContent?.trim(),
  }))

  ok(data.heading === '标签', `页面标题: ${data.heading}`)
  ok(data.cloudItems > 0, `标签云 ${data.cloudItems} 个标签`)
  ok(data.sections.length === data.cloudItems, '每个标签都有对应分组')

  let consistent = true
  for (const s of data.sections) {
    if (Number(s.count) !== s.entries) consistent = false
  }
  ok(consistent, '分组内条目数与计数一致')
  ok(data.hasPost > 0, `包含博文条目 (${data.hasPost})`)
  ok(data.hasNote > 0, `包含手记条目 (${data.hasNote})`)

  console.log('    标签明细:')
  for (const s of data.sections) {
    console.log(`      #${s.name}  ${s.count} 条`)
  }
  await page.close()
}

console.log('\n=== 全部页面可达 ===')
for (const [p, label] of [
  ['/', '首页'],
  ['/posts/', '博文'],
  ['/notes/', '手记'],
  ['/archive/', '归档'],
  ['/tags/', '标签'],
  ['/search/', '搜索'],
  ['/about/', '关于'],
]) {
  const r = await fetch(BASE + p)
  ok(r.status === 200, `${label} ${p} -> ${r.status}`)
}

await browser.close()
console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}`)
process.exitCode = failed > 0 ? 1 : 0
