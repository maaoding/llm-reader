<p align="center">
  <img src="resources/icon.png" alt="LLM Reader icon" width="128" />
</p>

<h1 align="center">LLM Reader</h1>

<p align="center">本地优先、以 LLM 辅助理解复杂非虚构内容为核心的 Windows 桌面阅读器。</p>

<p align="center">项目主页：<a href="https://llm-reader.maaoding.icu/">https://llm-reader.maaoding.icu/</a></p>

## 当前状态

### 书库与阅读

- 导入无 DRM 的 EPUB、UTF-8 TXT 或 PDF；本机已安装 Calibre 时，也可将无 DRM 的 MOBI/AZW3 转换为 EPUB 后导入。支持文件多选与整窗拖拽，一次最多批量导入 300 个文件：逐本顺序处理、单项失败不中断批次，可随时取消，完成后显示汇总。文件复制到应用数据目录并按 SHA-256 去重，重复导入会直接打开已有书籍。单文件导入上限为 250 MB，其中 TXT 为 64 MB。
- 左侧提供书库、可折叠的层级目录和本书句段收藏三个视图；EPUB 书籍显示封面（大书库按可见范围懒加载），并可打开书籍信息查看格式、文件大小、语言、出版社、出版日期、简介等元数据。
- 书籍详情页支持删除书籍；删除会同时清理本地书籍文件、封面缓存、句段收藏与归档回答，且无法恢复。
- 连续滚动阅读并恢复上次自然阅读位置；目录、句段收藏与回答内引用的跳转不会覆盖该位置。PDF 以连续页方式阅读，支持适合宽度、缩放、页码进度与单页文字选择。
- 支持在本书内全文搜索，命中可逐个跳转且不破坏自然阅读位置。
- 标题栏显示当前章节与本章阅读进度；阅读区提供独立于界面主题的浅色、米黄、深色纸张主题。
- 阅读设置可调整正文字号（80%–140%）、系统字体、行间距、首行缩进、正文宽度与段落间距。

### 划词与助手

- 选中原文后可“解释这段”“联系上下文”“自由提问”或“收藏”；前三种操作的名称、图标与固定提示词可在设置中自定义。
- 句段收藏在原文持久高亮，可从左侧“收藏”栏跳回原文。
- 应用把选区与最多 6,000 个 Unicode 字符的当前章节上下文发送给用户配置的 `/v1/chat/completions` 兼容接口；追问时还会附带裁剪后的近期对话历史。
- 回答流式显示，支持停止生成与追问；引用可跳回原文，不在本次上下文中的引用会标记为未验证。
- 有价值的回答可手动归档为本地会话；放大按钮打开助手工作台，工作台内可在“对话”与“归档”之间切换，跨书查看全部归档并继续追问、保留历史与原文位置。
- 归档支持按书名、作者、引用或回答搜索，并可导出全部、当前书籍或单条归档为 Markdown。

### 设置与安全

- 界面主题支持浅色、深色与跟随系统，界面缩放可选 90%、100%、110%、125%。
- 模型设置支持保存多套命名配置并随时切换，可从接口拉取模型列表辅助填写；保存后可测试连接，设置入口显示 API 连接状态。
- 应用支持自动更新：启动时静默检查，设置中可手动检查并下载更新，重启后完成安装；更新经 GitHub Releases 分发，安装前校验更新包完整性。
- 书籍、自然阅读位置、句段收藏、回答归档（含追问历史）与模型设置保存在本机 SQLite（`node:sqlite`）。
- API Key 由 Electron `safeStorage` 加密后写入独立密文文件，不进入 SQLite、日志或渲染进程持久状态。
- Renderer 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；窗口创建、导航、权限请求和外部网络请求均被拒绝，EPUB 内容按不可信输入处理。

## 开发

```powershell
pnpm install
pnpm dev
```

开发环境需要 Node.js 24+ 与 pnpm 11+。

重装依赖后若 `pnpm dev` 报 `Error: Electron uninstall`，是 Electron 二进制的 postinstall 下载未执行，手动运行 `node node_modules\electron\install.js` 即可。

首次使用时在左侧栏底部打开“设置”，填写 Base URL、API Key 和 model。应用会请求该地址下的 `/v1/chat/completions`；远程接口必须使用 HTTPS，仅 `localhost`、`127.0.0.1` 与 `::1` 允许 HTTP。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:all
pnpm build:win
```

`pnpm test:e2e` 会先执行文案校验和应用构建，再运行 Playwright；`pnpm test:all` 依次执行 lint、typecheck、完整单元测试、应用构建与 Playwright，避免重复运行文案测试。`pnpm build:win` 会在 `release/` 生成未签名的 Windows x64 NSIS 安装包，以及自动更新所需的 `latest.yml` 元数据；更新源在 `electron-builder.yml` 的 `publish` 中配置为 GitHub Releases。

验收已安装版本时，将 `LLM_READER_E2E_EXECUTABLE` 指向安装目录中的 `LLM Reader.exe`，再运行 `pnpm test:e2e:run`。测试仍会为每个用例创建并清理隔离的临时用户数据目录，不会读写日常书库。

需要使用日常设置中已保存的真实兼容 API 做发布前冒烟时，运行 `pnpm test:real-api`。该命令不会加入 `test:all`，只在主动运行时发送少量合成测试内容；它会把 Base URL、model、`safeStorage` 加密后的密钥文件及其本机加密上下文复制到临时用户数据目录，不输出或修改密钥，也不复制日常书库，并在结束后清理测试数据。

## 许可证

LLM Reader 依据 [GPL-3.0-or-later](https://spdx.org/licenses/GPL-3.0-or-later.html) 发布。

Copyright (C) 2026 wrh37

完整条款见 `LICENSE`；第三方组件许可见 `THIRD_PARTY_NOTICES.md`。

源码仓库：https://github.com/maaoding/llm-reader

产品边界见 `PRODUCT.md`。
