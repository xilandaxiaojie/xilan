/**
 * 把 Markdown 字符串渲染成 HTML。
 *
 * 本站的文章放在仓库表层目录（posts/、notes/），不在 src/content 下，
 * 所以不走内容集合 API，而是直接用 Astro 内置的 markdown 处理器渲染，
 * 保证代码高亮、GFM 表格等行为与官方一致。
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import type { AstroMarkdownProcessor } from '@astrojs/markdown-remark'

let processor: AstroMarkdownProcessor | null = null
const cache = new Map<string, RenderedMarkdown>()

/** 与 astro.config.mjs 中 markdown 配置保持一致 */
const MARKDOWN_CONFIG = {
  shikiConfig: {
    themes: {
      light: 'github-light',
      dark: 'github-dark-dimmed',
    },
    wrap: true,
  },
} as const

async function getProcessor() {
  if (!processor) {
    processor = await createMarkdownProcessor(MARKDOWN_CONFIG as any)
  }
  return processor
}

export interface RenderedMarkdown {
  html: string
  headings: { depth: number; slug: string; text: string }[]
}

export async function renderMarkdown(md: string): Promise<RenderedMarkdown> {
  const hit = cache.get(md)
  if (hit) return hit

  const proc = await getProcessor()
  const result = await proc.render(md)

  const out: RenderedMarkdown = {
    html: result.code,
    headings: (result.metadata?.headings ?? []).map((h: any) => ({
      depth: h.depth,
      slug: h.slug,
      text: h.text,
    })),
  }
  cache.set(md, out)
  return out
}
