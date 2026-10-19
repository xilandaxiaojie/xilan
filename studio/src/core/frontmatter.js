/**
 * Frontmatter 解析与序列化
 *
 * 刻意不用第三方 YAML 库：博客文章的 frontmatter 结构很简单，
 * 自己实现可以精确控制「读写后格式不变」，避免编辑器把用户文件改乱。
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** 把 YAML 值解析成 JS 值（只覆盖博客用得到的子集） */
function parseValue(raw) {
  const v = raw.trim()
  if (v === '') return ''

  // 引号字符串，保持原样
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }

  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null' || v === '~') return null

  // 行内数组 [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((s) => parseValue(s))
  }

  return v
}

/** 解析 markdown 文本，返回 { data, body, raw } */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '')
  const m = normalized.match(FM_RE)

  if (!m) {
    return { data: {}, body: normalized, raw: '', hasFrontmatter: false }
  }

  const rawBlock = m[1]
  const body = normalized.slice(m[0].length)
  const data = {}

  const lines = rawBlock.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 跳过空行与注释
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) {
      i++
      continue
    }

    const key = kv[1]
    const rest = kv[2]

    // 情况一：`tags:` 换行后跟 `- 项`
    // 情况二：`tags: - 项` 首项与 key 同行，后续行继续跟 `- 项`
    const inlineItem = rest.match(/^-\s+(.*)$/)
    if (rest.trim() === '' || inlineItem) {
      const items = []
      if (inlineItem) items.push(parseValue(inlineItem[1]))

      let j = i + 1
      while (j < lines.length) {
        const sub = lines[j]
        const li = sub.match(/^\s*-\s+(.*)$/)
        if (li) {
          items.push(parseValue(li[1]))
          j++
        } else if (!sub.trim()) {
          j++
        } else {
          break
        }
      }

      data[key] = items.length > 0 ? items : ''
      i = j
      continue
    }

    data[key] = parseValue(rest)
    i++
  }

  return { data, body, raw: rawBlock, hasFrontmatter: true }
}

/** 值的序列化：返回行数组（数组值是多行），null 表示跳过该字段 */
function serializeValue(key, value) {
  if (value === null || value === undefined || value === '') return null

  if (Array.isArray(value)) {
    const items = value
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter(Boolean)
    if (items.length === 0) return null
    // 列表式，一行一个，缩进两格，符合 Obsidian 的偏好
    // 列表式：首项跟在 key 冒号后，后续项另起一行，统一缩进两格
    return items.map((it) => formatScalar(it))
  }

  return [formatScalar(value)]
}

function formatScalar(v) {
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') return String(v)
  const s = String(v)
  // 只有真正会破坏 YAML 结构的字符才加引号。
  // 注意不要匹配日期里的 '-'，否则 2025-10-08 会被错误地加上引号。
  if (
    /^[\s]|[\s]$/.test(s) || // 首尾空白
    /[:#{}[\],&*?|>'"%@`]/.test(s) || // YAML 特殊字符
    /^(true|false|null|~|\d+|\d+\.\d+)$/.test(s) || // 会被误读成布尔/数字
    /^-/.test(s) // 以 - 开头会被当成列表项
  ) {
    return JSON.stringify(s)
  }
  return s
}

/** 字段写出顺序，保证新文件结构一致 */
const KEY_ORDER = [
  'title',
  'description',
  'date',
  'updated',
  'tags',
  'category',
  'cover',
  'pinned',
  'draft',
]

/** 把 data 对象序列化成 frontmatter 字符串（不含 --- 分隔符） */
export function stringifyFrontmatter(data) {
  const keys = [
    ...KEY_ORDER.filter((k) => k in data),
    ...Object.keys(data).filter((k) => !KEY_ORDER.includes(k)),
  ]

  const out = []
  for (const key of keys) {
    const lines = serializeValue(key, data[key])
    if (lines === null) continue

    if (lines.length === 1) {
      // 标量：key: value
      out.push(`${key}: ${lines[0]}`)
    } else {
      // 数组：首项跟在 key 后，其余项缩进两格另起一行
      out.push(`${key}:`)
      for (const item of lines) out.push(`  - ${item}`)
    }
  }
  return out.join('\n')
}

/** 把 data + body 组合成完整 markdown 文本 */
export function buildMarkdown(data, body) {
  const fm = stringifyFrontmatter(data)
  const trimmedBody = body.replace(/^\s*\n/, '').replace(/\s+$/, '')
  if (!fm) return trimmedBody + '\n'
  return `---\n${fm}\n---\n\n${trimmedBody}\n`
}

/* ---------------- 日期处理 ---------------- */

/** 把各种写法的日期规范成 YYYY-MM-DD 或 YYYY-MM-DD HH:mm */
export function normalizeDate(input) {
  if (!input) return ''
  if (input instanceof Date) {
    return fmtDate(input)
  }
  const s = String(input).trim()

  // 已经是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // YYYY-MM-DD HH:mm 或带 T
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`

  // YYYY/MM/DD
  const m2 = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m2) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${m2[1]}-${pad(m2[2])}-${pad(m2[3])}`
  }

  return s
}

function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今天，YYYY-MM-DD */
export function today() {
  return fmtDate(new Date())
}

/** 解析成 Date 用于排序 */
export function toDate(input) {
  const s = normalizeDate(input)
  if (!s) return new Date(0)
  const d = new Date(s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}

/** 标题转 slug（保留中文） */
export function slugify(title) {
  const cleaned = String(title)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || 'untitled'
}
