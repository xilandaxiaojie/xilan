/**
 * 端到端流程测试：模拟真实使用场景
 *
 * 不使用 Electron，直接测试核心层组合起来的表现：
 * 新建文章 → 写内容 → 传图片 → 校验文件 → 提交 → 修改 → 再提交
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  createEntry,
  readEntry,
  saveEntry,
  listEntries,
  saveImage,
  listArticleImages,
  deleteEntry,
  renameEntry,
  collectTags,
} from '../src/core/repo.js'
import * as git from '../src/core/git.js'
import { renderMarkdown } from '../src/core/markdown.js'
import { parseFrontmatter } from '../src/core/frontmatter.js'

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

const root = path.join(process.cwd(), '.tmp-e2e')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(path.join(root, 'posts'), { recursive: true })
fs.mkdirSync(path.join(root, 'notes'), { recursive: true })
fs.mkdirSync(path.join(root, 'covers'), { recursive: true })

const g = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

g('init', '-q')
g('config', 'user.email', 'test@example.com')
g('config', 'user.name', 'Test')

// 放一张封面
fs.writeFileSync(
  path.join(root, 'covers', 'sakura.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>',
)

/* ============ 场景 1：写一篇新文章 ============ */
console.log('=== 场景 1：从零写一篇新文章 ===')

const id = createEntry(root, { title: '我的第一篇博客', date: '2025-11-20' })
ok(id === '我的第一篇博客', '创建文章，id 保留中文', id)

const body = `# 开始写博客

这是一段**正文**，带 \`行内代码\`。

## 代码示例

\`\`\`js
const hello = 'world'
console.log(hello)
\`\`\`

- 列表项一
- 列表项二

> 一句引用

| 列 | 值 |
|---|---|
| a | 1 |
`

saveEntry(root, {
  id,
  kind: 'post',
  data: {
    title: '我的第一篇博客',
    description: '记录建站过程',
    date: '2025-11-20',
    tags: ['随笔', '建站'],
    category: '日常',
    pinned: true,
  },
  body,
})

const saved = readEntry(root, id)
ok(saved.data.title === '我的第一篇博客', '标题已写入')
ok(JSON.stringify(saved.data.tags) === '["随笔","建站"]', '标签已写入', JSON.stringify(saved.data.tags))
ok(saved.data.category === '日常', '分类已写入')
ok(saved.data.pinned === true, '置顶已写入')
ok(saved.body.includes('const hello'), '正文已写入')

// 检查文件实际内容格式
const rawText = fs.readFileSync(path.join(root, 'posts', `${id}.md`), 'utf8')
console.log('\n--- 生成的文件 ---')
console.log(rawText.split('\n').slice(0, 12).join('\n'))
console.log('---\n')

ok(rawText.startsWith('---\n'), '文件以 frontmatter 开头')
ok(/title: 我的第一篇博客/.test(rawText), '标题无需引号')
ok(/date: 2025-11-20/.test(rawText), '日期未加引号')
ok(/\n  - 随笔\n/.test(rawText), '标签为缩进列表格式')
ok(rawText.includes('pinned: true'), '布尔值正确')

/* ============ 场景 2：上传图片 ============ */
console.log('=== 场景 2：上传图片 ===')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const img1 = saveImage(root, id, 'post', 'screenshot.png', png)
ok(img1.webPath === `posts/${id}/images/screenshot.png`, '图片路径正确', img1.webPath)

const img1Abs = path.join(root, img1.webPath)
ok(fs.existsSync(img1Abs), '图片文件已落盘')

// 再传一张同名的
const img2 = saveImage(root, id, 'post', 'screenshot.png', png)
ok(img2.name === 'screenshot-2.png', '同名图片自动重命名', img2.name)

const imgList = listArticleImages(root, id, 'post')
ok(imgList.length === 2, '能列出文章图片', `${imgList.length} 张`)

// 把图片插入正文
const bodyWithImg = body + `\n![截图](posts/${id}/images/screenshot.png)\n`
saveEntry(root, {
  id,
  kind: 'post',
  data: saved.data,
  body: bodyWithImg,
})

const afterImg = readEntry(root, id)
ok(afterImg.body.includes('![截图](posts/'), '图片已插入正文')

/* ============ 场景 3：渲染预览 ============ */
console.log('=== 场景 3：渲染预览 ===')

const html = renderMarkdown(afterImg.body)
ok(html.includes('<h1'), '标题渲染')
ok(html.includes('<strong>正文</strong>'), '粗体渲染')
ok(html.includes('md-code'), '代码块渲染')
ok(html.includes('tok-kw'), '代码高亮')
ok(html.includes('<table>'), '表格渲染')
ok(html.includes('<blockquote>'), '引用渲染')
ok(html.includes(`<img src="posts/${id}/images/screenshot.png"`), '图片渲染')

/* ============ 场景 4：提交 ============ */
console.log('=== 场景 4：提交到 git ===')

const st1 = git.status(root)
ok(st1.dirty === true, '有未提交改动', `${st1.files.length} 个文件`)
ok(
  st1.files.some((f) => f.path === `posts/${id}.md`),
  '文章出现在变更列表',
)

const diff = git.fullDiff(root)
ok(diff.includes('+title: 我的第一篇博客'), 'diff 包含新增内容')
ok(diff.includes(`posts/${id}/images/screenshot.png`) || diff.includes('Binary'), 'diff 包含图片')

const c1 = git.commit(root, `新增文章：${id}`)
ok(c1.ok === true, '提交成功')

const st2 = git.status(root)
ok(st2.dirty === false, '提交后工作区干净')

const logs = git.log(root, 5)
ok(logs[0].subject === `新增文章：${id}`, '提交记录正确')

/* ============ 场景 5：修改文章 ============ */
console.log('=== 场景 5：修改文章 ===')

const cur = readEntry(root, id)
cur.data.tags = [...cur.data.tags, '新标签']
cur.data.description = '改过的摘要'
saveEntry(root, { id, kind: 'post', data: cur.data, body: cur.body + '\n追加一行。\n' })

const st3 = git.status(root)
ok(st3.dirty === true, '修改后出现变更')

const diff2 = git.fileDiff(root, `posts/${id}.md`)
ok(diff2.includes('+') && diff2.includes('描述') === false, 'diff 可读取')
ok(diff2.includes('新标签'), 'diff 包含新标签')

const c2 = git.commit(root, '更新文章')
ok(c2.ok === true, '第二次提交成功')

/* ============ 场景 6：标签统计 ============ */
console.log('=== 场景 6：标签统计 ===')

const nextId = createEntry(root, { title: '第二篇', date: '2025-11-21' })
saveEntry(root, {
  id: nextId,
  kind: 'post',
  data: { title: '第二篇', date: '2025-11-21', tags: ['随笔', '教程'] },
  body: '内容',
})

const tags = collectTags(root)
const tagNames = tags.map((t) => t.name)
ok(tagNames.includes('随笔'), '标签汇总包含随笔')
const suibi = tags.find((t) => t.name === '随笔')
ok(suibi.count === 2, '随笔计数为 2', String(suibi.count))

/* ============ 场景 7：手记 ============ */
console.log('=== 场景 7：手记 ===')

const noteId = createEntry(root, { kind: 'note', date: '2025-11-22' })
saveEntry(root, {
  id: noteId,
  kind: 'note',
  data: { date: '2025-11-22', tags: ['日常'] },
  body: '今天天气很好，出门散步了。',
})

const note = readEntry(root, noteId, 'note')
ok(note.body.includes('天气很好'), '手记内容已写入')

const noteRaw = fs.readFileSync(path.join(root, 'notes', `${noteId}.md`), 'utf8')
ok(!/title:/.test(noteRaw), '手记不含 title 字段')
ok(/date: 2025-11-22/.test(noteRaw), '手记含日期')

const { posts, notes } = listEntries(root)
ok(posts.length === 2, '文章列表 2 篇', String(posts.length))
ok(notes.length === 1, '手记列表 1 条', String(notes.length))

/* ============ 场景 8：重命名与删除 ============ */
console.log('=== 场景 8：重命名与删除 ===')

renameEntry(root, nextId, 'renamed-post', 'post')
ok(fs.existsSync(path.join(root, 'posts', 'renamed-post.md')), '重命名后文件存在')
ok(!fs.existsSync(path.join(root, 'posts', `${nextId}.md`)), '旧文件已消失')

// 重命名带图片的文章，图片目录应一起移动
renameEntry(root, id, 'moved-post', 'post')
ok(
  fs.existsSync(path.join(root, 'posts', 'moved-post', 'images', 'screenshot.png')),
  '图片目录随文章一起重命名',
)

deleteEntry(root, 'renamed-post', 'post')
ok(!fs.existsSync(path.join(root, 'posts', 'renamed-post.md')), '删除成功')

/* ============ 场景 9：推送状态（无远端时不应崩溃） ============ */
console.log('=== 场景 9：无远端仓库的容错 ===')

const stNoRemote = git.status(root)
ok(stNoRemote.files !== undefined, '无远端时仍能读取状态')
ok(stNoRemote.ahead === 0 && stNoRemote.behind === 0, '无远端时 ahead/behind 为 0')

let pushErr = null
try {
  git.push(root)
} catch (e) {
  pushErr = e.message
}
ok(pushErr !== null, '无远端时 push 抛错（不静默失败）')
console.log(`    错误信息: ${String(pushErr).slice(0, 80)}`)

/* ============ 结果 ============ */
console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
console.log(`测试仓库位置: ${root}`)
process.exitCode = fail > 0 ? 1 : 0
