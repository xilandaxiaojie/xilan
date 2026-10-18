/**
 * 生成搜索索引，供 /search 页面在浏览器端做全文检索。
 *
 * 输出到 public/search-index.json，构建时由 scripts/sync-assets.mjs 之前生成。
 * 只包含标题、摘要、标签与正文纯文本，控制体积。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

// 复用 src/lib/content.ts 的解析逻辑需要 TS 运行时，这里保持独立实现，
// 避免为构建脚本引入额外的编译步骤。
function parseFrontmatter(source) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: text }
  const [, block, rest] = m
  const data = {}
  let key = null
  let list = null
  const flush = () => {
    if (key && list) data[key] = list
    list = null
  }
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = line.match(/^\s*-\s+(.*)$/)
    if (item && key) {
      if (!list) list = []
      list.push(item[1].replace(/^["']|["']$/g, ''))
      continue
    }
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    flush()
    const [, k, raw] = kv
    const inline = raw.match(/^\[(.*)\]$/)
    if (inline) {
      data[k] = inline[1].split(',').map((s) => s.trim()).filter(Boolean)
      key = null
      continue
    }
    if (raw.trim() === '') {
      key = k
      continue
    }
    let v = raw.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    } else if (v === 'true') v = true
    else if (v === 'false') v = false
    data[k] = v
    key = null
  }
  flush()
  return { data, body: rest }
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~`>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const readDir = (dir) => {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs)
    .filter((n) => n.endsWith('.md'))
    .map((n) => {
      const raw = fs.readFileSync(path.join(abs, n), 'utf8')
      const { data, body } = parseFrontmatter(raw)
      return { id: n.replace(/\.md$/, ''), data, body }
    })
}

const items = []

for (const p of readDir('posts')) {
  if (p.data.draft === true) continue
  items.push({
    type: 'post',
    id: p.id,
    title: String(p.data.title ?? p.id),
    description: p.data.description ? String(p.data.description) : '',
    date: String(p.data.date ?? ''),
    tags: Array.isArray(p.data.tags) ? p.data.tags : p.data.tags ? [String(p.data.tags)] : [],
    category: p.data.category ? String(p.data.category) : '',
    // 正文截断，避免索引过大
    text: stripMarkdown(p.body).slice(0, 4000),
  })
}

for (const n of readDir('notes')) {
  if (n.data.draft === true) continue
  const text = stripMarkdown(n.body)
  items.push({
    type: 'note',
    id: n.id,
    title: text.slice(0, 40),
    description: '',
    date: String(n.data.date ?? ''),
    tags: Array.isArray(n.data.tags) ? n.data.tags : [],
    category: '',
    text: text.slice(0, 4000),
  })
}

items.sort((a, b) => (a.date < b.date ? 1 : -1))

const out = { generatedAt: new Date().toISOString(), count: items.length, items }
const dest = path.join(ROOT, 'public', 'search-index.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out), 'utf8')

const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1)
console.log(`[search] 生成搜索索引 ${items.length} 条 (${kb} KB) → public/search-index.json`)
