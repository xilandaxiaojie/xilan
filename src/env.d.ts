/// <reference types="astro/client" />

declare global {
  interface Window {
    /** 站点 base 路径，由 BaseLayout 注入（例如 "/xilan"） */
    __XILAN_BASE__?: string
  }
}

export {}
