/**
 * GitHub API 客户端
 *
 * 只调用需要的最小接口：验证 token、读取用户信息、列出仓库。
 * 实际的读写走本地 git，不走 API。
 */

const API = 'https://api.github.com'

async function call(path, token, { method = 'GET' } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'xilan-studio',
    },
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    throw err
  }

  return data
}

/** 验证 token 并返回用户信息 */
export async function getUser(token) {
  const data = await call('/user', token)
  return {
    login: data.login,
    name: data.name || data.login,
    avatar: data.avatar_url,
    htmlUrl: data.html_url,
    publicRepos: data.public_repos,
  }
}

/** 列出用户的仓库，按更新时间排序 */
export async function listRepos(token, { perPage = 100 } = {}) {
  const data = await call(
    `/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator`,
    token,
  )
  return data.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    private: r.private,
    defaultBranch: r.default_branch,
    cloneUrl: r.clone_url,
    sshUrl: r.ssh_url,
    description: r.description || '',
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
  }))
}

/** 读取单个仓库信息 */
export async function getRepo(token, fullName) {
  const data = await call(`/repos/${fullName}`, token)
  return {
    fullName: data.full_name,
    private: data.private,
    defaultBranch: data.default_branch,
    cloneUrl: data.clone_url,
    description: data.description || '',
    htmlUrl: data.html_url,
  }
}

/** 检查仓库是否已经启用 GitHub Pages，以及部署状态 */
export async function getPages(token, fullName) {
  try {
    const data = await call(`/repos/${fullName}/pages`, token)
    return {
      enabled: true,
      url: data.html_url,
      status: data.status,
      buildType: data.build_type,
    }
  } catch (err) {
    if (err.status === 404) {
      return { enabled: false, url: null, status: null, buildType: null }
    }
    throw err
  }
}

/** 最近的工作流运行记录（用来显示部署是否成功） */
export async function listRuns(token, fullName, limit = 5) {
  const data = await call(`/repos/${fullName}/actions/runs?per_page=${limit}`, token)
  return (data.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    branch: r.head_branch,
    createdAt: r.created_at,
    htmlUrl: r.html_url,
    event: r.event,
  }))
}
