/**
 * Git 操作层
 *
 * 通过子进程调用系统 git，不引入重型依赖。
 * 所有函数都是同步的（Node 环境下足够快），失败时抛出带 stderr 的错误。
 */
import { execFileSync } from 'node:child_process'

const GIT = 'git'

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync(GIT, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim()
    const stdout = (err.stdout || '').toString().trim()

    // git diff --no-index 在有差异时退出码为 1，这不是错误，
    // 它的 stdout 正是我们要的 diff 内容。
    // 同理 grep 类场景也可能非零退出但仍有有效输出。
    if (err.status === 1 && stdout) {
      return stdout
    }

    if (allowFail) return null
    const msg = [stderr, stdout].filter(Boolean).join('\n') || err.message
    throw new Error(`git ${args[0]} 失败: ${msg}`)
  }
}

/** git 是否可用 */
export function gitVersion() {
  try {
    return git(process.cwd(), ['--version']).trim()
  } catch {
    return null
  }
}

/** 仓库状态总览 */
export function status(repoPath) {
  // 空仓库（还没有任何提交）时 rev-parse --abbrev-ref HEAD 会失败，
  // 此时退回 symbolic-ref 读分支名。
  let branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })
  if (!branch) {
    branch = git(repoPath, ['symbolic-ref', '--short', 'HEAD'], { allowFail: true })
  }
  branch = branch ? branch.trim() : ''
  // HEAD 指向未创建的分支时会得到 "HEAD"
  if (branch === 'HEAD') branch = ''

  const porcelain = git(repoPath, ['status', '--porcelain=v1', '-uall'], {
    allowFail: true,
  })

  const files = []
  if (porcelain) {
    for (const line of porcelain.split('\n')) {
      if (!line.trim()) continue
      const x = line[0]
      const y = line[1]
      const p = line.slice(3).trim()
      files.push({
        path: p,
        index: x,
        worktree: y,
        // ?? = 未跟踪
        untracked: x === '?' && y === '?',
      })
    }
  }

  // 与远端的分支比较（无 origin 或空仓库时跳过）
  let ahead = 0
  let behind = 0
  const hasOrigin = git(repoPath, ['rev-parse', '--verify', '--quiet', 'origin'], {
    allowFail: true,
  })
  if (branch && hasOrigin) {
    const counts = git(
      repoPath,
      ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`],
      { allowFail: true },
    )
    if (counts) {
      const [b, a] = counts.trim().split(/\s+/).map(Number)
      behind = b || 0
      ahead = a || 0
    }
  }

  const remote = git(repoPath, ['remote', 'get-url', 'origin'], { allowFail: true })

  return {
    branch,
    remote: remote ? remote.trim() : '',
    files,
    dirty: files.length > 0,
    ahead,
    behind,
  }
}

/** 取某个文件相对 HEAD 的 diff；新文件用 --no-index 对比空 */
export function fileDiff(repoPath, filePath) {
  const tracked = git(repoPath, ['ls-files', '--error-unmatch', filePath], {
    allowFail: true,
  })

  if (tracked === null) {
    // 新文件：显示出完整内容
    const diff = git(
      repoPath,
      ['diff', '--no-color', '--no-index', '--', '/dev/null', filePath],
      { allowFail: true },
    )
    return diff || ''
  }

  // 已暂存与未暂存合并，对比 HEAD
  const staged = git(repoPath, ['diff', '--no-color', '--cached', '--', filePath], {
    allowFail: true,
  })
  const unstaged = git(repoPath, ['diff', '--no-color', '--', filePath], { allowFail: true })
  return [staged, unstaged].filter(Boolean).join('\n')
}

/** 全部未提交改动的 diff */
export function fullDiff(repoPath) {
  const tracked = git(repoPath, ['diff', '--no-color', 'HEAD'], { allowFail: true }) || ''
  const statusInfo = status(repoPath)

  // 新文件单独拼接
  const parts = [tracked]
  for (const f of statusInfo.files) {
    if (f.untracked) {
      const d = git(
        repoPath,
        ['diff', '--no-color', '--no-index', '--', '/dev/null', f.path],
        { allowFail: true },
      )
      if (d) parts.push(d)
    }
  }
  return parts.filter(Boolean).join('\n')
}

/** 暂存并提交 */
export function commit(repoPath, message, paths = null) {
  if (paths && paths.length) {
    git(repoPath, ['add', '--', ...paths])
  } else {
    git(repoPath, ['add', '-A'])
  }

  // 没有任何改动时直接返回
  const staged = git(repoPath, ['diff', '--cached', '--name-only'], { allowFail: true })
  if (!staged || !staged.trim()) {
    return { ok: false, reason: 'no-changes' }
  }

  const out = git(repoPath, ['commit', '-m', message])
  return { ok: true, output: out.trim() }
}

/** 推送到 origin */
export function push(repoPath) {
  const branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const out = git(repoPath, ['push', 'origin', branch])
  return out.trim()
}

/** 拉取远端更新 */
export function pull(repoPath) {
  const branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const out = git(repoPath, ['pull', '--ff-only', 'origin', branch])
  return out.trim()
}

/** 最近提交记录 */
export function log(repoPath, limit = 20) {
  const out = git(
    repoPath,
    ['log', `-${limit}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e'],
    { allowFail: true },
  )
  if (!out) return []

  return out
    .split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, author, when, subject] = rec.split('\x1f')
      return { hash, short, author, when, subject }
    })
}

/** 克隆仓库 */
export function clone(url, destPath) {
  git(process.cwd(), ['clone', '--depth', '1', url, destPath])
  return destPath
}

/** 当前分支是否有上游 */
export function hasUpstream(repoPath) {
  const out = git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    allowFail: true,
  })
  return !!out
}
