// 检查打包产物中所有文本文件的 UTF-8 有效性
import fs from 'node:fs'
import path from 'node:path'

const RES = path.join(process.cwd(), 'release', 'Xilan Studio', 'resources', 'app')
const EXTS = new Set(['.js', '.cjs', '.mjs', '.json', '.html', '.css', '.md', '.txt', '.svg'])

let checked = 0
let bad = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(p)
      continue
    }
    if (!EXTS.has(path.extname(entry.name).toLowerCase())) continue

    checked++
    const buf = fs.readFileSync(p)
    let text
    try {
      text = buf.toString('utf8')
    } catch {
      console.log(`✗ 无法解码: ${p}`)
      bad++
      continue
    }

    // 检查是否有替换字符（解码失败的标志）
    if (text.includes('\uFFFD')) {
      console.log(`✗ 含替换字符: ${path.relative(RES, p)}`)
      bad++
      continue
    }

    // 检查中文内容是否可正常读取
    if (/[\u4e00-\u9fa5]/.test(text) && !text.includes('\uFFFD')) {
      // 正常
    }
  }
}

walk(RES)
console.log(`\n检查 ${checked} 个文本文件，${bad} 个有问题`)

// 额外验证：直接读取几个关键文件的中文
console.log('\n=== 关键文件中文校验 ===')
const samples = [
  ['package.json', 'description'],
  ['src/ui/index.html', 'HTML 中文'],
  ['src/ui/app.js', 'JS 中文'],
]
for (const [rel] of samples) {
  const p = path.join(RES, rel)
  const text = fs.readFileSync(p, 'utf8')
  const cn = text.match(/[\u4e00-\u9fa5]{2,}/g)
  console.log(`${rel}: ${cn ? cn.slice(0, 3).join(' / ') : '无中文'}`)
}

process.exitCode = bad > 0 ? 1 : 0
