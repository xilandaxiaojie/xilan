/**
 * 浏览器模式下的 window.api 桥接
 *
 * 把 Electron preload 暴露的 API 用 HTTP 实现一遍，
 * 这样同一套界面代码可以直接在浏览器里跑，便于预览和调试。
 */
;(() => {
  const invoke = async (channel, ...args) => {
    const res = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }),
    })
    return res.json()
  }

  window.api = {
    config: {
      get: () => invoke('config.get'),
      set: (patch) => invoke('config.set', patch),
      clearToken: () => invoke('config.clearToken'),
    },
    auth: {
      // 浏览器模式下不支持真实 GitHub 登录
      login: async () => ({
        ok: false,
        error: '浏览器预览模式不支持登录，请在桌面版使用',
      }),
      repos: async () => ({ ok: true, data: [] }),
      pages: async () => ({ ok: true, data: { enabled: false } }),
      runs: async () => ({ ok: true, data: [] }),
    },
    repo: {
      pick: async () => {
        const dir = prompt('输入仓库的绝对路径：', 'D:\\DSH\\博客')
        if (!dir) return { ok: true, data: null }
        return invoke('repo.use', dir)
      },
      use: (dir) => invoke('repo.use', dir),
      clone: async () => ({ ok: false, error: '浏览器预览模式不支持克隆' }),
      pickCloneDir: async () => ({ ok: true, data: null }),
      current: () => invoke('repo.current'),
      overview: () => invoke('repo.overview'),
    },
    post: {
      read: (id, kind) => invoke('post.read', id, kind),
      save: (payload) => invoke('post.save', payload),
      create: (payload) => invoke('post.create', payload),
      remove: (id, kind) => invoke('post.delete', id, kind),
      rename: (oldId, newId, kind) => invoke('post.rename', oldId, newId, kind),
    },
    image: {
      list: (id, kind) => invoke('image.list', id, kind),
      pick: async () =>
        new Promise((resolve) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.multiple = true
          input.onchange = async () => {
            const files = [...input.files]
            const items = await Promise.all(
              files.map(async (f) => ({
                name: f.name,
                buffer: Array.from(new Uint8Array(await f.arrayBuffer())),
              })),
            )
            resolve({ ok: true, data: items })
          }
          input.click()
        }),
      save: (payload) => invoke('image.save', payload),
      remove: (id, kind, name) => invoke('image.delete', id, kind, name),
      dataUrl: (absPath) => invoke('image.dataUrl', absPath),
    },
    md: {
      render: (text) => invoke('md.render', text),
    },
    git: {
      status: () => invoke('git.status'),
      diff: (p) => invoke('git.diff', p),
      commit: (payload) => invoke('git.commit', payload),
      push: () => invoke('git.push'),
      pull: () => invoke('git.pull'),
      log: (limit) => invoke('git.log', limit),
    },
    sys: {
      openExternal: (url) => invoke('sys.openExternal', url),
      openPath: (p) => invoke('sys.openPath', p),
      paths: () => invoke('sys.paths'),
    },
  }
})()
