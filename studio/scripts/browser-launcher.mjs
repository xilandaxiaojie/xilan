/**
 * 独立启动器：起本地服务 + 自动打开浏览器
 *
 * 不依赖 Electron 窗口，用系统自带浏览器当界面。
 * 适合 Electron 图形界面起不来的情况。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 查找 src 目录：兼容两种布局
//   1) 开发时：<studio>/scripts/launcher.mjs  → <studio>/src
//   2) 打包后：<浏览器版>/launcher.mjs        → <浏览器版>/src
const findSrc = () => {
  const candidates = [
    path.join(__dirname, 'src'),
    path.join(__dirname, '..', 'src'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'core', 'repo.js'))) return c
  }
  return path.join(__dirname, '..', 'src')
}

const SRC_ROOT = findSrc()
const ROOT = path.dirname(SRC_ROOT)
const UI = path.join(SRC_ROOT, 'ui')
const USER_HOME = process.env.USERPROFILE || process.env.HOME || ''
const CONFIG_DIR = path.join(
  process.env.APPDATA || path.join(USER_HOME, 'AppData', 'Roaming'),
  'Xilan Studio',
)
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

/* ---------------- 动态加载核心层 ---------------- */

const core = async () => {
  const imp = (rel) => import(new URL(rel, 'file:///' + SRC_ROOT.replace(/\\/g, '/') + '/').href)
  return {
    repo: await imp('core/repo.js'),
    git: await imp('core/git.js'),
    md: await imp('core/markdown.js'),
  }
}

/* ---------------- 配置 ---------------- */

// 配置优先写用户目录；如果不可写（权限受限等），退回到程序自带目录
const CONFIG_CANDIDATES = [
  CONFIG_FILE,
  path.join(__dirname, 'config.json'),
  path.join(ROOT, 'config.json'),
]

let activeConfigPath = null

const resolveConfigPath = () => {
  if (activeConfigPath) return activeConfigPath

  for (const p of CONFIG_CANDIDATES) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      // 试写，确认真的可写
      if (!fs.existsSync(p)) fs.writeFileSync(p, '{}', 'utf8')
      fs.accessSync(p, fs.constants.W_OK)
      activeConfigPath = p
      return p
    } catch {
      // 换下一个
    }
  }

  throw new Error(
    `无法写入配置文件，尝试过：\n${CONFIG_CANDIDATES.join('\n')}\n请检查这些位置的写入权限。`,
  )
}

const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(resolveConfigPath(), 'utf8'))
  } catch {
    return {}
  }
}

const writeConfig = (patch) => {
  const p = resolveConfigPath()
  const next = { ...readConfig(), ...patch }
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
  return next
}

const repoPathOrThrow = () => {
  const p = readConfig().repoPath
  if (!p) throw new Error('还没有打开仓库')
  return p
}

/* ---------------- API ---------------- */

const buildApi = (c) => ({
  'config.get': async () => ({
    ...readConfig(),
    hasToken: false,
    token: '',
  }),
  'config.set': async (patch) => writeConfig(patch),
  'config.clearToken': async () => {
    writeConfig({ token: '', user: null, hasToken: false })
    return true
  },

  'auth.login': async () => {
    throw new Error('浏览器版请直接选择本地仓库，暂不支持 GitHub 登录')
  },
  'auth.repos': async () => [],

  'repo.current': async () => readConfig().repoPath || null,
  'repo.use': async (dir) => {
    if (!c.repo.isValidRepo(dir)) throw new Error('这个目录看起来不是博客仓库')
    writeConfig({ repoPath: dir })
    return dir
  },
  'repo.overview': async () => {
    const p = readConfig().repoPath
    if (!p) return null
    return {
      entries: c.repo.listEntries(p),
      tags: c.repo.collectTags(p),
      categories: c.repo.collectCategories(p),
      covers: c.repo.listCovers(p),
      status: c.git.status(p),
      repoPath: p,
    }
  },

  'post.read': async (id, kind) => {
    const e = c.repo.readEntry(repoPathOrThrow(), id, kind)
    if (!e) throw new Error(`找不到文件：${id}.md`)
    return e
  },
  'post.save': async (payload) => ({ path: c.repo.saveEntry(repoPathOrThrow(), payload) }),
  'post.create': async (payload) => ({ id: c.repo.createEntry(repoPathOrThrow(), payload) }),
  'post.delete': async (id, kind) => c.repo.deleteEntry(repoPathOrThrow(), id, kind),
  'post.rename': async (oldId, newId, kind) => {
    c.repo.renameEntry(repoPathOrThrow(), oldId, newId, kind)
    return true
  },

  'image.list': async (id, kind) => c.repo.listArticleImages(repoPathOrThrow(), id, kind),
  'image.save': async ({ id, kind, name, data }) =>
    c.repo.saveImage(repoPathOrThrow(), id, kind, name, Buffer.from(data)),
  'image.delete': async (id, kind, name) =>
    c.repo.deleteImage(repoPathOrThrow(), id, kind, name),
  'image.dataUrl': async (absPath) => {
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

  'md.render': async (text) => ({
    html: c.md.renderMarkdown(text),
    headings: c.md.extractHeadings(text),
  }),

  'git.status': async () => c.git.status(repoPathOrThrow()),
  'git.diff': async (p) =>
    p ? c.git.fileDiff(repoPathOrThrow(), p) : c.git.fullDiff(repoPathOrThrow()),
  'git.commit': async (payload) => c.git.commit(repoPathOrThrow(), payload.message, payload.paths),
  'git.push': async () => c.git.push(repoPathOrThrow()),
  'git.pull': async () => c.git.pull(repoPathOrThrow()),
  'git.log': async (limit) => c.git.log(repoPathOrThrow(), limit),

  'sys.openExternal': async (url) => {
    execFile('cmd', ['/c', 'start', '', url])
    return true
  },
  'sys.openPath': async (p) => {
    execFile('explorer', [p])
    return true
  },
  'sys.paths': async () => ({ home: USER_HOME }),
})

/* ---------------- HTTP ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

const start = async (port = 4322) => {
  const c = await core()
  const api = buildApi(c)

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)

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

    const filePath = url.pathname === '/' ? '/index.html' : url.pathname
    const abs = path.join(UI, decodeURIComponent(filePath).replace(/^\//, ''))

    if (!abs.startsWith(UI) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    if (abs.endsWith('.html')) {
      let html = fs.readFileSync(abs, 'utf8')
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

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({ server, port }))
  })
}

/* ---------------- 入口 ---------------- */

const PORT = Number(process.argv[2]) || 4322

try {
  const { port } = await start(PORT)
  const target = `http://127.0.0.1:${port}/`

  console.log('============================================')
  console.log('  Xilan Studio 浏览器版已启动')
  console.log('============================================')
  console.log()
  console.log('  地址: ' + target)
  console.log()
  console.log('  浏览器应该已自动打开。')
  console.log('  如果没打开，手动把上面的地址粘进浏览器。')
  console.log()
  console.log('  关闭这个窗口即可退出程序。')
  console.log()

  execFile('cmd', ['/c', 'start', '', target])

  // 定期打印，避免窗口看起来像卡住
  setInterval(() => {}, 1 << 30)
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。可能程序已经在运行了。`)
    console.error(`试试在浏览器打开 http://127.0.0.1:${PORT}/`)
  } else {
    console.error('启动失败:', err.message)
  }
  console.error()
  console.error('按任意键退出…')
  process.stdin.resume()
  process.stdin.once('data', () => process.exit(1))
}
