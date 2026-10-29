# 开发与验证

本文集中说明源码开发、持续集成、Windows 安装验收与质量评测。日常操作见[官网使用文档](https://llm-reader.maaoding.icu/docs/)，协议参考与历次发布验收见[仓库文档索引](README.md)。

## 开发

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Node.js 范围与 pnpm 固定版本以 [package.json](../package.json) 为准；建议使用符合范围的 Node.js LTS，通过 Corepack 准备项目指定的 pnpm。

`pnpm typecheck` 使用 TypeScript 7 原生编译器（`typescript-compiler` 别名包），启动时会输出实际版本。`typescript-eslint` 尚依赖 TypeScript 的 JavaScript 编译器 API，因此另保留 TypeScript 6 供 lint 使用；类型检查脚本显式指定编译器路径，避免两个包的同名命令产生歧义。

云端 Linux 的 pnpm、Xvfb 与 Wine 初始化命令见[开发环境说明](development-environment.md)，支持无需管理员权限的安装与重复执行。

重装依赖后若 `pnpm dev` 提示 Electron 安装不完整，先手动运行 `node node_modules/electron/install.js` 下载项目固定版本的二进制。云端代理环境的下载方式见[开发环境说明](development-environment.md)。

## 本地验证与打包

渲染层的 `App.tsx` 负责组合工作区、阅读器与会话流程。书籍详情、批量导入、PDF 选区确认、对话展示和窗口控件各自保存在同名组件中。行为模块按职责划分：

| 模块 | 职责 |
| --- | --- |
| `use-app-preferences` | 语言、主题与阅读偏好的持久化 |
| `use-book-import` | 导入事件、取消操作和拖放生命周期 |
| `use-selection-toolbar` | 选区工具栏定位和滚动监听 |
| `use-provider-connection` | 服务配置恢复、连接检查与版本校验，忽略旧服务的检测结果 |
| `use-conversation-requests` | 两路并发、先进先出的请求队列、流式事件和取消清理 |
| `use-conversation-sessions` | 会话恢复、可渲染的加载状态和保存顺序 |
| `use-reader-search` | 书内查询、PDF 索引回退，以及切书和切换阅读模式时的结果失效 |

新增行为应放入对应模块，跨书导航和会话协调继续由应用层组合。请求队列通过取消单个请求、会话或书籍的接口清理任务，应用层不直接修改队列；连接检查通过配置版本接收请求结果，避免旧请求覆盖新服务的状态。异步回归测试使用可控 Promise 验证完成顺序，无需等待固定时长。

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:all
pnpm build:win --publish never
```

`pnpm test:e2e` 会先执行文案校验和应用构建，再运行 Playwright；`pnpm test:all` 依次执行 lint、typecheck、完整单元测试、应用构建与 Playwright，避免重复运行文案测试。`pnpm build:win --publish never` 会在 `release/` 生成未签名的 Windows x64 NSIS 安装包，以及自动更新所需的 `latest.yml` 元数据；更新源在 `electron-builder.yml` 的 `publish` 中配置为 GitHub Releases。

## 持续集成与安装验收

[应用 CI](../.github/workflows/ci.yml) 在推送到 `main`、提交 Pull Request 或手动触发时运行：先在 Linux 执行 lint、typecheck、完整单元测试与应用构建，再在 Windows Server 2025 的 1920×1080 桌面执行完整 Electron E2E。CI 从 `package.json` 安装固定版本的 pnpm，按锁文件安装依赖，并安装 Electron 与 Calibre；桌面测试报告、截图及失败 trace 保留 7 天。测试使用隔离书库、合成资料与本机模拟服务，不调用真实付费接口；需要私有 PDF 的用例仍按原条件跳过。CI 检查源码构建与桌面行为，Windows 安装包、覆盖升级及真实服务质量仍需单独验收。

[Windows 安装验收工作流](../.github/workflows/windows-package-validation.yml)可手动构建未发布的 NSIS 包，验证全新安装、从公开 v1.2.0 覆盖安装及已安装程序的专项回归。

验收已安装版本时，将 `LLM_READER_E2E_EXECUTABLE` 指向安装目录中的 `LLM Reader.exe`，再运行 `pnpm test:e2e:run`。测试仍会为每个用例创建并清理隔离的临时用户数据目录，不会读写日常书库。

`tests/e2e/support/reader-test.ts` 提供带独立启动、清理预算的 Electron fixture，目前用于取材回归。业务断言仍受用例超时约束；窗口启动缓慢或测试失败时，由 fixture 清理隔离进程和资料。PDF 缩放用例等待页面的 `aria-busy` 恢复为 `false` 后再检查文字层，避免把窗口尺寸变化误当成绘制完成。

## 官网与使用文档

官网首页和 VitePress 用户手册使用同一份 GitHub Pages 部署产物：

```powershell
pnpm docs:dev
pnpm site:build
```

`docs:dev` 启动文档预览；`site:build` 将首页与 `/docs/` 生成到 `dist/`，并检查站内链接、资源、锚点和站点地图。`pnpm site:check` 可单独复查已有构建。

文档目录分工、导航维护和发布说明复用方式统一见[文档放在哪里](README.md#文档放在哪里)。新增教程或调整导航后，预览桌面与手机页面，确认搜索和侧栏入口可用。

[Pages 工作流](../.github/workflows/pages.yml)在 PR 中构建检查，合入 `main` 后部署；仅改动文档也会触发。文档工具位于独立的 `@llm-reader/docs` 工作区包，不进入桌面应用运行时依赖。

## 真实服务与质量评测

需要使用日常设置中已保存的真实兼容 API 做发布前冒烟时，运行 `pnpm test:real-api`。该命令不会加入 `test:all`，只在主动运行时发送少量合成测试内容；它会把 Base URL、model、`safeStorage` 加密后的密钥文件及其本机加密上下文复制到临时用户数据目录，不输出或修改密钥，也不复制日常书库，并在结束后清理测试数据。

全书问答对照、重排、文档结构和独立阅读样本的命令与判定方式统一见[质量评测](evaluation.md)。该指南区分条件检查、离线验证、本机模拟、真实服务和人工语义复核；历史分数不作为当前版本的验证结果。
