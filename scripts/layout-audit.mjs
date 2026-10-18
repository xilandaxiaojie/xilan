// 用真实浏览器做布局审计：检测溢出、元素碰撞、对比度、字体与图片加载。
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:4321/xilan'

const pages = [
  ['/', '首页'],
  ['/posts/', '博文列表'],
  ['/posts/hello-world/', '文章详情'],
  ['/posts/markdown-showcase/', 'Markdown 展示'],
  ['/notes/', '手记'],
  ['/archive/', '归档'],
  ['/about/', '关于'],
]

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  userDataDir: 'D:\\DSH\\博客\\.tmp\\puppeteer-profile',
  args: ['--no-sandbox', '--disable-gpu'],
})

let issues = 0
const report = (sev, page, msg) => {
  issues++
  console.log(`  [${sev}] ${msg}`)
}

for (const [path, label] of pages) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`))

  await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 30000 })

  console.log(`\n=== ${label} ${path} ===`)

  const result = await page.evaluate(() => {
    const out = { overflow: [], images: [], fonts: [], contrast: [], offscreen: [] }
    const docW = document.documentElement.clientWidth

    // 1. 水平溢出检测
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.closest('pre')) continue // 代码块允许横向滚动
      if (el.classList.contains('skip-link')) continue // 无障碍跳转链接本就应该在视口外
      if (r.right > docW + 2 || r.left < -2) {
        out.overflow.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString?.() || '').slice(0, 60),
          left: Math.round(r.left),
          right: Math.round(r.right),
          docW,
        })
      }
    }

    // 2. 图片加载
    for (const img of document.querySelectorAll('img')) {
      if (!img.complete || img.naturalWidth === 0) {
        out.images.push(img.getAttribute('src'))
      }
    }

    // 3. 字体是否真的生效（不应回退到默认 serif 导致衬线标题丢失）
    const h1 = document.querySelector('h1')
    if (h1) {
      const ff = getComputedStyle(h1).fontFamily
      out.fonts.push({ tag: 'h1', family: ff.slice(0, 80) })
    }
    const body = getComputedStyle(document.body)
    out.fonts.push({ tag: 'body', family: body.fontFamily.slice(0, 80) })

    // 4. 文字与背景对比度（对正文段落采样）
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const parse = (s) => {
      s = s.trim()
      // #rgb / #rrggbb
      const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
      if (hex) {
        let h = hex[1]
        if (h.length === 3) h = h.split('').map((c) => c + c).join('')
        return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], a: 1 }
      }
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null
    }

    // 背景色：优先用 body 的实际计算背景色，再回退到 CSS 变量
    const bodyBgRaw = getComputedStyle(document.body).backgroundColor
    const varBgRaw =
      getComputedStyle(document.documentElement).getPropertyValue('--light-bg').trim() || '#ffffff'
    const bg = parse(bodyBgRaw) && parse(bodyBgRaw).a > 0.5 ? parse(bodyBgRaw) : parse(varBgRaw) || { rgb: [255, 255, 255] }

    const sample = [...document.querySelectorAll('main p, main li, .prose p, .card__desc, .item__title, .tag-chip')].slice(0, 25)
    for (const el of sample) {
      const fg = parse(getComputedStyle(el).color)
      if (!fg) continue
      const L1 = lum(fg.rgb)
      const L2 = lum(bg.rgb)
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
      if (ratio < 3) {
        out.contrast.push({ text: el.textContent?.trim().slice(0, 30), ratio: ratio.toFixed(2), fg: getComputedStyle(el).color })
      }
    }

    // 5. 元素重叠（页头与首屏内容）
    const header = document.querySelector('.header')
    const hero = document.querySelector('.hero, .page-title, .article__title')
    if (header && hero) {
      const hr = header.getBoundingClientRect()
      const gr = hero.getBoundingClientRect()
      if (gr.top < hr.bottom - 2) {
        out.offscreen.push({
          note: '首屏内容与页头重叠',
          headerBottom: Math.round(hr.bottom),
          contentTop: Math.round(gr.top),
        })
      }
    }

    return out
  })

  if (result.overflow.length) {
    for (const o of result.overflow.slice(0, 5)) {
      report('WARN', path, `水平溢出 <${o.tag}.${o.cls}> left=${o.left} right=${o.right} (docW=${o.docW})`)
    }
  } else {
    console.log('  ✓ 无水平溢出')
  }

  if (result.images.length) {
    for (const src of result.images) report('ERROR', path, `图片加载失败: ${src}`)
  } else {
    console.log('  ✓ 图片全部加载')
  }

  if (result.contrast.length) {
    for (const c of result.contrast) report('WARN', path, `对比度偏低 ${c.ratio}: "${c.text}"`)
  } else {
    console.log('  ✓ 文字对比度正常')
  }

  for (const o of result.offscreen) {
    report('ERROR', path, `${o.note} (headerBottom=${o.headerBottom}, contentTop=${o.contentTop})`)
  }

  const h1Font = result.fonts.find((f) => f.tag === 'h1')
  console.log(`  ℹ h1 字体: ${h1Font ? h1Font.family : 'n/a'}`)

  if (errors.length) {
    for (const e of [...new Set(errors)].slice(0, 5)) report('ERROR', path, `控制台/网络: ${e}`)
  } else {
    console.log('  ✓ 无控制台错误')
  }

  await page.close()
}

// 暗色模式检查
console.log('\n=== 暗色模式 ===')
const dark = await browser.newPage()
await dark.setViewport({ width: 1440, height: 900 })
await dark.goto(BASE + '/', { waitUntil: 'networkidle0' })
await dark.evaluate(() => {
  document.documentElement.classList.add('dark')
  localStorage.setItem('xilan-theme', 'dark')
})
await dark.reload({ waitUntil: 'networkidle0' })
const darkInfo = await dark.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  return {
    isDark: document.documentElement.classList.contains('dark'),
    bg: cs.getPropertyValue('--light-bg').trim(),
    text: cs.getPropertyValue('--text').trim(),
    primary: cs.getPropertyValue('--primary').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }
})
console.log(`  暗色类生效: ${darkInfo.isDark ? '✓' : '✗'}  背景=${darkInfo.bg} 文字=${darkInfo.text} 主色=${darkInfo.primary} bodyBg=${darkInfo.bodyBg}`)
if (!darkInfo.isDark) issues++
await dark.close()

// 移动端检查
console.log('\n=== 移动端 (390x844) ===')
const mobile = await browser.newPage()
await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
for (const [path, label] of [['/', '首页'], ['/posts/', '博文列表'], ['/posts/hello-world/', '文章详情']]) {
  await mobile.goto(BASE + path, { waitUntil: 'networkidle0' })
  const r = await mobile.evaluate(() => {
    const docW = document.documentElement.clientWidth
    const scrollW = document.documentElement.scrollWidth
    const menuVisible = getComputedStyle(document.querySelector('.header__nav')).display
    const toggleVisible = getComputedStyle(document.querySelector('.menu-toggle')).display
    return { docW, scrollW, menuVisible, toggleVisible }
  })
  const overflow = r.scrollW > r.docW + 2
  if (overflow) {
    report('ERROR', path, `移动端横向滚动: scrollW=${r.scrollW} > docW=${r.docW}`)
  } else {
    console.log(`  ✓ ${label} 无横向滚动`)
  }
  const mobileMenuOk = r.menuVisible === 'none' && r.toggleVisible !== 'none'
  if (!mobileMenuOk) report('WARN', path, `移动端菜单切换异常: nav=${r.menuVisible}, toggle=${r.toggleVisible}`)
}
await mobile.close()

await browser.close()
console.log(`\n${issues === 0 ? '✓ 布局审计全部通过' : `⚠ 共发现 ${issues} 个问题`}`)
process.exitCode = issues > 0 ? 1 : 0
