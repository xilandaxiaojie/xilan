import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const exts = ['.astro', '.ts', '.md', '.css', '.mjs', '.json', '.yml']
const skipDirs = new Set([
  'node_modules',
  'dist',
  '.tools',
  '.tmp',
  '.astro',
  '.git',
  '.github',
  'scripts',
])
const files = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (exts.some((e) => name.endsWith(e))) files.push(p)
  }
}
walk(root)

// 用码点构造乱码特征，避免本文件自身匹配
// 常见 GBK 被误读为 UTF-8 的字符
const badChars = ['\uFFFD', '\u951B', '\u9286', '\u9225', '\u9568', '\u9547', '\u8D5B', '\u78A7', '\u893A', '\u817E', '\u950B']
const re = new RegExp(`[${badChars.join('')}]`, 'g')

let bad = 0
for (const f of files) {
  const buf = readFileSync(f)
  const text = buf.toString('utf8')
  const hits = text.match(re)
  const hasBOM = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  if (hits || hasBOM) {
    bad++
    console.log(`问题文件: ${relative(root, f)} 可疑字符=${hits ? hits.length : 0} BOM=${hasBOM}`)
  }
}
console.log(`\n扫描 ${files.length} 个文件，${bad} 个有问题`)
process.exitCode = bad > 0 ? 1 : 0
