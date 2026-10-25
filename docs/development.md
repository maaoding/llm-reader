# 开发与验证

本文集中说明源码开发、持续集成、Windows 安装验收与质量评测。产品使用见 [README](../README.md)，版本验收见 [发布记录](releases/v1.3.0-validation.md)。

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

依赖升级的结果及边界见[收尾记录](dependency-upgrade-closeout.md)。另有 [Windows 安装验收工作流](../.github/workflows/windows-package-validation.yml)，可手动构建未发布的 NSIS 包，验证全新安装、从公开 v1.2.0 覆盖安装及已安装程序的专项回归。

验收已安装版本时，将 `LLM_READER_E2E_EXECUTABLE` 指向安装目录中的 `LLM Reader.exe`，再运行 `pnpm test:e2e:run`。测试仍会为每个用例创建并清理隔离的临时用户数据目录，不会读写日常书库。

## 真实服务与质量评测

需要使用日常设置中已保存的真实兼容 API 做发布前冒烟时，运行 `pnpm test:real-api`。该命令不会加入 `test:all`，只在主动运行时发送少量合成测试内容；它会把 Base URL、model、`safeStorage` 加密后的密钥文件及其本机加密上下文复制到临时用户数据目录，不输出或修改密钥，也不复制日常书库，并在结束后清理测试数据。

全书理解质量检查先运行 `pnpm build:app`，再运行 `pnpm eval:book-context` 检查样本与模型配置；此时不会调用模型。显式执行 `pnpm eval:book-context --run` 后，会发送合成书籍内容并比较固定问题的回答。默认使用当前配置，可通过 `LLM_READER_REAL_API_PROFILE_ID` 指定另一已有配置。报告写入 `tmp/book-context-eval-*/`，逐轮保留实际来源、回答、引用与接口返回的用量；程序检查证据召回，回答含义仍需人工复核。详见 [全书上下文验证记录](book-context-validation.md)。

独立阅读样本另覆盖长篇 EPUB、复杂 PDF、扫描 PDF 和跨书问题。先运行 `node scripts/independent-reading-generate.mjs` 固定材料与题目，再用 `pnpm eval:independent-reading` 检查条件；`--offline` 只验证导入与本地 EPUB 原文准备，`--run` 才使用已保存的模型和 PDF 服务配置调用真实接口。`--simulate` 使用本机模拟服务，并等待读者仅依据每题实际检索上下文填写队列回答，可在没有真实配置时检查完整流程；它不代表真实解析、OCR 或供应商质量。报告区分未运行、离线验证、模拟与真实回答、语义复核，详见[评测说明](independent-reading-validation.md)及[本机模拟结果](independent-reading-simulation.md)。
