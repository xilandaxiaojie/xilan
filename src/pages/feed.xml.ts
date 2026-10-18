import rss from '@astrojs/rss'
import type { APIContext } from 'astro'
import { getPosts } from '../lib/content'
import { site } from '../config'

export async function GET(context: APIContext) {
  const posts = getPosts()
    .filter((p) => !p.draft)
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  return rss({
    title: site.title,
    description: site.description,
    site: context.site ?? 'https://xilandaxiaojie.github.io/xilan',
    items: posts.map((post) => ({
      title: post.title,
      pubDate: post.date,
      description: post.description ?? '',
      link: `/posts/${post.id}/`,
      categories: post.tags,
    })),
    customData: `<language>zh-CN</language>`,
  })
}
