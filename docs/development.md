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

单书与工作台的原文来源，以及各页面的网页来源使用 `DeferredDetails`，首次展开前不挂载明细，展开后保留子组件状态。工作台的书籍选择列表关闭时停止筛选并卸载，查询和已选书籍保留在外层状态；重新展开仍复用封面缓存。检查来源明细前先展开对应面板。`ui-deferred-details.test.tsx` 与 `ui-answer-rendering.test.tsx` 覆盖延迟读取、重复展开、关闭期间的空列表、查询恢复、语言变化和最新导航。

PDF 的自然位置与缩放锚点由 `pdfReadingPosition` 定位。适配器只保留页索引提示，每次重新读取当前 DOM 边界；仍在原页时直接命中，跳远时按有序页面二分查找。页间空隙选择最近页，距离相同、共享边界和折叠后的零高度布局沿用先前页优先；不缓存跨布局的几何坐标。`pdf-navigation.test.ts` 对照原线性算法并检查读取次数，渲染基准另比较 5,000 页合成边界的跳页与连续阅读。合成边界不包含浏览器布局耗时，不作为整本 PDF 的打开速度或帧率保证。

EPUB 的取材范围通过 `rangeForCodePointSlice` 在一次文本节点遍历中定位起止点，找到两端后停止；不收集未使用的节点，也不展开整段字符数组。码点偏移转为原生 Range 所需的 UTF-16 偏移，保留前导空白、节点边界与 CFI 位置。`readers-dom-text.test.ts` 对照原算法检查 Unicode、空节点和越界行为，并检查访问次数；`dom-range.bench.ts` 在 jsdom 中比较多节点与长文本的前缀定位，不代表浏览器布局或整本 EPUB 的性能。

TXT 持久摘录高亮先检查原生 CSS Highlight 能力。支持时仅构建文字范围；备用段落着色的元素集合只在缺少构造器或注册表时填充，避免跨段摘录重复遍历覆盖的全部段落。`readers-text-highlights.test.ts` 检查长书中的元素访问次数、重叠回退着色、无效锚点清理，以及纯文本与 Markdown 切换后的原生范围；访问计数不包含范围构造和浏览器绘制耗时。

PDF 文字模型通过 `pdfTextOffset` 在有序文本区段中二分定位，再检查同一坐标上的共享边界，保留起止偏向与自动换行空格的映射。`readers-pdf-text-mapping.test.ts` 对照原线性算法检查所有边界、无效偏移、Unicode 原文锚点及切片，并限制区段字段读取次数。渲染基准比较 10,001 个合成区段中的两种映射方向，不包含 PDF 解析、排版或窗口绘制耗时。

PDF 短摘录扫描到所需码点边界后，只为选中部分建立字符数组并复制成独立字符串；空范围直接返回，完整页面保留一次字符迭代的复制路径。`readers-pdf-text-slices.test.ts` 对照原字符数组切片，覆盖代理对跨文本项、组合字符、空白与换行，并限制扫描和复制范围。渲染基准分别检查 100,000 码点页面的前部、深部和整页摘录；深部选区仍需扫描前缀，基准不代表整应用性能。

TXT/PDF/EPUB 的本地搜索扫描在每个排队任务内复用一个应用查询表达式，切换段落、页面、节点或 EPUB 摘录前重置 `lastIndex`。表达式归属该任务，保留版本检查、让出执行权和 200 条上限；EPUB 的计数与限量扫描也重置起点。`readers-search-patterns.test.ts` 检查构造次数、字面符号、大小写、顺序、上限和可控异步让出后的过期丢弃。渲染基准比较 5,000 个合成文本块的零命中和稀疏命中；计数限于应用扫描阶段，不含来源高亮渲染或 epub.js 内部搜索。

搜索聚焦 effect 使用阅读页、侧栏打开和搜索面板三个条件，确保收起的侧栏解除 `inert` 后再聚焦。重复打开已经可见的搜索面板时，应用直接聚焦当前输入框。桌面搜索用例覆盖切换主题和缩放后的 Ctrl+F、字面查询、200 条上限、再次查询与高亮跳转。

Markdown 原文锚点通过段落的 `point` 映射到原生文本节点与 UTF-16 偏移，先二分定位有序文本段，再二分定位字符边界，保留起止偏向和格式标记间隙的规则。`readers-markdown-point.test.ts` 对照旧逐字算法检查 Unicode、实体、代码、表格与空块，并限制长段落长度读取和反转数组。反向的 `sourceOffset` 按有序可见区间二分定位文本段，在共享边界上分别选择后段的起点和前段的终点；`readers-markdown-offset.test.ts` 使用独立原文坐标检查实体、代理对、转义、代码、空块和无效位置，并限制段列表读取与反转。`dom-range.bench.ts` 分别比较 100,000 码点段落和 2,000 个行内文本段的两种映射方向与起止偏向；这些 jsdom 基准不包含浏览器布局，也不代表整应用性能。

Markdown 划词通过 `sourceOffsetForPoint` 将原生端点转换为原文坐标。渲染时用 `WeakMap` 为每个非空文本节点记录已有文本段，段内有效整数端点复用可见偏移，避免为了计数而拼接段首到端点的文字。元素端点、未映射或已脱离段落的节点，以及需要 DOM 偏移转换的输入保留 Range 路径；模式切换重新建立映射。`readers-markdown-selection.test.ts` 对照旧 Range 路径检查原文坐标与异常，并验证实际适配器保留选中文字和 6,000 码点取材上限。微基准覆盖长文本和行内多段选区，仅计位置转换，不含选中文字读取、映射建立、取材或绘制成本。

TXT 的选区取材通过 `ContextBlock.codePointLength` 传递当前段落的 `end - start`，复用解析时已计算的原文码点长度；纯文本和 Markdown 都使用各自当前段落的原文范围。取材器检查长度是否为安全整数并符合 UTF-16 长度的可能范围，缺失或明显无效时继续计数。该字段只由本地解析结果提供，不采信书籍中声明的长度，不增加持久缓存；已有调用者可不提供它。`readers-context-lengths.test.ts` 对照计数路径核对混合长度、空段、Unicode、惰性章节访问和实际划词。渲染基准比较十万码点段落的开头与中部取材，深部截取仍扫描所需前缀，耗时不包含段落解析、选区端点定位或绘制。

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

仅相关热点改动运行 `pnpm bench:renderer`，复现长段引用摘录、来源列表前 60 个码点预览，以及 1,000 个片段触发的 Markdown 解析工作。旧引用摘录和同步突发基线保留自 `4294da5` 的处理方式；来源预览比较全段字符数组与限量读取。先核对最终文本一致，再比较耗时；原始统计写入 `output/benchmarks/renderer/`。

流式基准同时覆盖同步突发和每隔 10/50 毫秒投递的合成片段，仅对投递定时器使用模拟时钟，CPU 计时保持真实。当前样本分别发布 2/500/1,000 次更新，不能把同步突发的 2 次当作真实服务保证。耗时包含模拟定时器调度，不含实际等待、网络、IPC、React 布局和窗口绘制。`ui-answer-rendering.test.tsx` 另验证单书与工作台更新活动回答时不重绘 20 条历史回答，以及来源、搜索、语言、导航和删书变化仍刷新；微基准与计数测试均不代表整应用帧率。

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
