/**
 * 手工打包便携版
 *
 * 不依赖 electron-builder 的 rcedit / 签名步骤（在受限环境里容易失败），
 * 直接把 Electron 运行时与应用代码组装成一个可运行的目录。
 *
 * 产出：release/Xilan Studio/Xilan Studio.exe
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'node_modules', 'electron', 'dist')
const OUT = path.join(ROOT, 'release', 'Xilan Studio')
const RES = path.join(OUT, 'resources', 'app')

console.log('=== 检查 Electron 运行时 ===')
if (!fs.existsSync(path.join(SRC, 'electron.exe'))) {
  console.error('找不到 node_modules/electron/dist/electron.exe，请先 npm install')
  process.exit(1)
}

console.log('=== 清理输出目录 ===')
fs.rmSync(path.join(ROOT, 'release'), { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

console.log('=== 复制 Electron 运行时 ===')

// 手工逐文件复制，避免 fs.cpSync 在受限环境下的目录操作限制
function copyPlain(from, to) {
  const stat = fs.statSync(from)
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const name of fs.readdirSync(from)) {
      copyPlain(path.join(from, name), path.join(to, name))
    }
    return 1
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  return 1
}

let count = 0
for (const name of fs.readdirSync(SRC)) {
  count += copyPlain(path.join(SRC, name), path.join(OUT, name))
}
console.log(`  复制 ${count} 个文件`)

// 重命名主程序
const exeFrom = path.join(OUT, 'electron.exe')
const exeTo = path.join(OUT, 'Xilan Studio.exe')
fs.renameSync(exeFrom, exeTo)
console.log('  主程序 → Xilan Studio.exe')

// 移除 Electron 自带的默认应用，避免它抢在我们的 app 之前被加载
const defaultApp = path.join(OUT, 'resources', 'default_app.asar')
if (fs.existsSync(defaultApp)) {
  fs.unlinkSync(defaultApp)
  console.log('  已移除 default_app.asar')
}

console.log('=== 复制应用代码 ===')
fs.mkdirSync(RES, { recursive: true })

const copyTree = (from, to) => {
  if (!fs.existsSync(from)) return
  copyPlain(from, to)
}

copyTree(path.join(ROOT, 'electron'), path.join(RES, 'electron'))
copyTree(path.join(ROOT, 'src', 'ui'), path.join(RES, 'src', 'ui'))
copyTree(path.join(ROOT, 'src', 'core'), path.join(RES, 'src', 'core'))
copyTree(path.join(ROOT, 'build'), path.join(RES, 'build'))

// 精简的 package.json（只保留运行必需信息）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const runtimePkg = {
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  main: pkg.main,
}
fs.writeFileSync(
  path.join(RES, 'package.json'),
  JSON.stringify(runtimePkg, null, 2),
  'utf8',
)

console.log('  应用代码已复制')

console.log('=== 生成启动说明 ===')
fs.writeFileSync(
  path.join(OUT, '使用说明.txt'),
  `Xilan Studio ${pkg.version}

这是便携版，不需要安装。

双击「Xilan Studio.exe」即可运行。

如果双击没反应：
  1. 确认本机已安装 Git（命令行运行 git --version 应有输出）
  2. 右键 exe → 属性 → 解除锁定（如果出现该选项）

配置文件位于：
  %APPDATA%\\Xilan Studio\\config.json
删除该文件可以重置登录状态和仓库记录。

完整使用说明见项目根目录的 README.md
`,
  'utf8',
)
console.log('  使用说明.txt')

// 统计体积
const dirSize = (dir) => {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else total += fs.statSync(p).size
  }
  return total
}

const size = dirSize(OUT)
console.log(`\n=== 打包完成 ===`)
console.log(`输出目录: ${OUT}`)
console.log(`总体积: ${(size / 1024 / 1024).toFixed(1)} MB`)
console.log(`可执行文件: ${exeTo}`)
