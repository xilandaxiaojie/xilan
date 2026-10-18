/**
 * 把表层目录里的静态资源同步到 public/ 下，供站点直接访问。
 *
 *   covers/  →  public/covers/
 *   images/  →  public/images/
 *   以及 frontmatter 里 cover 指向的其他目录
 *
 * 之所以不直接把 public 当成这些目录：内容与素材都放在仓库表层更直观，
 * 而 Astro 只服务 publicDir。构建前同步一次即可。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PUBLIC = path.join(ROOT, 'public')
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'])

/* ---------- 从 md 里找出 cover 引用的目录 ---------- */

const readCoverDirs = () => {
  const dirs = new Set()
  for (const mdDir of ['posts', 'notes']) {
    const abs = path.join(ROOT, mdDir)
    if (!fs.existsSync(abs)) continue
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.md')) continue
      const raw = fs.readFileSync(path.join(abs, name), 'utf8')
      const m = raw.match(/^cover\s*:\s*(.+)$/m)
      if (!m) continue
      let v = m[1].trim().replace(/^["']|["']$/g, '')
      // 外链或 data URI 跳过
      if (/^(https?:)?\/\//.test(v) || v.startsWith('data:')) continue
      v = v.replace(/^\.\//, '').replace(/^\/+/, '')
      // 纯文件名：只会在 covers/ 里，已经固定同步过
      if (!v.includes('/')) continue
      const dir = v.slice(0, v.lastIndexOf('/'))
      if (dir && !dir.startsWith('..')) dirs.add(dir)
    }
  }
  return [...dirs]
}

/* ---------- 同步 ---------- */

const seen = new Set()
let total = 0

function syncDir(srcName) {
  // 规范化，避免 ./x 与 x 重复同步
  const key = srcName.replace(/^\/+|\/+$/g, '')
  if (!key || seen.has(key)) return
  seen.add(key)

  const src = path.join(ROOT, key)
  const dest = path.join(PUBLIC, key)

  // 只处理仓库内已存在的目录，防止路径穿越
  if (!src.startsWith(ROOT) || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
    return
  }

  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })

  let count = 0
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    if (!fs.statSync(from).isFile()) continue
    if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) continue
    fs.copyFileSync(from, path.join(dest, name))
    count++
  }
  total += count
  console.log(`[assets] ${key}/ → public/${key}/  (${count} 个文件)`)
}

// 固定目录
syncDir('covers')
syncDir('images')

// public/assets/ 是头像与背景图这类站点自带素材，不由脚本生成，
// 这里只做存在性检查，避免误删后构建静默出问题。
for (const name of ['avatar.svg', 'background.svg', 'background-night.svg']) {
  const p = path.join(PUBLIC, 'assets', name)
  if (!fs.existsSync(p)) {
    console.warn(`[assets] ⚠ 缺少 public/assets/${name}`)
  }
}

// 加上 md 里额外引用的目录
const extra = readCoverDirs()
for (const d of extra) {
  if (d === 'covers' || d === 'images') continue
  console.log(`[assets] 检测到封面引用目录: ${d}/`)
  syncDir(d)
}

console.log(`[assets] 共同步 ${total} 个图片文件`)
