import { defineConfig } from 'vitepress'

const origin = 'https://llm-reader.maaoding.icu'

export default defineConfig({
  lang: 'zh-CN',
  title: 'LLM Reader',
  titleTemplate: ':title · LLM Reader',
  description: 'LLM Reader 使用文档：安装、阅读、配置模型、PDF 与 OCR，以及用原文核对回答。',
  base: '/docs/',
  srcDir: 'manual',
  cleanUrls: false,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/docs/icon-64.png' }],
    ['meta', { name: 'theme-color', content: '#f7f8f6' }],
    ['meta', { property: 'og:site_name', content: 'LLM Reader 使用文档' }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }]
  ],
  sitemap: { hostname: `${origin}/docs/` },
  transformHead({ pageData }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '.html')
    return [['link', { rel: 'canonical', href: `${origin}/docs/${path}` }]]
  },
  themeConfig: {
    logo: { src: '/icon-64.png', alt: '' },
    siteTitle: 'LLM Reader',
    nav: [
      { text: '官网', link: `${origin}/` },
      { text: '使用文档', link: '/' },
      { text: '更新日志', link: '/changelog' },
      { text: '开发者资料', link: 'https://github.com/maaoding/llm-reader/blob/main/docs/README.md' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '文档首页', link: '/' },
          { text: '快速开始', link: '/getting-started' },
          { text: '书库与阅读', link: '/reading' },
          { text: '配置问答模型', link: '/models' }
        ]
      },
      {
        text: '问答与笔记',
        items: [
          { text: '提问与核对引用', link: '/asking' },
          { text: '章节笔记与问答集', link: '/notes' }
        ]
      },
      {
        text: '可选增强',
        items: [
          { text: 'PDF 解析与 OCR', link: '/pdf' },
          { text: '阅读增强与联网搜索', link: '/enhancements' }
        ]
      },
      {
        text: '帮助与更新',
        items: [
          { text: '数据、隐私与费用', link: '/privacy' },
          { text: '常见问题', link: '/faq' },
          { text: '更新日志', link: '/changelog' }
        ]
      }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/maaoding/llm-reader' }],
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            tokenize: (text) => Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
              .filter((part) => part.isWordLike)
              .map((part) => part.segment)
          }
        },
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细内容',
                resetButtonTitle: '清空搜索',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有找到相关内容',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
              }
            }
          }
        }
      }
    },
    outline: { label: '本页内容', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '文档目录',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '切换主题',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    skipToContentLabel: '跳到正文',
    editLink: {
      pattern: 'https://github.com/maaoding/llm-reader/edit/main/docs/manual/:path',
      text: '在 GitHub 上改进此页'
    },
    footer: { message: 'GPL-3.0-or-later', copyright: '© 2026 LLM Reader' },
    notFound: { title: '没有找到这篇文档', quote: '可以从文档首页继续，或使用搜索查找操作说明。', linkText: '返回文档首页' }
  }
})
