---
title: 从源码构建
description: 核对 Microsoft Store 包对应的源码版本，在 Windows 上运行或自行打包已公开的源码。
---

# 从源码构建

LLM Reader 的源码按 GPL-3.0-or-later 提供。Windows x64 官方预编译版由 Microsoft Store 付费分发并管理更新。[商店购买](https://apps.microsoft.com/detail/9PL7FB24VJMV)

## 下载对应版本

| Microsoft Store 包 | 源码标签 |
| --- | --- |
| `1.4.0.0` | `store-v1.4.0.0`（待公开） |
| 后续 `X.Y.Z.0` | `vX.Y.Z` |

商店首版使用独立源码快照，历史标签 `v1.4.0` 对应旧 GitHub 安装版。快照的源码树与校验值见[商店首版源码记录](https://github.com/maaoding/llm-reader/blob/main/docs/releases/store-v1.4.0.0.md)。

要构建已公开的版本，可从 [GitHub 标签列表](https://github.com/maaoding/llm-reader/tags)下载 ZIP，或用 Git 检出对应标签。要运行开发版，可下载[主分支源码](https://github.com/maaoding/llm-reader/tree/main)。

## 安装依赖并运行

按所下载源码中的 `package.json` 准备 Node.js 和 Corepack。在源码目录打开 PowerShell，获取项目固定版本的 pnpm 并安装锁定的依赖。

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
