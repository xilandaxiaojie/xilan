/**
 * 无窗口验证：检查界面资源完整性 + DOM 结构与 JS 引用的对应关系
 *
 * 不需要启动 Electron 图形界面。
 */
import fs from 'node:fs'
import path from 'node:path'

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

const uiDir = path.join(process.cwd(), 'src', 'ui')
const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')
const js = fs.readFileSync(path.join(uiDir, 'app.js'), 'utf8')
const css = fs.readFileSync(path.join(uiDir, 'styles.css'), 'utf8')

console.log('=== 文件完整性 ===')
for (const f of ['index.html', 'app.js', 'styles.css']) {
  ok(fs.existsSync(path.join(uiDir, f)), f)
}

console.log('\n=== HTML 引用 ===')
ok(html.includes('./styles.css'), '引用样式表')
ok(html.includes('./app.js'), '引用脚本')
ok(/type="module"/.test(html), '脚本为 module')
ok(/Content-Security-Policy/.test(html), '设置了 CSP')

console.log('\n=== JS 里用到的 DOM id 是否存在 ===')

// 收集 app.js 里 $('#xxx') 的 id
const ids = [...js.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1])
const uniqueIds = [...new Set(ids)]

const missing = []
for (const id of uniqueIds) {
  // 可能是动态创建的元素，这里只检查静态 HTML 中该有的
  const inHtml = html.includes(`id="${id}"`)
  if (!inHtml) missing.push(id)
}

ok(uniqueIds.length > 30, `共引用 ${uniqueIds.length} 个元素`)
if (missing.length) {
  console.log(`     未在 HTML 中找到: ${missing.join(', ')}`)
}
ok(missing.length === 0, '所有引用的 id 都存在于 HTML')

console.log('\n=== 关键界面元素 ===')
const requiredIds = [
  'screen-welcome',
  'screen-app',
  'token-input',
  'btn-login',
  'repo-select',
  'btn-clone',
  'btn-open-dir',
  'entry-list',
  'md-input',
  'preview',
  'field-title',
  'field-date',
  'tag-input',
  'field-cover',
  'field-pinned',
  'btn-publish',
  'modal-diff',
  'diff-view',
  'btn-confirm-publish',
  'image-grid',
  'changes-panel',
]
for (const id of requiredIds) {
  ok(html.includes(`id="${id}"`), id)
}

console.log('\n=== 样式覆盖 ===')
const classUsage = [...js.matchAll(/class="([\w -]+)"/g)]
  .flatMap((m) => m[1].split(/\s+/))
  .filter(Boolean)
const uniqueClasses = [...new Set(classUsage)]
const missingCss = uniqueClasses.filter((c) => !css.includes(`.${c}`))
ok(missingCss.length <= 3, `JS 生成的类基本都有样式`, missingCss.join(', ') || '无缺失')

console.log('\n=== preload API 与界面调用一致性 ===')
const preload = fs.readFileSync(
  path.join(process.cwd(), 'electron', 'preload.cjs'),
  'utf8',
)

// 界面里 window.api.x.y 的调用
const apiCalls = [...js.matchAll(/window\.api\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`)
const uniqueApi = [...new Set(apiCalls)]

const missingApi = []
for (const call of uniqueApi) {
  const [ns, method] = call.split('.')
  // preload 里形如 ns: { method: ... }
  const nsBlock = preload.split(`${ns}: {`)[1]
  if (!nsBlock || !nsBlock.includes(`${method}:`)) missingApi.push(call)
}

ok(uniqueApi.length > 15, `界面调用了 ${uniqueApi.length} 个 API`)
if (missingApi.length) console.log(`     缺失: ${missingApi.join(', ')}`)
ok(missingApi.length === 0, '所有调用的 API 都已在 preload 暴露')

console.log('\n=== 主进程 handler 覆盖 ===')
const main = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.cjs'), 'utf8')
const handlers = [...main.matchAll(/handle\('([\w:]+)'/g)].map((m) => m[1])
const channels = [...preload.matchAll(/invoke\('([\w:]+)'/g)].map((m) => m[1])
const missingHandler = channels.filter((c) => !handlers.includes(c))
ok(handlers.length > 20, `主进程注册了 ${handlers.length} 个 handler`)
if (missingHandler.length) console.log(`     无对应 handler: ${missingHandler.join(', ')}`)
ok(missingHandler.length === 0, 'preload 的每个 invoke 都有 handler')

console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exitCode = fail > 0 ? 1 : 0
