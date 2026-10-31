# 开发与验证

本文集中说明源码开发、持续集成、Windows 安装验收与质量评测。日常操作见[官网使用文档](https://llm-reader.maaoding.icu/docs/)，协议参考与历次发布验收见[仓库文档索引](README.md)。

## 开发

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Node.js 范围与 pnpm 固定版本以 [package.json](../package.json) 为准；建议使用符合范围的 Node.js LTS，通过 Corepack 准备项目指定的 pnpm。

验证时默认使用命令级 `pnpm --config.verify-deps-before-run=error <命令>`，例如 `pnpm --config.verify-deps-before-run=error lint:files src/renderer/src/llm-event-buffer.ts`。当前 pnpm 默认可在执行脚本前补齐依赖，此选项改为依赖不匹配即报错，避免验证顺带安装或修复环境。若仅工作区元数据不匹配，核对所需本地工具及版本后，可单次使用 `--config.verify-deps-before-run=false` 执行定向检查，单独报告环境预检查未通过；缺少工具或版本不符时不自动安装。这些选项不改变永久配置，下文命令省略这个运行前缀。

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
| `llm-event-buffer` | 对话与工作台共用的流式片段合并、控制事件顺序和缓冲清理 |

新增行为应放入对应模块，跨书导航和会话协调继续由应用层组合。请求队列通过取消单个请求、会话或书籍的接口清理任务，应用层不直接修改队列；连接检查通过配置版本接收请求结果，避免旧请求覆盖新服务的状态。异步单测使用可控 Promise 验证完成顺序，计时逻辑使用模拟时钟，避免固定等待；Electron E2E 等待可观察的页面或请求状态。

流式订阅使用 `subscribeToBufferedLlmEvents`：先检查请求归属，立即发布每批的首个片段，其余片段按 32 毫秒窗口合并。完成、错误、引用上下文等控制事件前会先发布该请求的缓冲文本；取消请求或关闭应用也必须先调用 `flush`，再移除请求、保存会话。缓冲区只合并文本，业务状态和保存规则仍由对应的 hook 管理。

`AnswerText` 按来源数组复用引用索引，摘录仅在第一次引用时计算，扫描到显示长度就停止；语言相关标签在渲染时生成。替换来源应使用新的数组，以便更新索引。

### 按影响范围验证

日常开发按最终改动选择相关检查，涉及多个范围时补齐对应验证，不需要逐层重复运行。普通任务收尾、提交或推送沿用本次适用层级；完整回归和安装验收由改动风险及交付目标触发。

| 改动类型 | 默认验证 |
| --- | --- |
| 内部文档 | 核对代码依据、术语、命令、相对链接、编码与最终差异，运行 `git diff --check`；被忽略的本地文档另做修改前后比较 |
| 应用文案 | `pnpm copy:check`；影响布局时补相关页面检查，修改类型化 key 时按代码验证 |
| 局部代码 | `pnpm lint:files <源码及测试文件…>` 加相关单测；TS/TSX 或类型契约变化执行 `pnpm typecheck` |
| 桌面交互 | 相关代码检查加受影响场景的 Electron E2E，复用同一源码的构建 |
| IPC、安全、迁移、保存恢复等关键链路 | 全量 `pnpm lint`、`pnpm typecheck`、`pnpm test`，加受影响链路 E2E |
| 正式版本、广泛基础设施重构、构建机制或核心依赖变化 | `pnpm test:all`；明确交付 Windows 安装包时另执行 `pnpm build:win --publish never` 及安装/升级验收 |

局部 UI 修改通过 Playwright `_electron` 实际启动应用，只检查受影响页面的截图与交互，至少覆盖 1180×800 浅色/100% 和 940×600 深色/125%。公共主题、布局或缩放改动覆盖两种主题、两种窗口尺寸及 100%/125% 的组合；不因局部改动遍历所有页面。可用 `LLM_READER_E2E_IMPORT=<书籍文件>` 自动导入合成测试书籍。

仅增补验证命令别名时，检查参数传递、目标筛选与退出码，无需因此运行完整应用回归。已通过且相关输入未变的结果可在本轮复用；后续修改只补跑受影响检查。报告所选范围、实际结果和未验证项，定向通过不代表完整回归通过，全量失败后的定向重跑也不改变原全量结果。

### 定向命令

下面以流式缓冲模块为例，显式传入源码与测试文件。TS/TSX 变化仍使用项目 `typecheck`，不以单文件编译或裸 `tsc` 替代：

```powershell
pnpm lint:files src/renderer/src/llm-event-buffer.ts tests/unit/ui-llm-event-buffer.test.ts
pnpm typecheck
pnpm test:related src/renderer/src/llm-event-buffer.ts
```

已知需要验证的测试时，可用 `pnpm test tests/unit/ui-llm-event-buffer.test.ts` 直接选择，也支持多个文件和 `-t` 用例名称筛选。两种单测入口按需选择，不必对相同用例重复运行。

`lint:files` 调用 ESLint，`test:related` 调用 `vitest related --run --passWithNoTests=false`；两者都应显式提供文件参数，不按 Git 改动自动推导范围。`test:related` 只追踪静态导入，无法覆盖读文件、动态加载和 IPC 的全部影响，需要显式补选相关测试。当前 Vitest 的 related 模式默认允许零关联测试成功，脚本显式关闭这一默认值；未匹配测试时检查路径及覆盖缺口，不覆盖为 `true` 把空跑报告为通过。

E2E 首次运行或应用、资源、构建输入变化后，先构建一次，再按文件运行：

```powershell
pnpm build:app
pnpm test:e2e:run tests/e2e/about-panel.spec.ts
```

构建对应的输入未变时，后续直接使用 `test:e2e:run`，支持多个文件和 `-g` 用例名称筛选。仅修改测试文件无需重建应用；不确定构建是否对应当前源码时重新构建。只核对选择范围可附加 `--list`，它不启动 Electron，也不证明桌面行为通过。

### 完整回归与打包

`pnpm test:all` 依次执行 lint、typecheck、完整单元测试、应用构建与全量 Playwright，单测已经包含文案校验。`pnpm test:e2e` 自带文案校验和应用构建，用于需要重新构建的桌面回归；不要在同一轮已完成这些步骤后重复执行。

仅相关热点改动运行 `pnpm bench:renderer`，复现长段引用摘录及 1,000 个连续片段触发的 Markdown 解析工作。基线保留自 `4294da5` 的处理方式，先验证最终文本一致，再比较耗时；原始统计写入 `output/benchmarks/renderer/`。突发片段场景的状态更新由 1,000 次减为 2 次，实际流的合并比例取决于片段到达间隔。微基准只反映这些处理步骤的 CPU 成本，不含网络、IPC 和窗口绘制时间。

明确交付 Windows 安装包时运行 `pnpm build:win --publish never`，在 `release/` 生成未签名的 Windows x64 NSIS 安装包，以及自动更新所需的 `latest.yml` 元数据；更新源在 `electron-builder.yml` 的 `publish` 中配置为 GitHub Releases。源码任务不默认打包；构建成功不代表解包程序、NSIS 安装/升级或真实服务质量已验收，这些层级分别记录。验证命令不授权提交、推送或发布。

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

`docs:dev` 启动文档预览；`site:build` 将首页与 `/docs/` 生成到 `dist/`，并检查站内链接、资源、锚点和站点地图。官网页面、导航、资源、被手册 include 引用的内容或网站构建配置变化时执行 `site:build`；只修改产品契约、项目约定或仓库开发指南时按内部文档验证，不默认构建官网。`pnpm site:check` 可单独复查输入未变的已有构建，不能代替对已修改网站内容的重新构建。

文档目录分工、导航维护和发布说明复用方式统一见[文档放在哪里](README.md#文档放在哪里)。新增教程或调整导航后，预览桌面与手机页面，确认搜索和侧栏入口可用。

[Pages 工作流](../.github/workflows/pages.yml)按配置的路径筛选在 PR 中构建检查，合入 `main` 后部署；`docs/**` 下的内部指南修改也会触发。这里的本地验证分层不改变 CI 触发规则。文档工具位于独立的 `@llm-reader/docs` 工作区包，不进入桌面应用运行时依赖。

## 真实服务与质量评测

需要使用日常设置中已保存的真实兼容 API 做发布前冒烟时，经用户明确授权后运行 `pnpm test:real-api`。该命令不会加入 `test:all`，只在主动运行时发送少量合成测试内容；它会把 Base URL、model、`safeStorage` 加密后的密钥文件及其本机加密上下文复制到临时用户数据目录，不输出或修改密钥，也不复制日常书库，并在结束后清理测试数据。

全书问答对照、重排、文档结构和独立阅读样本的命令与判定方式统一见[质量评测](evaluation.md)。该指南区分条件检查、离线验证、本机模拟、真实服务和人工语义复核；历史分数不作为当前版本的验证结果。
