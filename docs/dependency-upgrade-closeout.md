# 2026-10-15 依赖升级收尾

应用代码基线为 `8e159fd5de6cbab91871a82d4e450cd5cbbb3c32`。[常规升级 PR #7](https://github.com/maaoding/llm-reader/pull/7) 和[主版本升级 PR #8](https://github.com/maaoding/llm-reader/pull/8) 已合并；本轮收尾补充可重复的 Windows 安装验收和验证记录。

## 已完成的迁移

| 工具 | 版本 |
| --- | --- |
| Electron | 44.7.2 |
| Vite / electron-vite | 8.3.4 / 6.0.0 |
| React 插件 | 6.1.2 |
| Vitest | 5.0.4 |
| TypeScript 类型检查 / lint API | 7.0.2 / 6.0.3 |
| pnpm | 11.28.2 |

`pnpm typecheck` 明确调用 `typescript-compiler` 别名包中的 TypeScript 7 原生编译器，并输出版本。TypeScript 6 供 `typescript-eslint` 使用 JavaScript 编译器 API；未关闭 peer 检查或 lint 规则。Vitest 保留清理 mock 的默认行为，预加载 API 的暴露在独立初始化用例中验证。

Vite 配置迁移到 `rolldownOptions` 和内置依赖外置选项，保留 ESM 主进程、CommonJS 预加载及两份 HTML 入口。开发 CSP 允许实际 Vite WebSocket 的精确来源；修改根 `App.tsx` 时完整重载并恢复保存的阅读状态，普通组件继续热更新。这两处开发修复前后的 13 份生产构建文件逐字节一致。

## 已有验证证据

| 范围 | 结果与证据 |
| --- | --- |
| 合并后的 main CI | [run 38733610969](https://github.com/maaoding/llm-reader/actions/runs/38733610969) 全部通过；对应上述代码基线 |
| 安装、代码检查与构建 | 锁文件安装、lint、TypeScript 7 两份配置检查和 Vite 8 构建通过 |
| 单元测试 | 55 文件 / 483 项通过 |
| Windows 源码桌面回归 | 115 通过、1 项私有 PDF 跳过、0 失败；包括 PDF、OCR、原生图标和窗口控件 |
| Linux 专项桌面回归 | 37 通过、1 项私有 PDF 跳过、0 失败 |
| 开发模式与 preview | 隔离的合成三页 PDF、预加载 API、React 与 PDF worker 通过；根组件重载恢复书籍、页码和草稿，子组件热更新保留阅读状态且不导航 |
| 本地 NSIS 交叉构建 | `--publish never` 通过；包内生产依赖、入口、声明、安装器与更新元数据校验通过，开发编译器和测试工具未打入包 |
| 生产依赖审计 | 0 条公告 |

本地交叉构建安装器为 143,460,834 字节，SHA-256 为 `86806eadacde9ed097b71da5aa1c5b713f4e73d10c5ec8eaff6e51e0fb4f5cc0`。它只用于本轮验证；Windows 原生工作流会独立构建并记录自己的摘要。

## Windows 原生安装验收

[Windows package validation](../.github/workflows/windows-package-validation.yml) 在 Windows Server 2025 x64 上构建 NSIS 安装器，明确关闭发布，再执行[安装与升级脚本](../scripts/validate-windows-package.mjs)。脚本和工作流变更会在 PR 上触发；也可在 [Actions 页面](https://github.com/maaoding/llm-reader/actions/workflows/windows-package-validation.yml)选择目标分支手动执行。

验收覆盖：

- 下载公开 v1.1.0，核对固定的 SHA-256 和文件大小，再安装到独立临时目录。
- 由旧版创建合成书籍、阅读进度、摘录、归档、会话草稿、本地设置和加密测试密钥。
- 覆盖安装本次构建，核对实际 Electron 版本及安装后的 `app.asar`，确认数据与同一密钥的本机接口调用仍可用。
- 在独立目录全新安装本次构建并验证启动；覆盖升级验收后，针对已安装的 EXE 运行关于页、PDF、多书工作台、会话恢复和 OCR 专项回归。

结果以该工作流的完整成功状态为准。`windows-package-validation` 产物包含 `package-validation.json` 和 Playwright 报告，保留 7 天。摘要记录安装器和已安装文件的校验值；隔离书库及加密测试凭据在脚本结束时清理，不上传。所有服务请求发送到本机模拟接口。

安装与专项回归均通过后，另上传 `windows-unsigned-validation-installer`，包含本次未签名的安装器、blockmap、更新元数据及校验摘要，保留 7 天，供下载复核；它不会进入公开 Release。

## 发布状态与剩余事项

公开版本仍为 [v1.1.0](https://github.com/maaoding/llm-reader/releases/tag/v1.1.0)，2026-10-11 发布。此次依赖升级没有发布新版，应用版本号仍为 `1.1.0`；验收安装器与已公开的同名安装器分别记录。下一次发布需要推进版本、重建最终安装器并验收该正式产物。

- 真实模型、搜索、OCR 和文档服务的质量尚未在本轮验收；需要已有的真实配置与代表性资料。自动化使用合成资料和本机模拟接口。
- 私有真实 PDF 未提供，相关用例保持原有跳过条件。
- 开发工具链仍有 `sprintf-js@1.1.3` 的中等级公告 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)，本轮查询未发现已发布修复版本；不将完整依赖审计记为零告警。
- 后续设计优化先根据真实阅读中的加载、失败反馈及设置操作卡点确定范围；大型 `App.tsx` 的拆分另作独立改动。
