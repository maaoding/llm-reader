# LLM Reader

本地优先、以 LLM 辅助理解复杂非虚构内容为核心的 Windows 桌面阅读器原型。

项目主页：<https://maaoding.github.io/llm-reader/>

## 当前闭环

导入无 DRM 的 EPUB 或 UTF-8 TXT，连续滚动阅读并选中原文；应用会把选区与最多 6,000 个 Unicode 字符的章节上下文发送给用户配置的 `/v1/chat/completions` 兼容接口。回答支持流式显示、原文引用跳转、追问与手动收藏。

书籍、阅读位置和收藏保存在本机。API Key 由 Electron `safeStorage` 加密后写入独立密文文件，不进入 SQLite。

## 开发

```powershell
pnpm install
pnpm dev
```

开发环境需要 Node.js 24+ 与 pnpm 11+。

首次使用时在左侧栏底部打开“设置”，填写 Base URL、API Key 和 model。远程接口必须使用 HTTPS；仅 `localhost`、`127.0.0.1` 与 `::1` 允许 HTTP。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build:win
```

`pnpm build:win` 会在 `release/` 生成未签名的 Windows x64 NSIS 安装包。

产品边界见 `PRODUCT.md`，实现约束见 `AGENTS.md`。
