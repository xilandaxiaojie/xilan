// 构建后校验封面渲染结果
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASE = 'http://localhost:4321'

let failed = 0
const ok = (cond, label, extra = '') => {
  if (!cond) failed++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
}

console.log('=== 指定了 cover 的文章 ===')
{
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'posts', '__t_valid', 'index.html'), 'utf8')
  const m = html.match(/article__cover[^>]*>\s*<img src="([^"]+)"/)
  const got = m?.[1]
  ok(got === '/xilan/assets/custom-bg.svg', '指定路径生效', got)
  const res = await fetch(BASE + got).catch(() => null)
  ok(res?.ok, '  └ 可访问', String(res?.status))
}

console.log('\n=== 未指定 cover 的文章 ===')
{
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'posts', 'hello-world', 'index.html'), 'utf8')
  const m = html.match(/article__cover[^>]*>\s*<img src="([^"]+)"/)
  const got = m?.[1]
  ok(/^\/xilan\/covers\//.test(got ?? ''), '从 covers/ 取封面', got)
  const res = await fetch(BASE + got).catch(() => null)
  ok(res?.ok, '  └ 可访问', String(res?.status))
}

console.log('\n=== covers/ 随机分配不重复 ===')
{
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'posts', 'index.html'), 'utf8')
  const imgs = [...html.matchAll(/<img src="(\/xilan\/covers\/[^"]+)"/g)].map((m) => m[1])
  console.log(`     共 ${imgs.length} 张: ${imgs.map((s) => s.split('/').pop()).join(', ')}`)
  const names = imgs.map((s) => s.split('/').pop())
  const uniq = new Set(names)
  ok(uniq.size === names.length, '互不重复', `${uniq.size}/${names.length}`)
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}`)
process.exitCode = failed > 0 ? 1 : 0
