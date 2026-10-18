/**
 * 加载层：直接从仓库表层目录读取 Markdown 与图片。
 *
 * 目录约定（都在仓库根目录）：
 *   posts/     博客文章  *.md
 *   notes/     手记      *.md
 *   images/    文章中用到的图片（Markdown 里写 /images/xxx.png）
 *   covers/    封面图，文章未指定 cover 时从中随机挑选
 *
 * 这样做的好处：用 Obsidian 把「仓库根目录」当作 vault 打开即可写作，
 * 图片与文章在同一个 vault 里，拖拽插图就能用。
 */
import fs from 'node:fs'
import path from 'node:path'

export const ROOT = process.cwd()
export const POSTS_DIR = path.join(ROOT, 'posts')
export const NOTES_DIR = path.join(ROOT, 'notes')
export const IMAGES_DIR = path.join(ROOT, 'images')
export const COVERS_DIR = path.join(ROOT, 'covers')
/** Astro 实际服务的静态目录，封面存在性检查以它为准 */
export const PUBLIC_DIR = path.join(ROOT, 'public')

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'])

export interface PostMeta {
  /** 文件名（不含扩展名），用作 URL 路径 */
  id: string
  title: string
  description?: string
  date: Date
  updated?: Date
  tags: string[]
  category?: string
  cover?: string
  draft: boolean
  pinned: boolean
  /** 原始 Markdown 正文（已去掉 frontmatter） */
  body: string
  /** 文件相对路径，便于报错定位 */
  file: string
}

export interface NoteMeta {
  id: string
  date: Date
  tags: string[]
  draft: boolean
  body: string
  file: string
}

/* ------------------------------------------------------------------ */
/* Frontmatter 解析                                                     */
/* ------------------------------------------------------------------ */

/**
 * 极简 YAML frontmatter 解析器。
 * 只支持本站需要的类型：字符串、数字、布尔、日期、字符串数组。
 * 这样不引入额外依赖，行为可预期。
 */
function parseScalar(raw: string): unknown {
  let v = raw.trim()

  // 去掉成对引号
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  if (v === '' || v === '~' || v === 'null') return undefined
  if (v === 'true') return true
  if (v === 'false') return false
  // 纯数字（排除日期与以 0 开头的串）
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) return Number(v)
  return v
}

export function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  // 统一换行符，兼容 CRLF
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: text }

  const [, block, rest] = m
  const data: Record<string, unknown> = {}
  const lines = block.split('\n')

  let currentKey: string | null = null
  let listBuffer: string[] | null = null

  const flushList = () => {
    if (currentKey && listBuffer) data[currentKey] = listBuffer
    listBuffer = null
  }

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    // 数组项：  - value   或   - "value"
    const itemMatch = line.match(/^\s*-\s+(.*)$/)
    if (itemMatch && currentKey) {
      if (!listBuffer) listBuffer = []
      listBuffer.push(String(parseScalar(itemMatch[1]) ?? ''))
      continue
    }

    // 键值对
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue

    flushList()
    const key = kv[1]
    const rawVal = kv[2]

    // 行内数组：tags: [a, b]
    const inlineArr = rawVal.match(/^\[(.*)\]$/)
    if (inlineArr) {
      data[key] = inlineArr[1]
        .split(',')
        .map((s) => String(parseScalar(s) ?? '').trim())
        .filter(Boolean)
      currentKey = null
      continue
    }

    if (rawVal.trim() === '') {
      // 后面可能跟数组，先记下 key
      currentKey = key
      continue
    }

    const val = parseScalar(rawVal)
    if (val !== undefined) data[key] = val
    currentKey = null
  }
  flushList()

  return { data, body: rest }
}

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined
  if (v instanceof Date) return v
  // 支持 2025-08-12 与 2025-08-12 10:30 两种写法
  const s = String(v).trim().replace(' ', 'T')
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

/* ------------------------------------------------------------------ */
/* 图片与封面                                                           */
/* ------------------------------------------------------------------ */

export function listImages(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()))
    .sort()
}

/** 已有封面库 */
export const coverFiles = () => listImages(COVERS_DIR)

/**
 * 解析 frontmatter 里的 cover 字段。
 *
 * 规则很简单：**写了路径就用路径**，文件不存在就退回 covers/ 的随机封面。
 *
 *   cover: images/photo.jpg       → /images/photo.jpg          （相对仓库根）
 *   cover: posts/cover.png        → /posts/cover.png
 *   cover: assets/bg.webp         → /assets/bg.webp
 *   cover: /images/photo.jpg      → /images/photo.jpg          （站点绝对路径）
 *   cover: https://example.com/a  → 原样使用                    （外链，不检查存在性）
 *
 * 没写、或写了但文件不存在 → 返回 undefined，交给 assignCovers 从 covers/ 随机取。
 * 纯文件名（不带 "/"）会被当作 covers/ 里的图，不存在同样退回随机。
 */
export function resolveCoverPath(raw?: string): string | undefined {
  if (!raw) return undefined
  const v = raw.trim()
  if (!v) return undefined

  // 外链 / data URI：不检查本地文件
  if (/^(https?:)?\/\//.test(v) || v.startsWith('data:')) return v

  // 归一化成站点路径
  let url: string
  if (v.startsWith('/')) {
    url = v
  } else {
    // ./x.png → /x.png；images/x.png → /images/x.png；x.png → /covers/x.png
    const cleaned = v.replace(/^\.\//, '').replace(/^\/+/, '')
    url = cleaned.includes('/') ? `/${cleaned}` : `/covers/${cleaned}`
  }

  // 检查本地文件是否真的存在；不存在就退回随机封面
  const rel = decodeURIComponent(url).replace(/^\//, '')
  const abs = path.join(PUBLIC_DIR, rel)
  if (!fs.existsSync(abs)) {
    console.warn(
      `[content] cover 找不到: ${v}（解析为 ${url}），改用 covers/ 随机封面`,
    )
    return undefined
  }

  return url
}

/** 拼站点路径，处理 ../ 与多余斜杠 */
function joinUrl(base: string, rel: string): string {
  const parts = base.split('/').filter(Boolean)
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

/**
 * 从字符串得到稳定的正整数哈希，
 * 用于「同一篇文章每次构建拿到同一张随机封面」。
 */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 均匀铺满的封面分配：
 * 给一组文章按顺序分配 covers/ 里的图片，用完再循环，
 * 保证前 N 篇拿到的封面互不重复。已在 frontmatter 指定 cover 的跳过。
 *
 * 用固定种子的伪随机打乱顺序后轮转，
 * 这样既有随机感，又保证每次构建结果稳定、且不会扎堆重复。
 */
export function assignCovers<T extends { id: string; cover?: string }>(items: T[]): T[] {
  const covers = coverFiles()
  if (covers.length === 0) return items

  // 用文章 id 之和作为种子，打乱封面池顺序
  let seed = items.reduce((acc, it) => acc + hashString(it.id), 0) || 1
  const pool = [...covers]
  for (let i = pool.length - 1; i > 0; i--) {
    // xorshift 风格的确定性伪随机
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    const j = seed % (i + 1)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  let cursor = 0
  return items.map((item) => {
    if (item.cover) return item
    const cover = `/covers/${pool[cursor % pool.length]}`
    cursor++
    return { ...item, cover }
  })
}

/* ------------------------------------------------------------------ */
/* 读取文章                                                             */
/* ------------------------------------------------------------------ */

function readMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
}

/**
 * 构建期缓存：同一进程内只读一次磁盘。
 * 页面之间反复调用 getPosts() 时不必重复解析，警告也不会重复打印。
 */
let postsCache: PostMeta[] | null = null
let notesCache: NoteMeta[] | null = null

export function getPosts(): PostMeta[] {
  if (postsCache) return postsCache
  const posts = readMarkdownFiles(POSTS_DIR)
    .map((name) => {
      const file = path.join(POSTS_DIR, name)
      const raw = fs.readFileSync(file, 'utf8')
      const { data, body } = parseFrontmatter(raw)
      const id = name.replace(/\.md$/, '')
      const date = toDate(data.date)

      if (!data.title) {
        console.warn(`[content] 文章 ${name} 缺少 title 字段`)
      }
      if (!date) {
        console.warn(`[content] 文章 ${name} 缺少或无法解析 date 字段`)
      }

      // frontmatter 里写了 cover 且文件存在就用它，否则交给 assignCovers 随机分配
      const cover = resolveCoverPath(data.cover ? String(data.cover) : undefined)

      return {
        id,
        title: String(data.title ?? id),
        description: data.description ? String(data.description) : undefined,
        date: date ?? new Date(0),
        updated: toDate(data.updated),
        tags: toStringArray(data.tags),
        category: data.category ? String(data.category) : undefined,
        cover,
        draft: data.draft === true,
        pinned: data.pinned === true,
        body,
        file: `posts/${name}`,
      } satisfies PostMeta
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  // 没有指定（或指定了但找不到）封面的文章，从 covers/ 分配
  postsCache = assignCovers(posts)
  return postsCache
}

export function getNotes(): NoteMeta[] {
  if (notesCache) return notesCache
  notesCache = readMarkdownFiles(NOTES_DIR)
    .map((name) => {
      const file = path.join(NOTES_DIR, name)
      const raw = fs.readFileSync(file, 'utf8')
      const { data, body } = parseFrontmatter(raw)
      const id = name.replace(/\.md$/, '')
      return {
        id,
        date: toDate(data.date) ?? new Date(0),
        tags: toStringArray(data.tags),
        draft: data.draft === true,
        body,
        file: `notes/${name}`,
      } satisfies NoteMeta
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  return notesCache
}

/* ------------------------------------------------------------------ */
/* Markdown → 可渲染 HTML 的中间表示                                     */
/* ------------------------------------------------------------------ */

/**
 * 正文里图片路径的归一化：
 * 让 Obsidian 常见的相对写法也能指向 /images/。
 *   ![](images/a.png)   → /images/a.png
 *   ![](./a.png)        → /images/a.png
 *   ![](a.png)          → /images/a.png
 */
export function normalizeImagePaths(md: string): string {
  return md.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (_m, head: string, src: string) => {
    if (/^(https?:)?\/\//.test(src) || src.startsWith('/') || src.startsWith('data:')) {
      return head + src
    }
    const cleaned = src.replace(/^\.\//, '').replace(/^images\//, '')
    return `${head}/images/${cleaned}`
  })
}

/** 去掉 Markdown 标记，生成纯文本摘要 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
