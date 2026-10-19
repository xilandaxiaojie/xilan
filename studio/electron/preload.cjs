/**
 * Preload：向渲染进程暴露有限的白名单 API
 *
 * 所有调用返回 Promise<{ ok, data?, error? }>，
 * 渲染进程统一通过 invoke 处理。
 */
const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => invoke('config:get'),
    set: (patch) => invoke('config:set', patch),
    clearToken: () => invoke('config:clearToken'),
  },

  auth: {
    login: (token) => invoke('auth:login', token),
    repos: () => invoke('auth:repos'),
    pages: (fullName) => invoke('auth:pages', fullName),
    runs: (fullName) => invoke('auth:runs', fullName),
  },

  repo: {
    pick: () => invoke('repo:pick'),
    use: (dir) => invoke('repo:use', dir),
    clone: (payload) => invoke('repo:clone', payload),
    pickCloneDir: () => invoke('repo:pickCloneDir'),
    current: () => invoke('repo:current'),
    overview: () => invoke('repo:overview'),
  },

  post: {
    read: (id, kind) => invoke('post:read', id, kind),
    save: (payload) => invoke('post:save', payload),
    create: (payload) => invoke('post:create', payload),
    remove: (id, kind) => invoke('post:delete', id, kind),
    rename: (oldId, newId, kind) => invoke('post:rename', oldId, newId, kind),
  },

  image: {
    list: (id, kind) => invoke('image:list', id, kind),
    pick: () => invoke('image:pick'),
    save: (payload) => invoke('image:save', payload),
    remove: (id, kind, name) => invoke('image:delete', id, kind, name),
    dataUrl: (absPath) => invoke('image:dataUrl', absPath),
  },

  md: {
    render: (text) => invoke('md:render', text),
  },

  git: {
    status: () => invoke('git:status'),
    diff: (filePath) => invoke('git:diff', filePath),
    commit: (payload) => invoke('git:commit', payload),
    push: () => invoke('git:push'),
    pull: () => invoke('git:pull'),
    log: (limit) => invoke('git:log', limit),
  },

  sys: {
    openExternal: (url) => invoke('sys:openExternal', url),
    openPath: (p) => invoke('sys:openPath', p),
    paths: () => invoke('sys:paths'),
  },
})
