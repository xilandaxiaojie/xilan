/**
 * Xilan Studio 渲染进程
 *
 * 负责界面状态与交互。所有文件与 git 操作经由 window.api → IPC → 主进程。
 */

/* ============================================================
   工具
   ============================================================ */

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]

/** 统一调用，失败时抛错 */
async function call(fnPromise) {
  const res = await fnPromise
  if (!res) throw new Error('无响应')
  if (!res.ok) throw new Error(res.error || '操作失败')
  return res.data
}

function toast(msg, type = '') {
  const el = document.createElement('div')
  el.className = 'toast' + (type ? ` toast--${type}` : '')
  el.textContent = msg
  $('#toast-container').appendChild(el)
  setTimeout(() => {
    el.style.transition = 'opacity .3s'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 320)
  }, type === 'error' ? 3800 : 2200)
}

const debounce = (fn, ms) => {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/* ============================================================
   全局状态
   ============================================================ */

const state = {
  user: null,
  repoPath: '',
  entries: { posts: [], notes: [] },
  tags: [],
  categories: [],
  covers: [],
  status: null,

  kind: 'post', // 当前列表：post | note
  search: '',
  activeTag: '',

  current: null, // 当前编辑文章 { id, kind }
  data: null, // frontmatter 数据
  body: '',

  dirty: false,
  saving: false,
  autosaveTimer: null,

  view: 'split',
  images: [],
}

/* ============================================================
   欢迎页 / 登录
   ============================================================ */

async function initWelcome() {
  $('#open-token-page').addEventListener('click', (e) => {
    e.preventDefault()
    window.api.sys.openExternal(
      'https://github.com/settings/tokens/new?scopes=repo&description=Xilan%20Studio',
    )
  })

  $('#btn-login').addEventListener('click', doLogin)
  $('#token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin()
  })

  $('#btn-logout').addEventListener('click', async () => {
    await window.api.config.clearToken()
    location.reload()
  })

  $('#btn-clone').addEventListener('click', doClone)
  $('#btn-open-dir').addEventListener('click', doOpenDir)
  $('#btn-repo-path')?.addEventListener('click', () => {
    if (state.repoPath) call(window.api.sys.openPath(state.repoPath))
  })

  // 已登录过就直接进入仓库选择
  const cfg = await call(window.api.config.get())
  if (cfg?.hasToken && cfg.user) {
    state.user = cfg.user
    showRepoStep()
    loadRepoList()
  }
}

async function doLogin() {
  const token = $('#token-input').value.trim()
  const errEl = $('#login-error')
  errEl.hidden = true

  if (!token) {
    errEl.textContent = '请先填写 Token'
    errEl.hidden = false
    return
  }

  const btn = $('#btn-login')
  btn.disabled = true
  btn.textContent = '验证中…'

  try {
    const res = await call(window.api.auth.login(token))
    state.user = res.user
    showRepoStep()
    renderRepoOptions(res.repos)
  } catch (err) {
    errEl.textContent = `登录失败：${err.message}`
    errEl.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = '登录'
  }
}

function showRepoStep() {
  $('#welcome-login').hidden = true
  $('#welcome-repo').hidden = false
  $('#user-avatar').src = state.user?.avatar || ''
  $('#user-name').textContent = state.user?.login || ''
}

async function loadRepoList() {
  try {
    const repos = await call(window.api.auth.repos())
    renderRepoOptions(repos)
  } catch (err) {
    const errEl = $('#repo-error')
    errEl.textContent = `无法读取仓库列表：${err.message}`
    errEl.hidden = false
  }
}

function renderRepoOptions(repos) {
  const sel = $('#repo-select')
  sel.innerHTML = '<option value="">选择仓库…</option>'
  for (const r of repos) {
    const opt = document.createElement('option')
    opt.value = r.cloneUrl
    opt.textContent = r.fullName + (r.private ? '  (私有)' : '')
    sel.appendChild(opt)
  }
}

let cloneTargetDir = ''

async function doClone() {
  const url = $('#repo-select').value
  const errEl = $('#repo-error')
  errEl.hidden = true

  if (!url) {
    errEl.textContent = '请先选择仓库'
    errEl.hidden = false
    return
  }

  // 第一次点：选择克隆位置
  if (!cloneTargetDir) {
    const dir = await call(window.api.repo.pickCloneDir())
    if (!dir) return
    cloneTargetDir = dir
    $('#clone-target-hint').textContent = `克隆到：${dir}`
  }

  const btn = $('#btn-clone')
  btn.disabled = true
  btn.textContent = '克隆中…'

  try {
    const dest = await call(window.api.repo.clone({ url, parentDir: cloneTargetDir }))
    state.repoPath = dest
    toast('克隆完成', 'ok')
    await enterApp()
  } catch (err) {
    errEl.textContent = `克隆失败：${err.message}`
    errEl.hidden = false
    cloneTargetDir = ''
  } finally {
    btn.disabled = false
    btn.textContent = '克隆'
  }
}

async function doOpenDir() {
  const errEl = $('#repo-error')
  errEl.hidden = true
  try {
    const dir = await call(window.api.repo.pick())
    if (!dir) return
    state.repoPath = dir
    await enterApp()
  } catch (err) {
    errEl.textContent = err.message
    errEl.hidden = false
  }
}

/* ============================================================
   主界面初始化
   ============================================================ */

async function enterApp() {
  const dir = state.repoPath || (await call(window.api.repo.current()))
  if (!dir) return

  state.repoPath = dir
  $('#screen-welcome').hidden = true
  $('#screen-app').hidden = false
  $('#btn-repo-path').textContent = dir
  $('#btn-repo-path').title = `点击打开 ${dir}`

  bindAppEvents()
  await refreshAll()
}

async function refreshAll() {
  await call(window.api.repo.current())
  const ov = await call(window.api.repo.overview())
  if (!ov) return

  state.entries = ov.entries
  state.tags = ov.tags
  state.categories = ov.categories
  state.covers = ov.covers
  state.status = ov.status

  renderEntryList()
  renderFilters()
  renderCategories()
  renderGitBadge()
  await renderChanges()
}

function renderGitBadge() {
  const badge = $('#git-badge')
  const st = state.status
  if (!st) {
    badge.hidden = true
    return
  }

  badge.hidden = false
  const parts = []
  if (st.branch) parts.push(st.branch)

  const n = st.files?.length || 0
  if (n > 0) parts.push(`${n} 个改动`)
  if (st.ahead > 0) parts.push(`领先 ${st.ahead}`)
  if (st.behind > 0) parts.push(`落后 ${st.behind}`)

  badge.textContent = parts.join(' · ') || '干净'
  badge.className = 'badge' + (n > 0 || st.ahead > 0 ? ' badge--warn' : '')
}

/* ============================================================
   列表渲染
   ============================================================ */

function currentList() {
  const raw = state.kind === 'post' ? state.entries.posts : state.entries.notes
  let list = raw

  if (state.activeTag) {
    list = list.filter((e) => e.tags.includes(state.activeTag))
  }

  const q = state.search.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (e) =>
        (e.title || '').toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)) ||
        (e.excerpt || '').toLowerCase().includes(q),
    )
  }

  return list
}

function renderEntryList() {
  const ul = $('#entry-list')
  const list = currentList()
  ul.innerHTML = ''

  if (list.length === 0) {
    const li = document.createElement('li')
    li.className = 'entry-list__empty'
    li.textContent =
      state.search || state.activeTag
        ? '没有匹配的条目'
        : state.kind === 'post'
          ? '还没有文章，点「新建」开始'
          : '还没有手记'
    ul.appendChild(li)
    return
  }

  // 置顶的排前面（仅文章）
  const sorted = [...list].sort((a, b) => {
    if (state.kind === 'post' && a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return String(b.date).localeCompare(String(a.date))
  })

  const dirtySet = new Set(
    (state.status?.files || [])
      .filter((f) => f.path.startsWith('posts/') || f.path.startsWith('notes/'))
      .map((f) => f.path.replace(/\.md$/, '')),
  )

  for (const e of sorted) {
    const li = document.createElement('li')
    li.className = 'entry'
    const isActive =
      state.current && state.current.id === e.id && state.current.kind === e.kind
    if (isActive) li.classList.add('is-active')

    const title = e.title || (e.kind === 'note' ? e.excerpt || '（无标题手记）' : e.id)
    const isDirty = dirtySet.has(e.file)

    li.innerHTML = `
      <div class="entry__title">
        ${e.pinned ? '<span class="entry__pin">📌</span>' : ''}
        <span class="entry__title-text"></span>
        ${isDirty ? '<span class="entry__dirty" title="有未提交的改动"></span>' : ''}
      </div>
      <div class="entry__meta">
        <span>${escapeHtml(e.date || '无日期')}</span>
        ${e.category ? `<span class="entry__cat">${escapeHtml(e.category)}</span>` : ''}
        ${e.draft ? '<span>草稿</span>' : ''}
      </div>
    `
    li.querySelector('.entry__title-text').textContent = title

    li.addEventListener('click', () => openEntry(e.id, e.kind))
    ul.appendChild(li)
  }
}

function renderFilters() {
  const bar = $('#filter-bar')
  bar.innerHTML = ''
  const list = state.kind === 'post' ? state.entries.posts : state.entries.notes

  const counts = new Map()
  for (const e of list) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)

  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  if (tags.length === 0) return

  for (const [tag, count] of tags) {
    const btn = document.createElement('button')
    btn.className = 'filter-chip' + (state.activeTag === tag ? ' is-active' : '')
    btn.textContent = `${tag} ${count}`
    btn.addEventListener('click', () => {
      state.activeTag = state.activeTag === tag ? '' : tag
      renderFilters()
      renderEntryList()
    })
    bar.appendChild(btn)
  }
}

function renderCategories() {
  const dl = $('#category-list')
  dl.innerHTML = ''
  for (const c of state.categories) {
    const opt = document.createElement('option')
    opt.value = c.name
    dl.appendChild(opt)
  }
}

/* ============================================================
   打开 / 编辑文章
   ============================================================ */

async function openEntry(id, kind) {
  if (!(await ensureSaved())) return

  try {
    const entry = await call(window.api.post.read(id, kind))
    if (!entry) throw new Error('文件不存在')

    state.current = { id, kind }
    state.data = { ...entry.data }
    state.body = entry.body
    setDirty(false)

    showEditor()
    fillForm()
    await renderPreview()
    await loadImages()
    renderEntryList()
  } catch (err) {
    toast(`打开失败：${err.message}`, 'error')
  }
}

function showEditor() {
  $('#editor-empty').hidden = true
  $('#editor-main').hidden = false
  // 手记没有标题和分类
  const isNote = state.current.kind === 'note'
  $('#field-title').closest('.meta-field').style.display = isNote ? 'none' : ''
  $('#field-category').closest('.meta-field').style.display = isNote ? 'none' : ''
}

function fillForm() {
  const d = state.data
  $('#field-title').value = d.title || ''
  $('#field-date').value = (d.date || '').slice(0, 10)
  $('#field-desc').value = d.description || ''
  $('#field-category').value = d.category || ''
  $('#field-cover').value = d.cover || ''
  $('#field-pinned').checked = !!d.pinned
  $('#field-draft').checked = !!d.draft
  $('#md-input').value = state.body
  renderTagChips()
  renderCoverPreview()
}

/* --- 标签 --- */

function renderTagChips() {
  const box = $('#tag-chips')
  box.innerHTML = ''
  for (const tag of state.data.tags || []) {
    const chip = document.createElement('span')
    chip.className = 'tag-chip'
    const label = document.createElement('span')
    label.textContent = tag
    const x = document.createElement('button')
    x.className = 'tag-chip__x'
    x.textContent = '×'
    x.addEventListener('click', () => {
      state.data.tags = state.data.tags.filter((t) => t !== tag)
      renderTagChips()
      renderTagSuggest()
      markDirty()
    })
    chip.append(label, x)
    box.appendChild(chip)
  }
}

function renderTagSuggest() {
  const box = $('#tag-suggest')
  box.innerHTML = ''
  const existing = new Set(state.data.tags || [])
  const q = $('#tag-input').value.trim().toLowerCase()

  const suggestions = state.tags
    .filter((t) => !existing.has(t.name))
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .slice(0, 12)

  for (const t of suggestions) {
    const btn = document.createElement('button')
    btn.className = 'tag-suggest__item'
    btn.textContent = t.name
    btn.addEventListener('click', () => addTag(t.name))
    box.appendChild(btn)
  }
}

function addTag(name) {
  const v = String(name).trim().replace(/^#/, '')
  if (!v) return
  if (!state.data.tags) state.data.tags = []
  if (state.data.tags.includes(v)) return
  state.data.tags.push(v)
  renderTagChips()
  renderTagSuggest()
  markDirty()
}

/* --- 封面 --- */

function renderCoverPreview() {
  const el = $('#cover-preview')
  const v = ($('#field-cover').value || '').trim()

  if (!v) {
    el.className = 'cover-preview cover-preview--empty'
    el.style.backgroundImage = ''
    el.textContent = '自动随机'
    return
  }

  el.textContent = ''
  el.className = 'cover-preview'
  if (/^https?:\/\//.test(v)) {
    el.style.backgroundImage = `url("${v}")`
    return
  }

  // 本地路径：找出 covers/ 里对应的绝对路径
  const fileName = v.split('/').pop()
  const cover = state.covers.find((c) => c.name === fileName)
  if (cover) {
    call(window.api.image.dataUrl(cover.absPath))
      .then((url) => {
        el.style.backgroundImage = `url("${url}")`
      })
      .catch(() => {
        el.style.backgroundImage = ''
      })
  } else {
    el.style.backgroundImage = ''
    el.textContent = '找不到'
  }
}

/* ============================================================
   变更追踪与自动保存
   ============================================================ */

function markDirty() {
  setDirty(true)
  scheduleAutosave()
}

function setDirty(v) {
  state.dirty = v
  const el = $('#save-state')
  el.className = 'save-state' + (v ? ' save-state--dirty' : '')
  el.textContent = v ? '未保存' : ''
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer)
  state.autosaveTimer = setTimeout(() => saveCurrent(true), 1200)
}

async function saveCurrent(silent = false) {
  if (!state.current || !state.data) return true
  if (!state.dirty) return true
  if (state.saving) return true

  state.saving = true
  clearTimeout(state.autosaveTimer)

  try {
    await call(
      window.api.post.save({
        id: state.current.id,
        kind: state.current.kind,
        data: state.data,
        body: state.body,
      }),
    )

    setDirty(false)
    const el = $('#save-state')
    el.className = 'save-state save-state--saved'
    el.textContent = '已保存'
    setTimeout(() => {
      if (!state.dirty) el.textContent = ''
    }, 1800)

    // 刷新列表里的标题等元数据
    await refreshEntries()
    return true
  } catch (err) {
    if (!silent) toast(`保存失败：${err.message}`, 'error')
    setDirty(true)
    return false
  } finally {
    state.saving = false
  }
}

async function ensureSaved() {
  if (!state.dirty) return true
  return saveCurrent(true)
}

/** 只刷新列表数据，不重建整个界面 */
async function refreshEntries() {
  const ov = await call(window.api.repo.overview())
  if (!ov) return
  state.entries = ov.entries
  state.tags = ov.tags
  state.categories = ov.categories
  state.covers = ov.covers
  state.status = ov.status
  renderEntryList()
  renderFilters()
  renderGitBadge()
  await renderChanges()
}

/* ============================================================
   预览渲染
   ============================================================ */

async function renderPreview() {
  try {
    const { html } = await call(window.api.md.render(state.body))
    $('#preview').innerHTML = html
  } catch (err) {
    $('#preview').textContent = `预览失败：${err.message}`
  }
}

/** 点击代码块的复制按钮 */
$('#preview')?.addEventListener?.('click', () => {})

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.md-copy')
  if (!btn) return
  const code = btn.closest('.md-code')?.querySelector('code')?.textContent || ''
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制'
    setTimeout(() => (btn.textContent = '复制'), 1400)
  })
})

/* ============================================================
   图片
   ============================================================ */

async function loadImages() {
  if (!state.current) return
  const imgs = await call(window.api.image.list(state.current.id, state.current.kind))
  state.images = imgs
  renderImages()
}

async function renderImages() {
  const grid = $('#image-grid')
  const panel = $('#image-panel')
  grid.innerHTML = ''
  $('#image-count').textContent = state.images.length ? `${state.images.length} 张` : ''

  if (state.images.length === 0) {
    panel.hidden = true
    return
  }

  panel.hidden = false
  const dir = `${state.current.kind === 'note' ? 'notes' : 'posts'}/${state.current.id}/images`

  for (const img of state.images) {
    const abs = `${state.repoPath}\\${dir}\\${img.name}`.replace(/\\/g, '\\')
    const item = document.createElement('div')
    item.className = 'image-item'
    item.title = `${img.name}\n点击插入到正文`

    const el = document.createElement('img')
    call(window.api.image.dataUrl(abs))
      .then((url) => (el.src = url))
      .catch(() => {})

    const name = document.createElement('div')
    name.className = 'image-item__name'
    name.textContent = img.name

    const del = document.createElement('button')
    del.className = 'image-item__del'
    del.textContent = '×'
    del.title = '删除这张图'
    del.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`删除图片 ${img.name}？`)) return
      try {
        await call(window.api.image.remove(state.current.id, state.current.kind, img.name))
        await loadImages()
        toast('已删除', 'ok')
      } catch (err) {
        toast(`删除失败：${err.message}`, 'error')
      }
    })

    item.append(el, name, del)
    item.addEventListener('click', () => insertImageMarkdown(img.webPath))
    grid.appendChild(item)
  }
}

function insertImageMarkdown(webPath) {
  const ta = $('#md-input')
  const alt = ''
  const md = `![${alt}](${webPath})`
  insertAtCursor(ta, md)
  markDirty()
  renderPreview()
}

/** 把文件保存到文章图片目录并插入 markdown */
async function uploadImages(files) {
  if (!state.current) {
    toast('请先打开或新建一篇文章', 'error')
    return
  }

  for (const file of files) {
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const r = await call(
        window.api.image.save({
          id: state.current.id,
          kind: state.current.kind,
          name: file.name,
          data: Array.from(buf),
        }),
      )
      insertImageMarkdown(r.webPath)
    } catch (err) {
      toast(`上传 ${file.name} 失败：${err.message}`, 'error')
    }
  }

  await loadImages()
  await renderPreview()
}

/** 在光标处插入文本 */
function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const before = textarea.value.slice(0, start)
  const after = textarea.value.slice(end)
  textarea.value = before + text + after
  const pos = start + text.length
  textarea.selectionStart = textarea.selectionEnd = pos
  textarea.focus()
  state.body = textarea.value
}

/* ============================================================
   变更面板
   ============================================================ */

async function renderChanges() {
  const st = state.status
  const panel = $('#changes-panel')
  const list = $('#change-list')

  const relevant = (st?.files || []).filter(
    (f) => f.path.startsWith('posts/') || f.path.startsWith('notes/') || f.path.startsWith('covers/'),
  )

  if (relevant.length === 0 && !(st?.ahead > 0)) {
    panel.hidden = true
    return
  }

  panel.hidden = false
  list.innerHTML = ''

  for (const f of relevant) {
    const li = document.createElement('li')
    li.className = 'change-item'

    const kind = statusKind(f)
    const badge = document.createElement('span')
    badge.className = 'change-item__status'
    badge.dataset.s = kind.type
    badge.textContent = kind.label

    const p = document.createElement('span')
    p.className = 'change-item__path'
    p.textContent = f.path

    li.append(badge, p)
    li.addEventListener('click', () => showDiff(f.path))
    list.appendChild(li)
  }
}

function statusKind(f) {
  if (f.untracked) return { type: 'added', label: 'A' }
  if (f.worktree === 'D' || f.index === 'D') return { type: 'deleted', label: 'D' }
  return { type: 'modified', label: 'M' }
}

/* ============================================================
   发布 / Diff
   ============================================================ */

async function openPublish() {
  if (!(await ensureSaved())) {
    toast('有未保存的内容，请先保存', 'error')
    return
  }
  await refreshEntries()

  const st = state.status
  if (!st || (st.files.length === 0 && st.ahead === 0)) {
    toast('没有需要发布的改动')
    return
  }

  const diff = await call(window.api.git.diff())
  renderDiff(diff, st)

  $('#modal-commit-msg').value = suggestCommitMessage(st)
  $('#modal-diff').hidden = false
}

function suggestCommitMessage(st) {
  const files = st.files || []
  const added = files.filter((f) => f.untracked).map((f) => f.path)
  const modified = files.filter((f) => !f.untracked).map((f) => f.path)

  const postAdded = added.filter((p) => p.startsWith('posts/'))
  if (postAdded.length === 1) {
    const name = postAdded[0].replace(/^posts\//, '').replace(/\.md$/, '').replace(/\/.*$/, '')
    return `新增文章：${name}`
  }
  if (postAdded.length > 1) return `新增 ${postAdded.length} 篇文章`
  if (modified.length === 1) return `更新：${modified[0].replace(/^posts\//, '')}`
  if (files.length > 0) return `更新 ${files.length} 个文件`
  return '更新内容'
}

function renderDiff(diff, st) {
  const view = $('#diff-view')
  const summary = $('#publish-summary')

  const files = st.files || []
  summary.innerHTML = `<div>共 ${files.length} 个文件改动</div><div class="publish-summary__list"></div>`
  const listEl = summary.querySelector('.publish-summary__list')
  for (const f of files) {
    const s = document.createElement('span')
    s.className = 'publish-summary__file'
    const k = statusKind(f)
    s.textContent = `${k.label} ${f.path}`
    listEl.appendChild(s)
  }

  if (!diff || !diff.trim()) {
    view.textContent = '（无文本差异，可能只是模式变化）'
    return
  }

  view.innerHTML = ''
  for (const line of diff.split('\n')) {
    const div = document.createElement('div')
    div.className = 'diff-line'
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
      div.classList.add('diff-line--meta')
    } else if (line.startsWith('@@')) {
      div.classList.add('diff-line--hunk')
    } else if (line.startsWith('+')) {
      div.classList.add('diff-line--add')
    } else if (line.startsWith('-')) {
      div.classList.add('diff-line--del')
    }
    div.textContent = line || ' '
    view.appendChild(div)
  }
}

/** 查看单个文件的 diff */
async function showDiff(filePath) {
  const diff = await call(window.api.git.diff(filePath))
  const st = { files: [{ path: filePath, untracked: false }] }
  renderDiff(diff, st)
  $('#modal-commit-msg').value = `更新：${filePath}`
  $('#modal-diff').hidden = false
}

async function confirmPublish() {
  const btn = $('#btn-confirm-publish')
  const msg = $('#modal-commit-msg').value.trim() || '更新内容'

  btn.disabled = true
  btn.textContent = '提交中…'

  try {
    const c = await call(window.api.git.commit({ message: msg }))
    if (!c.ok) {
      toast('没有可提交的改动')
      $('#modal-diff').hidden = true
      return
    }

    btn.textContent = '推送中…'
    await call(window.api.git.push())

    toast('已发布，等 GitHub Actions 构建完成即可看到', 'ok')
    $('#modal-diff').hidden = true
    await refreshAll()
  } catch (err) {
    toast(`发布失败：${err.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '确认提交并推送'
  }
}

/* ============================================================
   新建 / 删除
   ============================================================ */

async function newEntry() {
  if (!(await ensureSaved())) return

  const isNote = state.kind === 'note'
  let title = ''
  if (!isNote) {
    title = prompt('文章标题：', '')
    if (title === null) return
    title = title.trim() || '未命名文章'
  }

  try {
    const { id } = await call(
      window.api.post.create({ title, kind: state.kind, date: today() }),
    )
    await refreshEntries()
    await openEntry(id, state.kind)
    if (!isNote) $('#field-title').focus()
  } catch (err) {
    toast(`新建失败：${err.message}`, 'error')
  }
}

async function deleteCurrent() {
  if (!state.current) return
  const name = state.data?.title || state.current.id
  if (!confirm(`确定删除「${name}」？\n\n文件会从磁盘删除，提交前仍可从 git 恢复。`)) return

  try {
    await call(window.api.post.remove(state.current.id, state.current.kind))
    state.current = null
    state.data = null
    state.body = ''
    setDirty(false)
    $('#editor-main').hidden = true
    $('#editor-empty').hidden = false
    await refreshAll()
    toast('已删除', 'ok')
  } catch (err) {
    toast(`删除失败：${err.message}`, 'error')
  }
}

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ============================================================
   事件绑定
   ============================================================ */

let bound = false

function bindAppEvents() {
  if (bound) return
  bound = true

  /* 顶部 */
  $('#btn-refresh').addEventListener('click', async () => {
    await refreshAll()
    toast('已刷新')
  })
  $('#btn-publish').addEventListener('click', openPublish)
  $('#btn-repo-path').addEventListener('click', () => {
    if (state.repoPath) call(window.api.sys.openPath(state.repoPath))
  })

  /* 侧栏 */
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('is-active'))
      tab.classList.add('is-active')
      state.kind = tab.dataset.kind
      state.activeTag = ''
      renderFilters()
      renderEntryList()
    })
  })

  $('#btn-new').addEventListener('click', newEntry)

  $('#search-input').addEventListener(
    'input',
    debounce((e) => {
      state.search = e.target.value
      renderEntryList()
    }, 160),
  )

  /* 表单 */
  $('#field-title').addEventListener('input', (e) => {
    state.data.title = e.target.value
    markDirty()
  })
  $('#field-date').addEventListener('input', (e) => {
    state.data.date = e.target.value
    markDirty()
  })
  $('#field-desc').addEventListener('input', (e) => {
    state.data.description = e.target.value
    markDirty()
  })
  $('#field-category').addEventListener('input', (e) => {
    state.data.category = e.target.value
    markDirty()
  })
  $('#field-cover').addEventListener('input', () => {
    state.data.cover = $('#field-cover').value
    renderCoverPreview()
    markDirty()
  })
  $('#btn-cover-clear').addEventListener('click', () => {
    $('#field-cover').value = ''
    state.data.cover = ''
    renderCoverPreview()
    markDirty()
  })
  $('#field-pinned').addEventListener('change', (e) => {
    state.data.pinned = e.target.checked
    markDirty()
  })
  $('#field-draft').addEventListener('change', (e) => {
    state.data.draft = e.target.checked
    markDirty()
  })

  /* 标签输入 */
  const tagInput = $('#tag-input')
  tagInput.addEventListener('input', renderTagSuggest)
  tagInput.addEventListener('focus', renderTagSuggest)
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      addTag(tagInput.value)
      tagInput.value = ''
      renderTagSuggest()
    } else if (e.key === 'Backspace' && !tagInput.value && state.data.tags?.length) {
      state.data.tags.pop()
      renderTagChips()
      renderTagSuggest()
      markDirty()
    }
  })

  /* Markdown 编辑 */
  const ta = $('#md-input')
  ta.addEventListener('input', () => {
    state.body = ta.value
    markDirty()
    schedulePreview()
  })
  ta.addEventListener('keydown', (e) => {
    // Tab 插入两个空格
    if (e.key === 'Tab') {
      e.preventDefault()
      insertAtCursor(ta, '  ')
      markDirty()
    }
    // Ctrl+S 手动保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveCurrent()
    }
  })

  // 粘贴图片
  ta.addEventListener('paste', async (e) => {
    const items = [...(e.clipboardData?.items || [])]
    const imageItem = items.find((i) => i.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (file) await uploadImages([file])
  })

  // 拖拽图片
  const writePane = ta.closest('.editor__pane--write')
  let dragDepth = 0
  writePane.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    dragDepth++
    writePane.classList.add('is-dragging')
  })
  writePane.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
  })
  writePane.addEventListener('dragleave', () => {
    dragDepth--
    if (dragDepth <= 0) {
      dragDepth = 0
      writePane.classList.remove('is-dragging')
    }
  })
  writePane.addEventListener('drop', async (e) => {
    e.preventDefault()
    dragDepth = 0
    writePane.classList.remove('is-dragging')
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) await uploadImages(files)
  })

  /* 工具栏 */
  $('#btn-insert-image').addEventListener('click', async () => {
    if (!state.current) return toast('请先打开一篇文章', 'error')
    const picked = await call(window.api.image.pick())
    if (!picked || picked.length === 0) return

    for (const f of picked) {
      const r = await call(
        window.api.image.save({
          id: state.current.id,
          kind: state.current.kind,
          name: f.name,
          data: Array.from(f.buffer.data ?? f.buffer),
        }),
      )
      insertImageMarkdown(r.webPath)
    }
    await loadImages()
    await renderPreview()
    markDirty()
  })

  $('#btn-insert-link').addEventListener('click', () => {
    const url = prompt('链接地址：', 'https://')
    if (!url) return
    insertAtCursor($('#md-input'), `[链接文字](${url})`)
    markDirty()
    schedulePreview()
  })

  $('#btn-insert-code').addEventListener('click', () => {
    insertAtCursor($('#md-input'), '\n```js\n\n```\n')
    markDirty()
    schedulePreview()
  })

  $('#btn-outline').addEventListener('click', () => {
    const el = $('#outline')
    el.hidden = !el.hidden
    if (!el.hidden) renderOutline()
  })

  /* 视图切换 */
  $$('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.view-btn').forEach((b) => b.classList.remove('is-active'))
      btn.classList.add('is-active')
      state.view = btn.dataset.view
      $('#editor-body').dataset.view = state.view
    })
  })

  /* 变更面板 */
  $('#btn-close-changes').addEventListener('click', () => {
    $('#changes-panel').hidden = true
  })
  $('#btn-commit').addEventListener('click', openPublish)

  /* 弹窗 */
  $$('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      $('#modal-diff').hidden = true
    })
  })
  $('#btn-confirm-publish').addEventListener('click', confirmPublish)

  /* 快捷键 */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveCurrent()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault()
      newEntry()
    }
    if (e.key === 'Escape') {
      $('#modal-diff').hidden = true
    }
  })

  /* 关闭窗口前保存 */
  window.addEventListener('beforeunload', () => {
    if (state.dirty) saveCurrent(true)
  })
}

/* ============================================================
   预览防抖 / 大纲
   ============================================================ */

const schedulePreview = debounce(() => {
  renderPreview()
  if (!$('#outline').hidden) renderOutline()
}, 220)

async function renderOutline() {
  const el = $('#outline')
  const { headings } = await call(window.api.md.render(state.body))
  el.innerHTML = ''
  if (!headings.length) {
    el.textContent = '（没有标题）'
    return
  }
  for (const h of headings) {
    const item = document.createElement('div')
    item.className = 'outline__item'
    item.dataset.level = h.level
    item.textContent = h.text
    item.title = h.text
    item.addEventListener('click', () => {
      const ta = $('#md-input')
      const idx = state.body.indexOf(h.text)
      if (idx >= 0) {
        ta.focus()
        ta.setSelectionRange(idx, idx + h.text.length)
        // 估算滚动位置
        const ratio = idx / Math.max(1, state.body.length)
        ta.scrollTop = ratio * (ta.scrollHeight - ta.clientHeight)
      }
    })
    el.appendChild(item)
  }
}

/* ============================================================
   启动
   ============================================================ */

;(async () => {
  await initWelcome()
  const dir = await call(window.api.repo.current()).catch(() => null)
  if (dir) {
    state.repoPath = dir
    await enterApp().catch((err) => {
      toast(`打开仓库失败：${err.message}`, 'error')
    })
  }
})()
