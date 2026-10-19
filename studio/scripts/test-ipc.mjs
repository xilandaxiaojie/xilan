/**
 * IPC 层测试：不启动 Electron，直接验证主进程 handler 的行为
 *
 * 做法：模拟 electron 模块，require 主进程文件，捕获注册的 handler，
 * 然后直接调用它们，验证真实行为。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

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

/* ---------- 准备测试仓库 ---------- */
const root = path.join(process.cwd(), '.tmp-ipc')
fs.rmSync(root, { recursive: true, force: true })
const repoDir = path.join(root, 'blog')
fs.mkdirSync(path.join(repoDir, 'posts'), { recursive: true })
fs.mkdirSync(path.join(repoDir, 'notes'), { recursive: true })
fs.mkdirSync(path.join(repoDir, 'covers'), { recursive: true })
fs.writeFileSync(
  path.join(repoDir, 'posts', 'demo.md'),
  `---
title: 演示文章
date: 2025-10-01
tags:
  - 测试
---

正文内容`,
)
fs.writeFileSync(path.join(repoDir, 'covers', 'c1.svg'), '<svg/>')

const { execFileSync } = require('node:child_process')
execFileSync('git', ['init', '-q'], { cwd: repoDir })
execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoDir })
execFileSync('git', ['config', 'user.name', 'T'], { cwd: repoDir })

/* ---------- 模拟 electron ---------- */

const handlers = new Map()
const userData = path.join(root, 'userdata')
fs.mkdirSync(userData, { recursive: true })

const electronMock = {
  app: {
    getPath: () => userData,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = { setWindowOpenHandler: () => {} }
    }
    loadFile() {}
    once() {}
    on() {}
    show() {}
    static getAllWindows() {
      return []
    }
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
  },
  dialog: {
    showOpenDialog: async () => {
      throw new Error('测试环境不弹窗')
    },
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
  },
}

// 拦截 require('electron')
const Module = require('node:module')
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock
  return origLoad.call(this, request, parent, isMain)
}

// 加载主进程，触发 handler 注册
require('../electron/main.cjs')

ok(handlers.size > 20, `注册了 ${handlers.size} 个 IPC handler`)

/* ---------- 调用辅助 ---------- */
const call = async (channel, ...args) => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`无 handler: ${channel}`)
  return fn({}, ...args)
}

/* ---------- 配置 ---------- */

console.log('\n=== 配置读写 ===')

{
  const res = await call('config:get')
  ok(res.ok, 'config:get 成功')
  ok(res.data.hasToken === false, '初始无 token')
}

{
  const res = await call('config:set', { repoPath: repoDir })
  ok(res.ok, 'config:set 成功')
}

{
  const res = await call('config:get')
  ok(res.data.repoPath === repoDir, '仓库路径已保存')
}

/* ---------- 仓库 ---------- */

console.log('\n=== 仓库概览 ===')

{
  const res = await call('repo:overview')
  ok(res.ok, 'repo:overview 成功')
  ok(res.data.entries.posts.length === 1, '读取到 1 篇文章')
  ok(res.data.entries.posts[0].title === '演示文章', '标题正确')
  ok(res.data.tags.length === 1, '标签汇总正确')
  ok(res.data.covers.length === 1, '封面列表正确')
  ok(res.data.status !== undefined, '包含 git 状态')
}

{
  const res = await call('repo:use', root) // 无效目录
  ok(!res.ok, '无效仓库被拒绝')
  ok(res.error.includes('博客仓库'), '错误信息清晰', res.error.slice(0, 40))
}

/* ---------- 文章 CRUD ---------- */

console.log('\n=== 文章读写 ===')

{
  const res = await call('post:read', 'demo', 'post')
  ok(res.ok, 'post:read 成功')
  ok(res.data.data.title === '演示文章', '字段正确')
  ok(res.data.body.includes('正文内容'), '正文正确')
}

{
  const res = await call('post:create', { title: 'IPC 测试文章', kind: 'post' })
  ok(res.ok, 'post:create 成功')
  ok(res.data.id === 'ipc-测试文章' || res.data.id.length > 0, '返回新 id', res.data.id)
}

{
  const res = await call('post:save', {
    id: 'demo',
    kind: 'post',
    data: { title: '演示文章（已改）', date: '2025-10-01', tags: ['测试', '新标签'] },
    body: '修改后的正文',
  })
  ok(res.ok, 'post:save 成功')

  const check = await call('post:read', 'demo', 'post')
  ok(check.data.data.title === '演示文章（已改）', '修改已生效')
  ok(check.data.data.tags.includes('新标签'), '标签已更新')
}

/* ---------- 图片 ---------- */

console.log('\n=== 图片 ===')

{
  const png = Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  )
  const res = await call('image:save', { id: 'demo', kind: 'post', name: 'shot.png', data: png })
  ok(res.ok, 'image:save 成功')
  ok(res.data.webPath === 'posts/demo/images/shot.png', '路径规则正确', res.data.webPath)
  ok(fs.existsSync(res.data.absPath), '文件已落盘')
}

{
  const res = await call('image:list', 'demo', 'post')
  ok(res.ok, 'image:list 成功')
  ok(res.data.length === 1, '列出 1 张图')
}

{
  const res = await call('image:dataUrl', path.join(repoDir, 'covers', 'c1.svg'))
  ok(res.ok, 'image:dataUrl 成功')
  ok(res.data.startsWith('data:image/svg+xml;base64,'), '生成正确的 data URL')
}

/* ---------- markdown ---------- */

console.log('\n=== markdown 渲染 ===')

{
  const res = await call('md:render', '# 标题\n\n**粗体**')
  ok(res.ok, 'md:render 成功')
  ok(res.data.html.includes('<h1'), '渲染标题')
  ok(res.data.html.includes('<strong>'), '渲染粗体')
  ok(res.data.headings.length === 1, '提取大纲')
}

/* ---------- git ---------- */

console.log('\n=== git 操作 ===')

{
  const res = await call('git:status')
  ok(res.ok, 'git:status 成功')
  ok(res.data.dirty === true, '有未提交改动')
  ok(res.data.files.length > 0, `${res.data.files.length} 个文件`)
}

{
  const res = await call('git:diff')
  ok(res.ok, 'git:diff 成功')
  ok(res.data.includes('演示文章'), 'diff 包含改动内容')
}

{
  const res = await call('git:commit', { message: '测试提交' })
  ok(res.ok, 'git:commit 成功')
  ok(res.data.ok === true, '提交成功')
}

{
  const res = await call('git:log', 3)
  ok(res.ok, 'git:log 成功')
  ok(res.data[0].subject === '测试提交', '提交记录正确')
}

{
  const res = await call('git:status')
  ok(res.data.dirty === false, '提交后干净')
}

/* ---------- 错误处理 ---------- */

console.log('\n=== 错误处理 ===')

{
  const res = await call('post:read', '不存在的文章', 'post')
  ok(!res.ok, '读取不存在文章返回错误')
  ok(typeof res.error === 'string', '错误为字符串')
}

{
  const res = await call('image:dataUrl', path.join(root, 'nope.png'))
  ok(!res.ok, '读取不存在图片返回错误')
}

{
  const res = await call('git:push') // 没有远端
  ok(!res.ok, '无远端时 push 返回错误而非崩溃')
  console.log(`     错误: ${res.error.split('\n')[0].slice(0, 60)}`)
}

/* ---------- 删除 ---------- */

console.log('\n=== 删除 ===')

{
  const res = await call('post:delete', 'demo', 'post')
  ok(res.ok, 'post:delete 成功')
  ok(!fs.existsSync(path.join(repoDir, 'posts', 'demo.md')), '文件已删除')
}

console.log(`\n${'='.repeat(44)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)

// 恢复 require
Module._load = origLoad
process.exitCode = fail > 0 ? 1 : 0
