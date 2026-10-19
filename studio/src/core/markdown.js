/**
 * 轻量 Markdown 渲染器
 *
 * 目标不是 100% 兼容 CommonMark，而是让预览效果接近博客实际样子：
 * 标题、粗斜体、代码高亮块、列表、引用、表格、链接、图片、任务列表。
 * 无第三方依赖，浏览器与 Node 通用。
 */

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 行内元素 */
function inline(text) {
  let out = escapeHtml(text)

  // 行内代码，先处理避免被其他规则破坏
  const codes = []
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code class="md-code-inline">${code}</code>`)
    return `\u0000CODE${codes.length - 1}\u0000`
  })

  // 图片 ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    const t = title ? ` title="${title}"` : ''
    return `<img src="${src}" alt="${alt}"${t} loading="lazy">`
  })

  // 链接 [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, text2, href, title) => {
    const t = title ? ` title="${title}"` : ''
    const ext = /^https?:\/\//.test(href)
    const extra = ext ? ' target="_blank" rel="noopener"' : ''
    return `<a href="${href}"${t}${extra}>${text2}</a>`
  })

  // 自动链接
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => {
    return `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  })

  // 粗体 / 斜体 / 删除线
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  out = out.replace(/==([^=]+)==/g, '<mark>$1</mark>')

  // 高亮标记 ==text== 已在上面处理
  // 行内代码还原
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codes[Number(i)])

  return out
}

/** 代码高亮：极简语法着色，够用即可 */
function highlight(code, lang) {
  const esc = escapeHtml(code)

  if (!lang) return esc

  const rules = {
    js: [
      [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="tok-com">$1</span>'],
      [/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '<span class="tok-str">$&</span>'],
      [
        /\b(const|let|var|function|return|if|else|for|while|class|new|await|async|import|export|from|try|catch|throw|typeof|instanceof|of|in)\b/g,
        '<span class="tok-kw">$1</span>',
      ],
      [/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>'],
    ],
    ts: null,
    json: [
      [/(["'])(?:\\.|(?!\1)[^\\])*\1/g, '<span class="tok-str">$&</span>'],
      [/\b(true|false|null|\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>'],
    ],
    css: [
      [/\/\*[\s\S]*?\*\//g, '<span class="tok-com">$&</span>'],
      [/([.#][\w-]+)/g, '<span class="tok-kw">$1</span>'],
      [/([\w-]+)(\s*:)/g, '<span class="tok-attr">$1</span>$2'],
    ],
    html: [
      [/(&lt;\/?)([\w-]+)/g, '$1<span class="tok-kw">$2</span>'],
      [/([\w-]+)=(&quot;.*?&quot;)/g, '<span class="tok-attr">$1</span>=<span class="tok-str">$2</span>'],
    ],
    bash: [
      [/(#[^\n]*)/g, '<span class="tok-com">$1</span>'],
      [/(^|\n)(\s*)([\w.-]+)/g, '$1$2<span class="tok-kw">$3</span>'],
    ],
    md: [
      [/^(#{1,6}\s.+)$/gm, '<span class="tok-kw">$1</span>'],
      [/(\*\*[^*]+\*\*)/g, '<span class="tok-str">$1</span>'],
    ],
  }

  const key = lang.toLowerCase()
  const rule = rules[key] ?? (key === 'ts' ? rules.js : null)
  if (!rule) return esc

  let out = esc
  // 用一个占位技巧避免重复替换：逐条应用，已包裹的不动
  for (const [re, rep] of rule) {
    out = out.replace(re, (m, ...args) => {
      if (m.includes('class="tok-')) return m
      return typeof rep === 'string'
        ? rep.replace(/\$(\d+|&)/g, (_, g) => (g === '&' ? m : args[Number(g) - 1] ?? ''))
        : m
    })
  }
  return out
}

/** 主渲染 */
export function renderMarkdown(src) {
  if (!src) return ''

  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  const html = []
  const headings = []

  let i = 0
  let para = []

  const flushPara = () => {
    if (para.length === 0) return
    html.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }

  while (i < lines.length) {
    const line = lines[i]

    /* ---- 围栏代码块 ---- */
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/)
    if (fence) {
      flushPara()
      const marker = fence[1]
      const lang = fence[2] || ''
      const buf = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏
      const code = buf.join('\n')
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      html.push(
        `<div class="md-code"><div class="md-code-head">${lang ? `<span>${escapeHtml(lang)}</span>` : '<span>代码</span>'}<button class="md-copy" data-copy>复制</button></div><pre><code${cls}>${highlight(code, lang)}</code></pre></div>`,
      )
      continue
    }

    /* ---- 空行 ---- */
    if (!line.trim()) {
      flushPara()
      i++
      continue
    }

    /* ---- 标题 ---- */
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushPara()
      const level = h[1].length
      const text = h[2].trim()
      const id = text
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-')
      headings.push({ level, text, id })
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`)
      i++
      continue
    }

    /* ---- 分隔线 ---- */
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara()
      html.push('<hr>')
      i++
      continue
    }

    /* ---- 引用 ---- */
    if (/^\s*>/.test(line)) {
      flushPara()
      const buf = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      html.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`)
      continue
    }

    /* ---- 表格 ---- */
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushPara()
      const parseRow = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())

      const head = parseRow(line)
      const align = lines[i + 1]
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => {
          const t = c.trim()
          if (/^:-+:$/.test(t)) return 'center'
          if (/^-+:$/.test(t)) return 'right'
          return 'left'
        })

      i += 2
      const rows = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        rows.push(parseRow(lines[i]))
        i++
      }

      const th = head
        .map((c, idx) => `<th style="text-align:${align[idx] || 'left'}">${inline(c)}</th>`)
        .join('')
      const tb = rows
        .map(
          (r) =>
            `<tr>${r
              .map(
                (c, idx) =>
                  `<td style="text-align:${align[idx] || 'left'}">${inline(c)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')

      html.push(
        `<div class="md-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`,
      )
      continue
    }

    /* ---- 列表 ---- */
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
    if (listMatch) {
      flushPara()
      const ordered = /\d+\./.test(listMatch[2])
      const items = []
      let startNum = ordered ? parseInt(listMatch[2], 10) : 1

      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
        if (!m) {
          // 续行
          if (
            items.length > 0 &&
            lines[i].trim() &&
            /^\s{2,}/.test(lines[i]) &&
            !/^(\s*)([-*+]|\d+\.)\s/.test(lines[i])
          ) {
            items[items.length - 1].text += ' ' + lines[i].trim()
            i++
            continue
          }
          break
        }
        let text = m[3]
        let task = null
        const taskMatch = text.match(/^\[([ xX])\]\s+(.*)$/)
        if (taskMatch) {
          task = taskMatch[1].toLowerCase() === 'x'
          text = taskMatch[2]
        }
        items.push({ text, task, indent: m[1].length })
        i++
      }

      const tag = ordered ? 'ol' : 'ul'
      const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : ''
      const body = items
        .map((it) => {
          if (it.task !== null) {
            const checked = it.task ? ' checked' : ''
            return `<li class="md-task"><input type="checkbox" disabled${checked}><span>${inline(it.text)}</span></li>`
          }
          return `<li>${inline(it.text)}</li>`
        })
        .join('')
      html.push(`<${tag}${startAttr}>${body}</${tag}>`)
      continue
    }

    /* ---- 普通段落 ---- */
    para.push(line.trim())
    i++
  }

  flushPara()
  return html.join('\n')
}

/** 提取标题作为大纲 */
export function extractHeadings(src) {
  const out = []
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  let inCode = false

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      const text = m[2].trim()
      out.push({
        level: m[1].length,
        text,
        id: text
          .toLowerCase()
          .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
          .trim()
          .replace(/\s+/g, '-'),
      })
    }
  }
  return out
}
