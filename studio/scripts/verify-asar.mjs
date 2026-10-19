// 检查 asar 包内容
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const DIR = 'D:\\DSH\\博客\\studio\\release\\Xilan Studio-win32-x64'
const ASAR = path.join(DIR, 'resources', 'app.asar')

console.log('asar 大小:', (fs.statSync(ASAR).size / 1024 / 1024).toFixed(2), 'MB\n')

const files = asar.listPackage(ASAR).map((f) => f.replace(/\\/g, '/'))
console.log('=== 文件清单 ===')
for (const f of files) console.log(' ', f)

const needed = [
  '/package.json',
  '/electron/main.cjs',
  '/electron/preload.cjs',
  '/src/ui/index.html',
  '/src/ui/app.js',
  '/src/ui/styles.css',
  '/src/core/repo.js',
  '/src/core/git.js',
  '/src/core/frontmatter.js',
  '/src/core/markdown.js',
  '/src/core/github.js',
]

console.log('\n=== 必需文件检查 ===')
let missing = 0
for (const n of needed) {
  const ok = files.includes(n)
  if (!ok) missing++
  console.log(`  ${ok ? '✓' : '✗'} ${n}`)
}

const hasNodeModules = files.some((f) => f.startsWith('/node_modules'))
console.log(`\n${hasNodeModules ? '✗' : '✓'} 不含多余的 node_modules`)

const pkg = JSON.parse(asar.extractFile(ASAR, 'package.json').toString('utf8'))
console.log('\n=== app/package.json ===')
console.log('  main:', pkg.main, '-> 存在:', files.includes('/' + pkg.main))
console.log('  type:', pkg.type)

const mainText = asar.extractFile(ASAR, 'electron/main.cjs').toString('utf8')
console.log('  main.cjs:', mainText.length, '字符，结尾:', JSON.stringify(mainText.slice(-40)))

console.log('\n缺失数:', missing, '| node_modules:', hasNodeModules)
process.exitCode = missing > 0 || hasNodeModules ? 1 : 0
