/**
 * 无需 GUI 的完整功能验证
 *
 * 目的：既然当前环境无法启动 Electron 图形界面，
 * 就在 Electron 自带的 Node 运行时里跑完所有业务逻辑，
 * 证明程序的功能部分确实可用。
 *
 * 运行方式：用打包后的 exe 以 ELECTRON_RUN_AS_NODE 模式执行本文件
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const APP = 'D:\\DSH\\博客\\studio\\release\\Xilan Studio-win32-x64\\resources\\app.asar'

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

console.log('Electron Node 版本:', process.versions.node)
console.log('Electron 版本:', process.versions.electron)
console.log()

// 从 asar 里加载模块需要 asar 支持（Electron 内置）
const repo = await import('file:///' + path.join(APP, 'src/core/repo.js').replace(/\\/g, '/'))
const fm = await import('file:///' + path.join(APP, 'src/core/frontmatter.js').replace(/\\/g, '/'))
const md = await import('file:///' + path.join(APP, 'src/core/markdown.js').replace(/\\/g, '/'))

console.log('=== 从 asar 加载核心模块 ===')
ok(typeof repo.saveEntry === 'function', 'repo 模块加载成功')
ok(typeof fm.parseFrontmatter === 'function', 'frontmatter 模块加载成功')
ok(typeof md.renderMarkdown === 'function', 'markdown 模块加载成功')

console.log('\n=== 实际读写测试 ===')
const tmp = path.join(process.cwd(), '.tmp-asar-test')
fs.rmSync(tmp, { recursive: true, force: true })
for (const d of ['posts', 'notes', 'covers']) {
  fs.mkdirSync(path.join(tmp, d), { recursive: true })
}

const id = repo.createEntry(tmp, { title: '打包产物测试', date: '2025-12-01' })
ok(id.length > 0, '创建文章', id)

repo.saveEntry(tmp, {
  id,
  kind: 'post',
  data: { title: '打包产物测试', date: '2025-12-01', tags: ['测试', '打包'], pinned: true },
  body: '# 标题\n\n**粗体**内容',
})

const readBack = repo.readEntry(tmp, id)
ok(readBack.data.title === '打包产物测试', '读回标题正确')
ok(readBack.data.pinned === true, '读回置顶标记')
ok(JSON.stringify(readBack.data.tags) === '["测试","打包"]', '读回标签正确')

const raw = fs.readFileSync(path.join(tmp, 'posts', `${id}.md`), 'utf8')
ok(/tags:\n {2}- 测试\n {2}- 打包/.test(raw), 'frontmatter 格式标准')
console.log('\n--- 生成的文件 ---')
console.log(raw)
console.log('---\n')

const html = md.renderMarkdown(readBack.body)
ok(html.includes('<h1'), 'Markdown 渲染标题')
ok(html.includes('<strong>'), 'Markdown 渲染粗体')

fs.rmSync(tmp, { recursive: true, force: true })

console.log('='.repeat(44))
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exitCode = fail > 0 ? 1 : 0
