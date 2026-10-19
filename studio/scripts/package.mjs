/**
 * 用官方 @electron/packager 打包
 *
 * 相比手工复制，它能正确处理：
 *  - exe 重命名后的资源定位
 *  - Windows 版本信息与图标
 *  - 依赖裁剪
 */
import { packager } from '@electron/packager'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'release')

// @electron/packager 默认把 Electron 缓存写到 %LOCALAPPDATA%\electron\Cache，
// 某些受限环境下不可写，这里统一指向项目内目录
const CACHE_DIR = path.join(ROOT, '.electron-cache')
fs.mkdirSync(CACHE_DIR, { recursive: true })
process.env.ELECTRON_CACHE = CACHE_DIR
process.env.electron_config_cache = CACHE_DIR

console.log('=== 清理旧产物 ===')

// 先尝试结束占用 release 目录的进程（浏览器版会复制 node.exe 进去并运行）
const { execFileSync } = await import('node:child_process')
try {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Get-Process node,Xilan* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*${path.basename(OUT)}*' } | Stop-Process -Force -ErrorAction SilentlyContinue`,
  ], { stdio: 'ignore', timeout: 15000 })
} catch {
  // 忽略
}
await new Promise((r) => setTimeout(r, 500))

// Windows 上刚被杀掉的进程可能短暂占用目录，重试几次
if (fs.existsSync(OUT)) {
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 3 })
      break
    } catch (err) {
      if (i === 5) {
        throw new Error(
          `无法删除 ${OUT}，可能有程序正在运行它。\n` +
            `请关闭浏览器版窗口，或手动删除该目录后重试。\n原始错误: ${err.message}`,
        )
      }
      console.log(`  重试清理 (${i + 1})…`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

console.log('=== 打包中（第一次会下载 Electron，可能要几分钟）===')

// 直接用本地已下载的 Electron 运行时，避免 packager 再去下载
const LOCAL_ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist')
if (!fs.existsSync(path.join(LOCAL_ELECTRON, 'electron.exe'))) {
  throw new Error(
    `找不到本地 Electron 运行时：${LOCAL_ELECTRON}\n` +
      `请先在 node_modules/electron 下执行 node install.js 下载。`,
  )
}
console.log('  使用本地 Electron:', fs.readFileSync(path.join(LOCAL_ELECTRON, 'version'), 'utf8').trim())

const appPaths = await packager({
  dir: ROOT,
  out: OUT,
  name: 'Xilan Studio',
  platform: 'win32',
  arch: 'x64',
  electronVersion: fs.readFileSync(path.join(LOCAL_ELECTRON, 'version'), 'utf8').trim(),
  download: { cacheRoot: CACHE_DIR },
  appVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  icon: path.join(ROOT, 'build', 'icon.ico'),
  overwrite: true,
  // 只带运行必需的文件
  ignore: [
    /^\/release($|\/)/,
    /^\/node_modules($|\/)/,
    /^\/\.npm-cache($|\/)/,
    /^\/\.electron-cache($|\/)/,
    /^\/\.tmp($|\/)/,
    /^\/\.tmp-/,
    /^\/scripts($|\/)/,
    /^\/README\.md$/,
    /^\/启动排查\.md$/,
    /^\/package-lock\.json$/,
  ],
  win32metadata: {
    CompanyName: 'Xilan',
    FileDescription: 'Xilan Studio',
    ProductName: 'Xilan Studio',
    OriginalFilename: 'Xilan Studio.exe',
    InternalName: 'Xilan Studio',
  },
})

// 附上一个启动器，用于绕开环境变量干扰并显示退出码
const launcher = [
  '@echo off',
  'chcp 65001 >nul',
  'set "ELECTRON_RUN_AS_NODE="',
  'cd /d "%~dp0"',
  '"%~dp0Xilan Studio.exe" %*',
  'set "CODE=%errorlevel%"',
  'if not "%CODE%"=="0" (',
  '  echo.',
  '  echo ============================================',
  '  echo  程序已退出，退出码 %CODE%',
  '  echo ============================================',
  '  echo 请把上面的报错信息反馈给开发者。',
  '  pause',
  ')',
  '',
].join('\r\n')

const readme = [
  'Xilan Studio',
  '',
  '双击「Xilan Studio.exe」运行。',
  '',
  '如果双击没反应，按顺序试：',
  '  1. 双击「启动.bat」      —— 清环境变量 + 显示退出码',
  '  2. 双击「诊断.bat」      —— 完整诊断，带详细日志',
  '',
  '排查步骤见项目里的 studio/启动排查.md',
  '',
].join('\r\n')

const diagnose = [
  '@echo off',
  'chcp 65001 >nul',
  'title Xilan Studio 诊断',
  'echo ============================================',
  'echo  Xilan Studio 诊断',
  'echo ============================================',
  'echo.',
  'echo [1] 环境变量',
  'echo     ELECTRON_RUN_AS_NODE = [%ELECTRON_RUN_AS_NODE%]',
  'echo     ELECTRON_NO_ATTACH_CONSOLE = [%ELECTRON_NO_ATTACH_CONSOLE%]',
  'echo     NODE_OPTIONS = [%NODE_OPTIONS%]',
  'echo.',
  'echo [2] 清理干扰变量',
  'set "ELECTRON_RUN_AS_NODE="',
  'set "ELECTRON_NO_ATTACH_CONSOLE="',
  'set "NODE_OPTIONS="',
  'echo     已清理',
  'echo.',
  'echo [3] 检查文件',
  'cd /d "%~dp0"',
  'if exist "Xilan Studio.exe" (echo     exe: 存在) else (echo     exe: 缺失 & goto :end)',
  'if exist "resources\\app.asar" (echo     app.asar: 存在) else (echo     app.asar: 缺失 & goto :end)',
  'if exist "icudtl.dat" (echo     icudtl.dat: 存在) else (echo     icudtl.dat: 缺失 & goto :end)',
  'echo.',
  'echo [4] 启动（全量日志）',
  'echo --------------------------------------------',
  'set "ELECTRON_ENABLE_LOGGING=1"',
  '"%~dp0Xilan Studio.exe" --enable-logging %*',
  'set "CODE=%errorlevel%"',
  'echo --------------------------------------------',
  'echo.',
  'echo [5] 退出码 = %CODE%',
  'if "%CODE%"=="0" echo     正常退出',
  'if "%CODE%"=="-2147483645" (',
  '  echo     0x80000003 STATUS_BREAKPOINT',
  '  echo     多为环境限制或渲染进程崩溃，请把上面日志发出',
  ')',
  'if "%CODE%"=="-1073741819" (',
  '  echo     0xC0000005 内存访问冲突，多见于显卡驱动',
  '  echo     试：诊断.bat --disable-gpu',
  ')',
  'echo.',
  ':end',
  'echo ============================================',
  'pause',
  '',
].join('\r\n')

for (const p of appPaths) {
  fs.writeFileSync(path.join(p, '启动.bat'), launcher, 'utf8')
  fs.writeFileSync(path.join(p, '诊断.bat'), diagnose, 'utf8')
  fs.writeFileSync(path.join(p, '使用说明.txt'), readme, 'utf8')
}

/* ---------- 浏览器版：不依赖 Electron 窗口 ---------- */

console.log('\n=== 生成浏览器版 ===')

const BROWSER_DIR = path.join(OUT, '浏览器版')
fs.rmSync(BROWSER_DIR, { recursive: true, force: true })

// 复制需要的最小运行时：node 脚本 + 核心层 + 界面
const copyPlain = (from, to) => {
  const st = fs.statSync(from)
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const n of fs.readdirSync(from)) copyPlain(path.join(from, n), path.join(to, n))
    return
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

copyPlain(path.join(ROOT, 'scripts', 'browser-launcher.mjs'), path.join(BROWSER_DIR, 'launcher.mjs'))
copyPlain(path.join(ROOT, 'scripts', 'preview-server.mjs'), path.join(BROWSER_DIR, 'preview-server.mjs'))
copyPlain(path.join(ROOT, 'src', 'core'), path.join(BROWSER_DIR, 'src', 'core'))
copyPlain(path.join(ROOT, 'src', 'ui'), path.join(BROWSER_DIR, 'src', 'ui'))

// 复制独立的 Node 运行时（Electron 的 exe 改名没用，必须用真正的 node.exe）
const NODE_CANDIDATES = [
  path.join(ROOT, '..', '.tools', 'node-v22.20.0-win-x64', 'node.exe'),
  'C:\\Program Files\\nodejs\\node.exe',
]

let nodeExe = null
for (const c of NODE_CANDIDATES) {
  if (fs.existsSync(c)) {
    nodeExe = c
    break
  }
}

if (nodeExe) {
  copyPlain(nodeExe, path.join(BROWSER_DIR, 'node.exe'))
  console.log('  已附带 Node 运行时:', nodeExe)
} else {
  console.log('  ⚠ 没找到 node.exe，浏览器版需要系统已安装 Node.js')
}

// 启动器 bat
const browserBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title Xilan Studio（浏览器版）',
  'cd /d "%~dp0"',
  '',
  'set "NODE="',
  'if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"',
  'if not defined NODE (',
  '  where node >nul 2>nul && set "NODE=node"',
  ')',
  'if not defined NODE (',
  '  echo.',
  '  echo 找不到 Node.js 运行时。',
  '  echo 请安装 Node.js（https://nodejs.org）后重试，',
  '  echo 或者使用桌面版。',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'echo 正在启动，请稍候…',
  'echo.',
  '"%NODE%" "%~dp0launcher.mjs" %*',
  'set "CODE=%errorlevel%"',
  'if not "%CODE%"=="0" (',
  '  echo.',
  '  echo 启动失败，退出码 %CODE%',
  '  pause',
  ')',
  '',
].join('\r\n')

fs.writeFileSync(path.join(BROWSER_DIR, '点击启动.bat'), browserBat, 'utf8')

fs.writeFileSync(
  path.join(BROWSER_DIR, '说明.txt'),
  [
    'Xilan Studio 浏览器版',
    '',
    '双击「点击启动.bat」即可。',
    '',
    '它会：',
    '  1. 在后台起一个本地服务（只监听 127.0.0.1，外网访问不到）',
    '  2. 自动打开你的浏览器作为界面',
    '',
    '关闭那个黑色命令行窗口 = 退出程序。',
    '',
    '和桌面版的区别：',
    '  只支持「打开本地仓库」，不支持在线登录 GitHub 和克隆。',
    '  也就是说，需要你事先把仓库 clone 到本地。',
    '',
  ].join('\r\n'),
  'utf8',
)

console.log('  输出:', BROWSER_DIR)

console.log('\n=== 打包完成 ===')
for (const p of appPaths) {
  const exe = path.join(p, 'Xilan Studio.exe')
  console.log('输出:', p)
  console.log('exe 存在:', fs.existsSync(exe))

  const size = (dir) => {
    let total = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name)
      if (e.isDirectory()) total += size(f)
      else total += fs.statSync(f).size
    }
    return total
  }
  console.log('体积:', (size(p) / 1024 / 1024).toFixed(1), 'MB')
}
