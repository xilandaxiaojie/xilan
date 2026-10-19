/**
 * 文章仓库操作层
 *
 * 直接操作本地克隆的仓库目录，读写 posts/ 与 notes/。
 * 与界面无关，浏览器环境替换掉 fs 部分即可复用。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  parseFrontmatter,
  buildMarkdown,
  normalizeDate,
  toDate,
  slugify,
  today,
} from './frontmatter.js'

export const IMAGE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.bmp',
])

/** 图片子目录名：posts/文章名/images/ */
export const IMAGE_DIR_NAME = 'images'

/* ------------------------------ 目录约定 ------------------------------ */

export function layout(repoPath) {
  return {
    root: repoPath,
    posts: path.join(repoPath, 'posts'),
    notes: path.join(repoPath, 'notes'),
    covers: path.join(repoPath, 'covers'),
    images: path.join(repoPath, 'images'),
  }
}

export function isValidRepo(repoPath) {
  if (!repoPath) return false
  try {
    if (!fs.existsSync(repoPath)) return false
    if (!fs.existsSync(path.join(repoPath, '.git'))) return false
    const { posts, notes } = layout(repoPath)
    return fs.existsSync(posts) || fs.existsSync(notes)
  } catch {
    return false
  }
}

/** 列出仓库里所有 markdown 文件（posts 与 notes） */
function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
}

/* ------------------------------ 读取文章 ------------------------------ */

/**
 * 读取全部条目
 * @returns {{posts: Array, notes: Array}}
 */
export function listEntries(repoPath) {
  const dirs = layout(repoPath)

  const read = (dir, kind) =>
    listMarkdown(dir).map((name) => {
      const abs = path.join(dir, name)
      const stat = fs.statSync(abs)
      const text = fs.readFileSync(abs, 'utf8')
      const { data, body } = parseFrontmatter(text)
      const id = name.replace(/\.md$/, '')

      return {
        id,
        kind, // 'post' | 'note'
        file: path.relative(repoPath, abs).replace(/\\/g, '/'),
        absPath: abs,
        title: data.title ? String(data.title) : '',
        description: data.description ? String(data.description) : '',
        date: normalizeDate(data.date),
        updated: normalizeDate(data.updated),
        tags: normalizeTags(data.tags),
        category: data.category ? String(data.category) : '',
        cover: data.cover ? String(data.cover) : '',
        pinned: data.pinned === true,
        draft: data.draft === true,
        body,
        excerpt: excerptOf(body),
        mtime: stat.mtimeMs,
        size: stat.size,
      }
    })

  const posts = read(dirs.posts, 'post').sort(
    (a, b) => toDate(b.date) - toDate(a.date),
  )
  const notes = read(dirs.notes, 'note').sort(
    (a, b) => toDate(b.date) - toDate(a.date),
  )

  return { posts, notes }
}

/** 正文纯文本摘要 */
function excerptOf(body, len = 90) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, len)
}

export function normalizeTags(v) {
  if (!v) return []
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean)
  return String(v)
    .split(/[,，\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean)
}

/** 读取单篇完整内容 */
export function readEntry(repoPath, id, kind = 'post') {
  const dirs = layout(repoPath)
  const dir = kind === 'note' ? dirs.notes : dirs.posts
  const abs = path.join(dir, `${id}.md`)
  if (!fs.existsSync(abs)) return null

  const text = fs.readFileSync(abs, 'utf8')
  const { data, body } = parseFrontmatter(text)

  return {
    id,
    kind,
    file: path.relative(repoPath, abs).replace(/\\/g, '/'),
    absPath: abs,
    text,
    body,
    data: {
      title: data.title ? String(data.title) : '',
      description: data.description ? String(data.description) : '',
      date: normalizeDate(data.date),
      updated: normalizeDate(data.updated),
      tags: normalizeTags(data.tags),
      category: data.category ? String(data.category) : '',
      cover: data.cover ? String(data.cover) : '',
      pinned: data.pinned === true,
      draft: data.draft === true,
    },
  }
}

/* ------------------------------ 写入文章 ------------------------------ */

/** 保存文章，返回写入的绝对路径 */
export function saveEntry(repoPath, { id, kind = 'post', data, body }) {
  const dirs = layout(repoPath)
  const dir = kind === 'note' ? dirs.notes : dirs.posts
  fs.mkdirSync(dir, { recursive: true })

  const payload = {}
  if (kind === 'post') {
    payload.title = data.title || id
    if (data.description) payload.description = data.description
  }
  payload.date = data.date || today()
  if (data.updated) payload.updated = data.updated
  if (data.tags && data.tags.length) payload.tags = data.tags
  if (kind === 'post' && data.category) payload.category = data.category
  if (kind === 'post' && data.cover) payload.cover = data.cover
  if (data.pinned) payload.pinned = true
  if (data.draft) payload.draft = true

  const text = buildMarkdown(payload, body)
  const abs = path.join(dir, `${id}.md`)
  fs.writeFileSync(abs, text, 'utf8')
  return abs
}

/** 新建文章，返回 id */
export function createEntry(repoPath, { title, kind = 'post', date }) {
  const dirs = layout(repoPath)
  const dir = kind === 'note' ? dirs.notes : dirs.posts
  fs.mkdirSync(dir, { recursive: true })

  let id
  if (kind === 'note') {
    id = date || today()
    // 同一天多次新建时加后缀
    let n = 2
    while (fs.existsSync(path.join(dir, `${id}.md`))) {
      id = `${date || today()}-${n++}`
    }
  } else {
    const base = slugify(title || 'untitled')
    id = base
    let n = 2
    while (fs.existsSync(path.join(dir, `${id}.md`))) {
      id = `${base}-${n++}`
    }
  }

  const data =
    kind === 'note'
      ? { date: date || today(), tags: [] }
      : { title: title || '未命名文章', date: date || today(), tags: [] }

  saveEntry(repoPath, { id, kind, data, body: '' })
  return id
}

/** 删除文章 */
export function deleteEntry(repoPath, id, kind = 'post') {
  const dirs = layout(repoPath)
  const dir = kind === 'note' ? dirs.notes : dirs.posts
  const abs = path.join(dir, `${id}.md`)
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs)
    return true
  }
  return false
}

/** 重命名（改 id 即改 URL） */
export function renameEntry(repoPath, oldId, newId, kind = 'post') {
  const dirs = layout(repoPath)
  const dir = kind === 'note' ? dirs.notes : dirs.posts
  const from = path.join(dir, `${oldId}.md`)
  const to = path.join(dir, `${newId}.md`)
  if (!fs.existsSync(from)) throw new Error(`找不到 ${oldId}.md`)
  if (fs.existsSync(to)) throw new Error(`${newId}.md 已存在`)

  safeRename(from, to)

  // 同步重命名图片目录
  const oldDir = path.join(dir, oldId)
  const newDir = path.join(dir, newId)
  if (fs.existsSync(oldDir)) {
    safeRename(oldDir, newDir)
  }
  return to
}

/**
 * 目录重命名。某些文件系统 / 沙箱环境下对目录 rename 会返回 EPERM，
 * 这时退回「逐个复制文件 + 删除原目录」，保证功能可用。
 */
function safeRename(from, to) {
  try {
    fs.renameSync(from, to)
    return
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EXDEV' && err.code !== 'EBUSY') throw err
  }

  // 回退方案
  const stat = fs.statSync(from)
  if (stat.isFile()) {
    fs.copyFileSync(from, to)
    fs.unlinkSync(from)
    return
  }

  copyDirRecursive(from, to)
  fs.rmSync(from, { recursive: true, force: true })
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

/* ------------------------------ 图片 ------------------------------ */

/** 某篇文章的图片目录（绝对路径）：posts/文章名/images/ */
export function imageDirOf(repoPath, id, kind = 'post') {
  const dirs = layout(repoPath)
  const dir = kind === 'note' ? dirs.notes : dirs.posts
  return path.join(dir, id, IMAGE_DIR_NAME)
}

/** 列出某篇文章已上传的图片 */
export function listArticleImages(repoPath, id, kind = 'post') {
  const dir = imageDirOf(repoPath, id, kind)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const stat = fs.statSync(path.join(dir, e.name))
      return {
        name: e.name,
        size: stat.size,
        mtime: stat.mtimeMs,
        // 正文里引用的路径（相对仓库根，构建时可直接访问）
        webPath: `${kind === 'note' ? 'notes' : 'posts'}/${id}/${IMAGE_DIR_NAME}/${e.name}`,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

/**
 * 保存一张图片到 posts/文章名/images/
 * @returns {{name:string, webPath:string, absPath:string}}
 */
export function saveImage(repoPath, id, kind, fileName, buffer) {
  const dir = imageDirOf(repoPath, id, kind)
  fs.mkdirSync(dir, { recursive: true })

  const finalName = uniqueFileName(dir, sanitizeFileName(fileName))
  const abs = path.join(dir, finalName)
  fs.writeFileSync(abs, buffer)

  return {
    name: finalName,
    absPath: abs,
    webPath: `${kind === 'note' ? 'notes' : 'posts'}/${id}/${IMAGE_DIR_NAME}/${finalName}`,
  }
}

/** 删除图片 */
export function deleteImage(repoPath, id, kind, name) {
  const abs = path.join(imageDirOf(repoPath, id, kind), name)
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs)
    return true
  }
  return false
}

function sanitizeFileName(name) {
  const ext = path.extname(name).toLowerCase()
  const base = path
    .basename(name, path.extname(name))
    .replace(/[^\p{Letter}\p{Number}._-]/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return (base || 'image') + ext
}

function uniqueFileName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let n = 2
  while (fs.existsSync(path.join(dir, `${base}-${n}${ext}`))) n++
  return `${base}-${n}${ext}`
}

/* ------------------------------ 封面库 ------------------------------ */

/** 列出 covers/ 里的可用封面 */
export function listCovers(repoPath) {
  const dirs = layout(repoPath)
  if (!fs.existsSync(dirs.covers)) return []
  return fs
    .readdirSync(dirs.covers, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => ({
      name: e.name,
      webPath: `covers/${e.name}`,
      absPath: path.join(dirs.covers, e.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 汇总所有标签及使用次数 */
export function collectTags(repoPath) {
  const { posts, notes } = listEntries(repoPath)
  const map = new Map()
  for (const item of [...posts, ...notes]) {
    for (const tag of item.tags) {
      map.set(tag, (map.get(tag) || 0) + 1)
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** 汇总所有分类 */
export function collectCategories(repoPath) {
  const { posts } = listEntries(repoPath)
  const map = new Map()
  for (const p of posts) {
    if (p.category) map.set(p.category, (map.get(p.category) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
