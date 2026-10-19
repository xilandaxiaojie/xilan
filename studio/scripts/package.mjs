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

console.log('=== 清理旧产物 ===')
fs.rmSync(OUT, { recursive: true, force: true })

console.log('=== 打包中（第一次会下载 Electron，可能要几分钟）===')

const appPaths = await packager({
  dir: ROOT,
  out: OUT,
  name: 'Xilan Studio',
  platform: 'win32',
  arch: 'x64',
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
  '如果双击没反应，改用「启动.bat」：',
  '  它会清掉干扰的环境变量，并在出错时把退出码显示出来。',
  '',
  '排查步骤见项目里的 studio/启动排查.md',
  '',
].join('\r\n')

for (const p of appPaths) {
  fs.writeFileSync(path.join(p, '启动.bat'), launcher, 'utf8')
  fs.writeFileSync(path.join(p, '使用说明.txt'), readme, 'utf8')
}

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
