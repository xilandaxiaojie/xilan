/**
 * Electron 主进程
 *
 * 职责：
 *  - 创建窗口
 *  - 通过 IPC 暴露有限的文件与 git 能力给界面
 *  - 保存配置（token、最近打开的仓库）到用户数据目录
 *
 * 安全约定：渲染进程不开 nodeIntegration，所有能力经由 preload 白名单暴露。
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/* ---------------- 配置存储 ---------------- */

const configDir = () => app.getPath('userData')
const configPath = () => path.join(configDir(), 'config.json')

const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

const writeConfig = (patch) => {
  const cur = readConfig()
  const next = { ...cur, ...patch }
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/* ---------------- 核心模块（ESM 动态加载） ---------------- */

// 主进程是 CJS，核心层是 ESM，用动态 import 拿到命名空间
let corePromise = null
const core = () => {
  if (!corePromise) {
    corePromise = (async () => ({
      repo: await import('../src/core/repo.js'),
      git: await import('../src/core/git.js'),
      fm: await import('../src/core/frontmatter.js'),
      md: await import('../src/core/markdown.js'),
      gh: await import('../src/core/github.js'),
    }))()
  }
  return corePromise
}

/* ---------------- 窗口 ---------------- */

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: '#f6f8f8',
    show: false,
    autoHideMenuBar: true,
    title: 'Xilan Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 兜底：万一 ready-to-show 没触发，3 秒后也把窗口显示出来，
  // 否则用户看到的就是「双击没反应」
  const safeShow = () => {
    try {
      if (mainWindow && typeof mainWindow.isDestroyed === 'function' && !mainWindow.isDestroyed()) {
        if (typeof mainWindow.show === 'function') mainWindow.show()
      }
    } catch (err) {
      console.error('[show]', err)
    }
  }

  const fallback = setTimeout(safeShow, 3000)

  mainWindow.once('ready-to-show', () => {
    clearTimeout(fallback)
    safeShow()
  })

  // 页面加载失败时，把错误显示在窗口里，而不是静默失败
  const wc = mainWindow.webContents
  if (wc && typeof wc.on === 'function') {
    wc.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[load-fail]', code, desc, url)
      safeShow()
      if (typeof wc.executeJavaScript === 'function') {
        wc.executeJavaScript(
          `document.body.innerHTML = ${JSON.stringify(
            `<div style="font:14px/1.6 system-ui;padding:40px;color:#333">
               <h2 style="color:#c0392b">界面加载失败</h2>
               <p>错误码：${code}</p><p>说明：${desc}</p><p>路径：${url}</p>
             </div>`,
          )}`,
        ).catch(() => {})
      }
    })

    wc.on('render-process-gone', (_e, details) => {
      console.error('[render-gone]', JSON.stringify(details))
    })
  }

  const loaded = mainWindow.loadFile(path.join(__dirname, '../src/ui/index.html'))
  if (loaded && typeof loaded.catch === 'function') {
    loaded.catch((err) => console.error('[loadFile]', err))
  }

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => {
  console.error('[whenReady]', err)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ---------------- IPC ---------------- */

/** 统一包装：把可预期的错误转成 { ok:false, error }，避免界面崩溃 */
const handle = (channel, fn) => {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      console.error(`[ipc:${channel}]`, err)
      return { ok: false, error: err.message || String(err) }
    }
  })
}

/* --- 配置 --- */

/** 取当前仓库路径，没有则抛出明确的错误 */
const repoPathOrThrow = () => {
  const cfg = readConfig()
  if (!cfg.repoPath) throw new Error('还没有打开仓库')
  return cfg.repoPath
}

handle('config:get', () => {
  const cfg = readConfig()
  // 不把完整 token 发回渲染进程，只给掩码
  return {
    ...cfg,
    token: cfg.token ? maskToken(cfg.token) : '',
    hasToken: !!cfg.token,
  }
})

handle('config:set', (patch) => writeConfig(patch))

handle('config:clearToken', () => {
  const cfg = readConfig()
  delete cfg.token
  delete cfg.user
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  return true
})

function maskToken(t) {
  if (!t) return ''
  if (t.length <= 10) return '****'
  return `${t.slice(0, 4)}${'*'.repeat(Math.min(16, t.length - 8))}${t.slice(-4)}`
}

/* --- 登录 --- */

handle('auth:login', async (token) => {
  const { gh } = await core()
  const user = await gh.getUser(token)
  writeConfig({ token, user })
  const repos = await gh.listRepos(token).catch(() => [])
  return { user, repos }
})

handle('auth:repos', async () => {
  const { gh } = await core()
  const cfg = readConfig()
  if (!cfg.token) throw new Error('尚未登录')
  return gh.listRepos(cfg.token)
})

handle('auth:pages', async (fullName) => {
  const { gh } = await core()
  const cfg = readConfig()
  if (!cfg.token) return { enabled: false }
  return gh.getPages(cfg.token, fullName)
})

handle('auth:runs', async (fullName) => {
  const { gh } = await core()
  const cfg = readConfig()
  if (!cfg.token) return []
  return gh.listRuns(cfg.token, fullName)
})

/* --- 仓库 --- */

handle('repo:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择博客仓库目录',
    properties: ['openDirectory'],
    buttonLabel: '选择',
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const dir = res.filePaths[0]

  const { repo } = await core()
  if (!repo.isValidRepo(dir)) {
    throw new Error('这个目录看起来不是博客仓库（需要包含 .git 以及 posts/ 或 notes/ 目录）')
  }

  writeConfig({ repoPath: dir })
  return dir
})

handle('repo:use', async (dir) => {
  const { repo } = await core()
  if (!repo.isValidRepo(dir)) {
    throw new Error('这个目录看起来不是博客仓库')
  }
  writeConfig({ repoPath: dir })
  return dir
})

handle('repo:clone', async ({ url, parentDir }) => {
  const { git, repo } = await core()

  // 从 url 推导目录名
  const name = String(url)
    .replace(/\.git$/, '')
    .split('/')
    .pop()
  let dest = path.join(parentDir, name)

  if (fs.existsSync(dest)) {
    // 已存在：若本身就是有效仓库，直接用它
    if (repo.isValidRepo(dest)) {
      writeConfig({ repoPath: dest })
      return dest
    }
    throw new Error(`目录已存在: ${dest}`)
  }

  git.clone(url, dest)

  if (!repo.isValidRepo(dest)) {
    throw new Error('克隆完成，但目录里没有 posts/ 或 notes/，请确认这是博客仓库')
  }

  writeConfig({ repoPath: dest })
  return dest
})

handle('repo:pickCloneDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择克隆到哪里',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '选择',
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})

handle('repo:current', async () => {
  const cfg = readConfig()
  return cfg.repoPath || null
})

handle('repo:overview', async () => {
  const cfg = readConfig()
  if (!cfg.repoPath) return null
  const repoPath = cfg.repoPath
  const { repo, git } = await core()

  const entries = repo.listEntries(repoPath)
  const tags = repo.collectTags(repoPath)
  const categories = repo.collectCategories(repoPath)
  const covers = repo.listCovers(repoPath)
  const st = git.status(repoPath)

  return { entries, tags, categories, covers, status: st, repoPath }
})

/* --- 文章 --- */

handle('post:read', async (id, kind) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  const entry = repo.readEntry(repoPath, id, kind)
  if (!entry) {
    throw new Error(`找不到文件：${kind === 'note' ? 'notes' : 'posts'}/${id}.md`)
  }
  return entry
})

handle('post:save', async (payload) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  const abs = repo.saveEntry(repoPath, payload)
  return { path: abs }
})

handle('post:create', async ({ title, kind, date }) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  const id = repo.createEntry(repoPath, { title, kind, date })
  return { id }
})

handle('post:delete', async (id, kind) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  return repo.deleteEntry(repoPath, id, kind)
})

handle('post:rename', async (oldId, newId, kind) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  repo.renameEntry(repoPath, oldId, newId, kind)
  return true
})

/* --- 图片 --- */

handle('image:list', async (id, kind) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  return repo.listArticleImages(repoPath, id, kind)
})

handle('image:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp'] },
    ],
  })
  if (res.canceled) return []
  return res.filePaths.map((p) => ({
    name: path.basename(p),
    absPath: p,
    buffer: fs.readFileSync(p),
  }))
})

handle('image:save', async ({ id, kind, name, data }) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  // data 是 Uint8Array / Array
  const buf = Buffer.from(data)
  return repo.saveImage(repoPath, id, kind, name, buf)
})

handle('image:delete', async (id, kind, name) => {
  const repoPath = repoPathOrThrow()
  const { repo } = await core()
  return repo.deleteImage(repoPath, id, kind, name)
})

/** 读取图片供界面预览（本地文件 → data URL） */
handle('image:dataUrl', async (absPath) => {
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
})

/* --- markdown 渲染 --- */

handle('md:render', async (text) => {
  const { md } = await core()
  return {
    html: md.renderMarkdown(text),
    headings: md.extractHeadings(text),
  }
})

/* --- git --- */

handle('git:status', async () => {
  const repoPath = repoPathOrThrow()
  const { git } = await core()
  return git.status(repoPath)
})

handle('git:diff', async (filePath) => {
  const repoPath = repoPathOrThrow()
  const { git } = await core()
  return filePath ? git.fileDiff(repoPath, filePath) : git.fullDiff(repoPath)
})

handle('git:commit', async ({ message, paths }) => {
  const repoPath = repoPathOrThrow()
  const { git } = await core()
  return git.commit(repoPath, message, paths)
})

handle('git:push', async () => {
  const repoPath = repoPathOrThrow()
  const { git } = await core()
  return git.push(repoPath)
})

handle('git:pull', async () => {
  const repoPath = repoPathOrThrow()
  const { git } = await core()
  return git.pull(repoPath)
})

handle('git:log', async (limit) => {
  const repoPath = repoPathOrThrow()
  const { git } = await core()
  return git.log(repoPath, limit)
})

/* --- 系统 --- */

handle('sys:openExternal', async (url) => {
  await shell.openExternal(url)
  return true
})

handle('sys:openPath', async (p) => {
  const res = await shell.openPath(p)
  if (res) throw new Error(res)
  return true
})

handle('sys:paths', async () => ({
  home: os.homedir(),
  desktop: path.join(os.homedir(), 'Desktop'),
  userData: app.getPath('userData'),
}))
