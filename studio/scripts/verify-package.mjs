/**
 * 验证打包产物结构
 *
 * 产物是 @electron/packager 生成的：
 *   release/Xilan Studio-win32-x64/
 *     ├── Xilan Studio.exe
 *     ├── resources/app.asar      ← 应用代码打包在这里
 *     └── 各种 dll / pak / locales
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

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

const OUT = path.join(process.cwd(), 'release', 'Xilan Studio-win32-x64')
const ASAR = path.join(OUT, 'resources', 'app.asar')

console.log('=== 运行时文件 ===')
ok(fs.existsSync(OUT), '产物目录存在', OUT)
for (const f of [
  'Xilan Studio.exe',
  'icudtl.dat',
  'ffmpeg.dll',
  'd3dcompiler_47.dll',
  'resources.pak',
  'v8_context_snapshot.bin',
]) {
  ok(fs.existsSync(path.join(OUT, f)), f)
}
ok(fs.existsSync(path.join(OUT, 'locales')), 'locales 目录')
ok(fs.existsSync(path.join(OUT, 'resources', 'app.asar')), 'resources/app.asar')

// 运行时 DLL 与原版 Electron 保持一致
const ELECTRON_DIST = path.join(process.cwd(), 'node_modules', 'electron', 'dist')
if (fs.existsSync(ELECTRON_DIST)) {
  const srcDlls = fs
    .readdirSync(ELECTRON_DIST)
    .filter((n) => n.toLowerCase().endsWith('.dll'))
    .sort()
  const outDlls = fs
    .readdirSync(OUT)
    .filter((n) => n.toLowerCase().endsWith('.dll'))
    .sort()
  const missingDll = srcDlls.filter((n) => !outDlls.includes(n))
  ok(missingDll.length === 0, `运行时 DLL 齐全（${outDlls.length} 个）`, missingDll.join(', '))
}

// 版本号
const verFile = path.join(OUT, 'version')
if (fs.existsSync(verFile)) {
  const ver = fs.readFileSync(verFile, 'utf8').trim()
  ok(/^\d+\./.test(ver), '记录 Electron 版本', ver)
}

console.log('\n=== exe 元信息 ===')
const vi = fs.existsSync(path.join(OUT, 'Xilan Studio.exe'))
  ? (await import('node:child_process')).execFileSync(
      process.execPath,
      [
        '-e',
        `const v=require('fs').statSync(${JSON.stringify(path.join(OUT, 'Xilan Studio.exe'))});console.log(v.size)`,
      ],
      { encoding: 'utf8' },
    )
  : ''
ok(Number(vi) > 50_000_000, 'exe 体积正常', `${(Number(vi) / 1024 / 1024).toFixed(0)} MB`)

console.log('\n=== asar 内容 ===')
if (!fs.existsSync(ASAR)) {
  console.log('  （asar 缺失，跳过）')
} else {
  const files = asar.listPackage(ASAR).map((f) => f.replace(/\\/g, '/'))
  ok(files.length > 10, `共 ${files.length} 个文件`)

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
  for (const n of needed) ok(files.includes(n), n)

  ok(!files.some((f) => f.startsWith('/node_modules')), '不含多余的 node_modules')
  ok(!files.some((f) => f.startsWith('/scripts')), '不含开发脚本')
  ok(!files.some((f) => f.startsWith('/release')), '不含产物自身')

  const pkg = JSON.parse(asar.extractFile(ASAR, 'package.json').toString('utf8'))
  ok(pkg.main === 'electron/main.cjs', 'main 入口正确', pkg.main)
  ok(files.includes('/' + pkg.main), 'main 指向的文件存在')

  const mainText = asar.extractFile(ASAR, 'electron/main.cjs').toString('utf8')
  ok(mainText.length > 5000, 'main.cjs 内容完整', `${mainText.length} 字符`)
  ok(mainText.includes('preload.cjs'), 'main.cjs 引用了 preload')
}

console.log('\n=== 附带文件 ===')
ok(fs.existsSync(path.join(OUT, '启动.bat')), '启动.bat（用于排查）')
ok(fs.existsSync(path.join(OUT, '使用说明.txt')), '使用说明.txt')

console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exitCode = fail > 0 ? 1 : 0
