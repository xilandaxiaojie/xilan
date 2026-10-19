/**
 * 验证打包后的应用结构是否能被 Electron 正确加载
 *
 * 检查：
 *  - resources/app/package.json 的 main 指向的文件存在
 *  - 主进程文件的语法有效
 *  - preload 存在
 *  - 界面入口存在
 *  - 核心模块能通过相对路径解析
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

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

const APP = path.join(process.cwd(), 'release', 'Xilan Studio', 'resources', 'app')

console.log('=== 应用结构 ===')
ok(fs.existsSync(APP), 'resources/app 存在')

const pkgPath = path.join(APP, 'package.json')
ok(fs.existsSync(pkgPath), 'package.json 存在')

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
ok(pkg.main === 'electron/main.cjs', 'main 入口正确', pkg.main)

const mainPath = path.join(APP, pkg.main)
ok(fs.existsSync(mainPath), '主进程文件存在')

console.log('\n=== 主进程依赖的文件 ===')
const mainSrc = fs.readFileSync(mainPath, 'utf8')
ok(mainSrc.includes("preload.cjs"), '引用了 preload')
ok(fs.existsSync(path.join(APP, 'electron', 'preload.cjs')), 'preload.cjs 存在')
ok(mainSrc.includes('index.html'), '引用了 index.html')
ok(fs.existsSync(path.join(APP, 'src', 'ui', 'index.html')), 'index.html 存在')
ok(mainSrc.includes('../src/core/repo.js'), '引用了核心模块')

console.log('\n=== 核心模块 ===')
for (const m of ['repo.js', 'git.js', 'frontmatter.js', 'markdown.js', 'github.js']) {
  ok(fs.existsSync(path.join(APP, 'src', 'core', m)), m)
}

console.log('\n=== 语法检查（打包后的文件）===')
const checkFiles = [
  path.join(APP, 'electron', 'main.cjs'),
  path.join(APP, 'electron', 'preload.cjs'),
  path.join(APP, 'src', 'ui', 'app.js'),
  ...['repo.js', 'git.js', 'frontmatter.js', 'markdown.js', 'github.js'].map((m) =>
    path.join(APP, 'src', 'core', m),
  ),
]
for (const f of checkFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
    ok(true, path.relative(APP, f))
  } catch (e) {
    ok(false, path.relative(APP, f), (e.stderr || '').toString().slice(0, 80))
  }
}

console.log('\n=== 界面资源 ===')
const html = fs.readFileSync(path.join(APP, 'src', 'ui', 'index.html'), 'utf8')
ok(html.includes('./app.js'), '引用 app.js')
ok(html.includes('./styles.css'), '引用 styles.css')
ok(fs.existsSync(path.join(APP, 'src', 'ui', 'app.js')), 'app.js 存在')
ok(fs.existsSync(path.join(APP, 'src', 'ui', 'styles.css')), 'styles.css 存在')

console.log('\n=== Electron 运行时 ===')
const OUT = path.join(process.cwd(), 'release', 'Xilan Studio')
ok(fs.existsSync(path.join(OUT, 'Xilan Studio.exe')), '主程序 exe')
ok(fs.existsSync(path.join(OUT, 'locales')), 'locales 目录')
ok(fs.existsSync(path.join(OUT, 'resources', 'app')), '应用资源目录')

// 移除默认 app（否则 Electron 可能加载它而不是我们的）
ok(
  !fs.existsSync(path.join(OUT, 'resources', 'default_app.asar')),
  '没有 default_app.asar 干扰',
)

console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exitCode = fail > 0 ? 1 : 0
