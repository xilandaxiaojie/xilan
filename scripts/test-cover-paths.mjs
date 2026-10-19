// 验证封面机制：写了路径就用路径，找不到就退回 covers/ 随机
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const PUBLIC = path.join(ROOT, 'public')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (!cond) failed++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
}

/* ---------- 与 src/lib/content.ts 的 resolveCoverPath 保持同步 ---------- */
function resolve(raw) {
  if (!raw) return undefined
  const v = raw.trim()
  if (!v) return undefined
  if (/^(https?:)?\/\//.test(v) || v.startsWith('data:')) return v

  let url
  if (v.startsWith('/')) {
    url = v
  } else {
    const cleaned = v.replace(/^\.\//, '').replace(/^\/+/, '')
    url = cleaned.includes('/') ? `/${cleaned}` : `/covers/${cleaned}`
  }

  const rel = decodeURIComponent(url).replace(/^\//, '')
  if (!fs.existsSync(path.join(PUBLIC, rel))) return undefined
  return url
}

/* ---------- 准备测试素材 ---------- */
console.log('=== 准备测试素材 ===')
// 用一个不与站点素材冲突的目录，验证「任意目录都能当封面来源」
fs.mkdirSync(path.join(ROOT, 'pics'), { recursive: true })
fs.writeFileSync(
  path.join(ROOT, 'pics', 'custom-bg.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#ffd166"/></svg>',
)
fs.writeFileSync(
  path.join(ROOT, 'images', 'cover-photo.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#7fd8d0"/></svg>',
)
console.log('  ✓ pics/custom-bg.svg')
console.log('  ✓ images/cover-photo.svg')

// 把这个目录同步到 public/，模拟真实构建流程
const tmpPost = path.join(ROOT, 'posts', '__cover-test__.md')
fs.writeFileSync(
  tmpPost,
  `---\ntitle: cover test\ndate: 2020-01-01\ncover: pics/custom-bg.svg\n---\n\n测试\n`,
)
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-assets.mjs')], {
    stdio: 'pipe',
  })
  console.log('  ✓ 已同步到 public/')
} catch (e) {
  console.log('  ✗ 同步失败: ' + String(e.message).slice(0, 60))
}
fs.rmSync(tmpPost, { force: true })

/* ---------- 路径解析 ---------- */
console.log('\n=== 路径解析（需先 npm run assets 同步到 public/） ===')
const cases = [
  ['images/cover-photo.svg', '/images/cover-photo.svg', 'images 目录'],
  ['pics/custom-bg.svg', '/pics/custom-bg.svg', '自定义目录'],
  ['/images/cover-photo.svg', '/images/cover-photo.svg', '站点绝对路径'],
  ['./pics/custom-bg.svg', '/pics/custom-bg.svg', '点斜杠'],
  ['covers/sakura-hill.svg', '/covers/sakura-hill.svg', '显式 covers 路径'],
  ['sakura-hill.svg', '/covers/sakura-hill.svg', '纯文件名 → covers/'],
  ['https://example.com/a.jpg', 'https://example.com/a.jpg', '外链（不检查）'],
  ['//cdn.example.com/a.jpg', '//cdn.example.com/a.jpg', '协议相对外链'],
]
for (const [raw, want, label] of cases) {
  const got = resolve(raw)
  ok(got === want, label, `${raw} → ${got}`)
}

console.log('\n=== 找不到文件 → 退回随机 ===')
for (const raw of ['images/不存在.svg', 'pics/nope.png', 'missing-file.svg']) {
  const got = resolve(raw)
  ok(got === undefined, `${raw} 解析为 undefined`, String(got))
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}`)
process.exitCode = failed > 0 ? 1 : 0
