---
title: 从源码构建
description: 下载与 Microsoft Store 版本对应的 LLM Reader 源码，在 Windows 上运行或自行打包。
---

# 从源码构建

LLM Reader 的源码按 GPL-3.0-or-later 提供。Windows x64 官方预编译版由 Microsoft Store 付费分发并管理更新。[商店购买](https://apps.microsoft.com/detail/9PL7FB24VJMV)

## 下载对应版本

| Microsoft Store 包 | 源码标签 |
| --- | --- |
| `1.4.0.0` | [`store-v1.4.0.0`](https://github.com/maaoding/llm-reader/tree/store-v1.4.0.0) |
| 后续 `X.Y.Z.0` | `vX.Y.Z` |

在 [GitHub 标签列表](https://github.com/maaoding/llm-reader/tags)找到所需版本并下载 ZIP，或用 Git 检出同名标签。历史 `v1.4.0` 标签对应当时的 GitHub 安装版，商店首版使用上表中的独立源码快照。

## 安装依赖并运行

按所下载标签的 `package.json` 准备 Node.js 和 Corepack。在源码目录打开 PowerShell，获取项目固定版本的 pnpm 并安装锁定的依赖。

```powershell
corepack enable
corepack install
pnpm install --frozen-lockfile
pnpm dev
```

如果启动时报告缺少 Electron 二进制文件，运行 `node node_modules/electron/install.js`，再启动应用。开发环境和验证命令见[开发与验证](https://github.com/maaoding/llm-reader/blob/main/docs/development.md)。

## 自行打包

在 Windows 上构建 x64 NSIS 安装包。

```powershell
pnpm build:win --publish never
```

安装包生成在 `release/`。默认自行构建的安装包未签名，Windows 可能显示安全提示。商店首版源码快照保留了当时的构建配置，其 NSIS 构建仍包含旧 GitHub 更新器。后续源码标签构建的版本需手动更新。切换到商店版前，可以[备份和迁移书库](./faq.md#如何从旧-github-安装版迁移到商店版)。
