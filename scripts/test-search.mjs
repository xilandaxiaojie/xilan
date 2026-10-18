// 验证页头搜索框的完整交互流程
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

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.goto(BASE + '/', { waitUntil: 'networkidle0' })

console.log('=== 初始状态 ===')
{
  const st = await page.evaluate(() => {
    const form = document.getElementById('quick-search')
    const input = document.getElementById('quick-search-input')
    const r = document.querySelector('.quick-search__toggle')?.getBoundingClientRect()
    return {
      open: form?.classList.contains('is-open'),
      inputWidth: input?.getBoundingClientRect().width,
      iconVisible: r && r.width > 0,
      menuChars: [...document.querySelectorAll('.header__link-char')].map((s) => s.textContent.trim()),
    }
  })
  ok(st.open === false, '搜索框默认收起')
  ok(st.inputWidth === 0, `输入框收起时宽度为 0（实际 ${st.inputWidth}）`)
  ok(st.iconVisible, '顶部搜索图标可见')
  ok(st.menuChars.join(' ') === '源 文 记 览 签 余', `菜单: ${st.menuChars.join(' ')}`)
}

console.log('\n=== 点击图标展开 ===')
{
  await page.click('#quick-search-toggle')
  await new Promise((r) => setTimeout(r, 450))
  const st = await page.evaluate(() => {
    const form = document.getElementById('quick-search')
    const input = document.getElementById('quick-search-input')
    return {
      open: form?.classList.contains('is-open'),
      inputWidth: Math.round(input?.getBoundingClientRect().width ?? 0),
      focused: document.activeElement?.id,
      submitVisible: document.querySelector('.quick-search__submit')?.offsetParent !== null,
      url: location.pathname,
    }
  })
  ok(st.open === true, '点击后原地展开')
  ok(st.inputWidth > 100, `输入框展开（宽度 ${st.inputWidth}px）`)
  ok(st.focused === 'quick-search-input', '输入框自动聚焦')
  ok(st.submitVisible, '「搜索」按钮出现')
  ok(st.url === '/xilan/', '点击图标不跳转页面')
}

console.log('\n=== 空内容不跳转 ===')
{
  await page.click('.quick-search__submit')
  await new Promise((r) => setTimeout(r, 300))
  const url = await page.evaluate(() => location.pathname)
  ok(url === '/xilan/', '空输入提交后仍停留在当前页')
}

console.log('\n=== 输入后提交跳转 ===')
{
  await page.type('#quick-search-input', '代码')
  await page.click('.quick-search__submit')
  await page.waitForFunction(() => location.pathname.includes('/search'), { timeout: 8000 })
  const st = await page.evaluate(() => ({
    path: location.pathname,
    q: new URLSearchParams(location.search).get('q'),
    results: document.querySelectorAll('.r-card').length,
  }))
  ok(st.path.replace(/\/$/, '') === '/xilan/search', `跳转到搜索页: ${st.path}`)
  ok(st.q === '代码', `URL 带上关键词 q=${st.q}`)
  ok(st.results > 0, `搜索结果已渲染（${st.results} 条）`)
}

console.log('\n=== 回车键也能提交 ===')
{
  await page.goto(BASE + '/posts/', { waitUntil: 'networkidle0' })
  await page.click('#quick-search-toggle')
  await new Promise((r) => setTimeout(r, 400))
  await page.type('#quick-search-input', '动画')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.pathname.includes('/search'), { timeout: 8000 })
  const q = await page.evaluate(() => new URLSearchParams(location.search).get('q'))
  ok(q === '动画', `回车提交生效 q=${q}`)
}

console.log('\n=== Esc 收起 ===')
{
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
  await page.click('#quick-search-toggle')
  await new Promise((r) => setTimeout(r, 400))
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 400))
  const st = await page.evaluate(() => ({
    open: document.getElementById('quick-search')?.classList.contains('is-open'),
    w: Math.round(document.getElementById('quick-search-input')?.getBoundingClientRect().width ?? 0),
  }))
  ok(st.open === false, 'Esc 收起搜索框')
  ok(st.w === 0, '收起后输入框宽度归零')
}

console.log('\n=== 快捷键 / ===')
{
  // 先确保搜索框是收起的、焦点不在输入框
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    document.activeElement?.blur()
    document.body.click()
  })
  await new Promise((r) => setTimeout(r, 200))
  await page.keyboard.press('/')
  await new Promise((r) => setTimeout(r, 450))
  const st = await page.evaluate(() => ({
    open: document.getElementById('quick-search')?.classList.contains('is-open'),
    focused: document.activeElement?.id,
  }))
  ok(st.open === true, '按 / 展开搜索框')
  ok(st.focused === 'quick-search-input', '按 / 后自动聚焦')
}

await browser.close()
console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}`)
process.exitCode = failed > 0 ? 1 : 0
