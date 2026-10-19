/**
 * 浏览器预览服务器 + API 桥接
 *
 * 目的：在无法启动 Electron 图形界面的环境里，也能打开界面看效果。
 * 启动一个本地 HTTP 服务，提供 src/ui 下的静态文件，
 * 并把 window.api 的所有调用通过 HTTP 转发到 Node 端核心层。
 *
 * 用法：node scripts/preview-server.mjs [端口]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as repo from '../src/core/repo.js'
import * as git from '../src/core/git.js'
import * as fm from '../src/core/frontmatter.js'
import * as md from '../src/core/markdown.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const UI = path.join(ROOT, 'src', 'ui')
const PORT = Number(process.argv[2]) || 4322

/* ---------------- 配置（简单的文件存储） ---------------- */

const cfgFile = path.join(ROOT, '.tmp', 'preview-config.json')
const readCfg = () => {
  try {
    return JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
  } catch {
    return {}
  }
}
const writeCfg = (patch) => {
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true })
  const next = { ...readCfg(), ...patch }
  fs.writeFileSync(cfgFile, JSON.stringify(next, null, 2), 'utf8')
  return next
}
const repoPathOrThrow = () => {
  const p = readCfg().repoPath
  if (!p) throw new Error('还没有打开仓库')
  return p
}

/* ---------------- API 实现（与主进程一致） ---------------- */

const api = {
  'config.get': () => ({ ...readCfg(), hasToken: false, token: '' }),
  'config.set': (patch) => writeCfg(patch),
  'config.clearToken': () => true,

  'repo.current': () => readCfg().repoPath || null,
  'repo.use': (dir) => {
    if (!repo.isValidRepo(dir)) throw new Error('这个目录看起来不是博客仓库')
    writeCfg({ repoPath: dir })
    return dir
  },
  'repo.overview': () => {
    const p = repoPathOrThrow()
    return {
      entries: repo.listEntries(p),
      tags: repo.collectTags(p),
      categories: repo.collectCategories(p),
      covers: repo.listCovers(p),
      status: git.status(p),
      repoPath: p,
    }
  },

  'post.read': (id, kind) => {
    const e = repo.readEntry(repoPathOrThrow(), id, kind)
    if (!e) throw new Error(`找不到文件：${id}.md`)
    return e
  },
  'post.save': (payload) => ({ path: repo.saveEntry(repoPathOrThrow(), payload) }),
  'post.create': (payload) => ({ id: repo.createEntry(repoPathOrThrow(), payload) }),
  'post.delete': (id, kind) => repo.deleteEntry(repoPathOrThrow(), id, kind),
  'post.rename': (oldId, newId, kind) => {
    repo.renameEntry(repoPathOrThrow(), oldId, newId, kind)
    return true
  },

  'image.list': (id, kind) => repo.listArticleImages(repoPathOrThrow(), id, kind),
  'image.save': ({ id, kind, name, data }) =>
    repo.saveImage(repoPathOrThrow(), id, kind, name, Buffer.from(data)),
  'image.delete': (id, kind, name) => repo.deleteImage(repoPathOrThrow(), id, kind, name),
  'image.dataUrl': (absPath) => {
    if (!fs.existsSync(absPath)) throw new Error('文件不存在')
    const buf = fs.readFileSync(absPath)
    const ext = path.extname(absPath).toLowerCase().replace('.', '')
    const mime =
      {
        svg: 'image/svg+xml',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        bmp: 'image/bmp',
      }[ext] || 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  },

  'md.render': (text) => ({
    html: md.renderMarkdown(text),
    headings: md.extractHeadings(text),
  }),

  'git.status': () => git.status(repoPathOrThrow()),
  'git.diff': (filePath) =>
    filePath ? git.fileDiff(repoPathOrThrow(), filePath) : git.fullDiff(repoPathOrThrow()),
  'git.commit': (payload) => git.commit(repoPathOrThrow(), payload.message, payload.paths),
  'git.push': () => git.push(repoPathOrThrow()),
  'git.pull': () => git.pull(repoPathOrThrow()),
  'git.log': (limit) => git.log(repoPathOrThrow(), limit),

  'sys.openExternal': (url) => {
    console.log(`[open] ${url}`)
    return true
  },
  'sys.openPath': (p) => {
    console.log(`[openPath] ${p}`)
    return true
  },
  'sys.paths': () => ({ home: '', desktop: '', userData: '' }),
}

/* ---------------- HTTP ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // API 调用
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk

    try {
      const { channel, args } = JSON.parse(body || '{}')
      const fn = api[channel]
      if (!fn) throw new Error(`未实现: ${channel}`)
      const data = await fn(...(args || []))
      res.writeHead(200, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: true, data }))
    } catch (err) {
      res.writeHead(200, { 'Content-Type': MIME['.json'] })
      res.end(JSON.stringify({ ok: false, error: err.message || String(err) }))
    }
    return
  }

  // 静态文件：index.html 需注入浏览器桥接脚本
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname
  const abs = path.join(UI, filePath.replace(/^\//, ''))

  if (!abs.startsWith(UI) || !fs.existsSync(abs)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  // HTML 注入桥接脚本（浏览器模式下替代 preload）
  if (abs.endsWith('.html')) {
    let html = fs.readFileSync(abs, 'utf8')
    // 放宽 CSP 以允许 fetch 到本地 API
    html = html.replace(
      /content="default-src 'self';[^"]*"/,
      `content="default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"`,
    )
    html = html.replace(
      '<script type="module" src="./app.js"></script>',
      '<script src="./browser-api.js"></script>\n    <script type="module" src="./app.js"></script>',
    )
    res.writeHead(200, { 'Content-Type': MIME['.html'] })
    res.end(html)
    return
  }

  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'text/plain' })
  fs.createReadStream(abs).pipe(res)
})

server.listen(PORT, () => {
  console.log(`界面预览: http://localhost:${PORT}/`)
  console.log(`仓库: ${readCfg().repoPath || '(未设置)'}`)
})
