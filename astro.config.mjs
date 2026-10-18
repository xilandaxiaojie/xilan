import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// 站点部署在 https://<user>.github.io/xilan/
// 如果在自定义域名或根路径部署，改这里即可。
export const SITE = 'https://xilandaxiaojie.github.io'
export const BASE = '/xilan'

export default defineConfig({
  site: `${SITE}${BASE}`,
  base: BASE,
  trailingSlash: 'ignore',
  publicDir: 'public',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark-dimmed',
      },
      wrap: true,
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    // 表层目录（images/covers/posts/notes）不在 src 下，
    // 让 Vite 不要把 .md 当作需要处理的模块。
    server: {
      fs: { strict: false },
    },
  },
})
