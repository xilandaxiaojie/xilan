/**
 * 一键跑全部测试
 *
 * 用法：node scripts/test-all.mjs
 *
 * 会自动管理预览服务器（浏览器测试需要），跑完关闭。
 */
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const SUITES = [
  ['核心层', 'test-core.mjs'],
  ['端到端', 'test-e2e.mjs'],
  ['界面一致性', 'test-ui.mjs'],
  ['IPC 层', 'test-ipc.mjs'],
  ['打包验证', 'verify-package.mjs'],
  ['浏览器界面', 'test-browser.mjs'],
]

const needsServer = new Set(['浏览器界面'])

const results = []
let servers = []

const startServer = () => {
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'preview-server.mjs'), '4322'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  })
  servers.push(proc)
  return new Promise((resolve) => setTimeout(resolve, 2500))
}

const stopServers = () => {
  for (const p of servers) {
    try {
      p.kill('SIGTERM')
    } catch {}
  }
  servers = []
}

console.log('Xilan Studio 测试\n' + '='.repeat(44))

for (const [name, file] of SUITES) {
  const filePath = path.join(ROOT, 'scripts', file)
  if (!fs.existsSync(filePath)) {
    console.log(`${name.padEnd(12)} 跳过（文件不存在）`)
    continue
  }

  if (needsServer.has(name)) {
    await startServer()
  }

  const r = spawnSync(process.execPath, [filePath], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
  })

  const out = (r.stdout || '') + (r.stderr || '')
  const summary = out.match(/通过 \d+ 项，失败 \d+ 项/)
  const failedLine = out.match(/有 \d+ 项失败/)
  const okLine = out.match(/全部通过/)

  const status = summary
    ? summary[0]
    : failedLine
      ? failedLine[0]
      : okLine
        ? '全部通过'
        : r.status === 0
          ? '完成'
          : '异常退出'

  const passed = r.status === 0
  results.push({ name, passed, status })
  console.log(`${passed ? '✓' : '✗'} ${name.padEnd(12)} ${status}`)

  if (!passed) {
    // 输出失败详情
    const detail = out
      .split('\n')
      .filter((l) => l.includes('✗') || l.includes('Error'))
      .slice(0, 6)
      .join('\n')
    if (detail) console.log(`${detail}\n`)
  }

  if (needsServer.has(name)) stopServers()
}

stopServers()

const failedCount = results.filter((r) => !r.passed).length
console.log('\n' + '='.repeat(44))
console.log(`${results.length} 个测试集，${results.length - failedCount} 通过，${failedCount} 失败`)

process.exitCode = failedCount > 0 ? 1 : 0
