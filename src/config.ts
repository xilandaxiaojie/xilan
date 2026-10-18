/**
 * 站点全局配置 —— 改这里就能换掉整个站点的身份信息。
 * 每个字段都可以自由替换成你自己的。
 */
export const site = {
  title: 'xilan',
  // 站点副标题，显示在首页 Hero 与页头
  subtitle: '小小空间，大大梦想',
  description: '一个记录动画、代码与日常的小站。',
  introduction:
    '你好，我是 xilan。这里存放我关于动画、游戏、代码和生活的碎碎念。愿你在某个午后路过，能捡到一点点喜欢的东西。',

  author: {
    name: 'xilan',
    // 头像：放在 public/ 下，或换成完整 URL
    avatar: '/assets/avatar.svg',
    bio: '动画 / 游戏 / 代码',
  },

  // 站点语言
  lang: 'zh-CN',
  // 时区，影响日期格式化
  timezone: 'Asia/Shanghai',

  // 页脚箴言
  motto: {
    content: 'Stay hungry. Stay foolish.',
    author: 'Steve Jobs',
  },

  // 社交链接 —— 用 Font Awesome 图标名
  social: [
    { title: 'GitHub', url: 'https://github.com/xilandaxiaojie', icon: 'github' },
    { title: 'RSS', url: '/feed.xml', icon: 'rss' },
  ],

  // 页脚导航
  footerNav: [
    { name: '关于', path: '/about' },
    { name: '归档', path: '/archive' },
    { name: '标签', path: '/tags' },
    { name: 'RSS 订阅', path: '/feed.xml', newtab: true },
  ],

  // 备案（留空则不显示）
  icp: {
    enable: false,
    label: '萌备 20201212 号',
    link: 'https://icp.gov.moe/',
  },
} as const

/**
 * 导航菜单 —— 单字菜单：
 * 源、文、记、览、签、余
 *
 * 搜索不占菜单位：页头右上角的放大镜点开就是搜索框。
 */
export const menu = [
  { title: '源', label: '首页', path: '/', icon: 'dot-circle' },
  { title: '文', label: '博文', path: '/posts', icon: 'glasses' },
  { title: '记', label: '手记', path: '/notes', icon: 'feather-alt' },
  { title: '览', label: '归档', path: '/archive', icon: 'history' },
  { title: '签', label: '标签', path: '/tags', icon: 'tags' },
  { title: '余', label: '关于', path: '/about', icon: 'circle-notch' },
] as const

/**
 * 首页「一言」随机句子
 */
export const sayings = [
  '世界这么大，还是遇见你。',
  '今天也是想成为主角的一天。',
  '如果奇迹有颜色，那一定是初音绿。',
  '把每一天都过成自己喜欢的样子。',
  '代码写完了吗？',
  '愿所有萌新都不再受限于环境配置。',
  '所谓浪漫，就是没有后来。',
]
