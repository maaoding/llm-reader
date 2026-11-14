# Microsoft Store 1.4.0.0 源码与发布准备

## 已上架包对应的源码

| 字段 | 值 |
| --- | --- |
| Microsoft Store 商品 | [LLM Reader](https://apps.microsoft.com/detail/9PL7FB24VJMV) |
| 源码标签 | `store-v1.4.0.0`（待公开） |
| 应用版本 / AppX 版本 | `1.4.0` / `1.4.0.0` |
| 包身份 | `1C124951.LLMReader` |
| 发布者 | `CN=9EF5245E-A210-44E8-AC98-8F1FC24678DD`（马奥丁） |
| 应用 ID / 架构 | `LLMReader` / `x64` |
| Git 源码树 | `031d342b4e1f9aa5ab4fc138aff4b4838ba7331c` |

| 本地原始工件 | SHA-256 |
| --- | --- |
| `release/store/LLM-Reader-1.4.0-store-source.zip` | `345da358ed9db421568eaff1632b32809b3e5676837f2e5258cebba5a7813316` |
| `release/store/LLM-Reader-1.4.0-store-x64.appx` | `3c41735a69cbc13699f193a5f39ed523633614800602d57dd02d5fb8d6d7715c` |

AppX 摘要对应本机提交用包。源码快照从 ZIP 提取，470 个文件逐一核对 SHA-256，包括源码、锁文件、构建脚本、AppX 配置、图标与许可证。包内清单的身份、版本和架构已核对，4 个商店图标与快照字节一致。

原始快照使用其 `package.json` 固定的 pnpm 版本。在 Windows 上执行 `pnpm install --frozen-lockfile` 后运行 `pnpm --config.verify-deps-before-run=error build:store`。该标签中的 `build:store` 执行：

```text
pnpm build:app && electron-builder --win appx --x64 --publish never --config.directories.output=release/store
```

## 公开顺序

1. 在独立检出中从原始 ZIP 建立快照提交。现有的本地快照位于 `output/store-v1.4.0.0-source/`，索引与树对象位于 `output/store-v1.4.0.0-snapshot.git/`。暂存时保留 ZIP 中 `scripts/setup-cloud-environment.sh` 的可执行位，核对 `git write-tree` 与上表一致。为该快照提交创建 `store-v1.4.0.0` 标签，公开后匿名打开标签页并下载 ZIP 核对。历史 `v1.4.0` 对应 GitHub 安装版。
2. 源码标签可访问后，更新商店商品页的源码链接和官网的[源码构建页](../manual/build-from-source.md)，再检查两个入口。GitHub 后续按 `vX.Y.Z` 提供源码标签，每个标签在发布记录中注明对应商店包 `X.Y.Z.0`。

## 商店商品页文案

保留商品描述主体，将末尾的许可与源码段落替换为以下对应语言。

**简体中文**

LLM Reader 按 GPL-3.0-or-later 许可提供源码。商店包 1.4.0.0 对应源码标签 store-v1.4.0.0。可下载该版本源码并自行构建。商店版由 Microsoft Store 安装和更新。

**English (United States)**

LLM Reader source code is available under GPL-3.0-or-later. The source tag for Microsoft Store package 1.4.0.0 is store-v1.4.0.0. You can download and build that version from source. Microsoft Store installs and updates the Store edition.

[对应源码标签](https://github.com/maaoding/llm-reader/tree/store-v1.4.0.0) · [构建说明](https://llm-reader.maaoding.icu/docs/build-from-source.html)

在商品描述的源码段落后附上源码标签的完整 URL。标签公开并验证后再保存商品页。

## 分发切换的本地验证

2026-11-14 在 Windows 上验证。候选包沿用 `1.4.0` 版本号，独立于上表记录的已上架包。

- `pnpm test:all` 通过 lint、类型检查、933 项单测和应用构建。Electron E2E 通过 163 项，依赖本地 PDF 的 1 项按条件跳过。在 1180×800 浅色/100% 和 940×600 深色/125% 检查中英文“关于”页及退出保存失败后的继续编辑。商店渠道通过模拟 `process.windowsStore` 验证，同时检查反馈页面打开失败时的提示。
- `pnpm site:build` 和 `git diff --check` 通过。在桌面和 390px 移动视口检查官网入口、源码构建页和迁移步骤。pnpm 依赖预检查报告本机工作区元数据不匹配，核对已安装工具版本后，验证命令单次使用 `--config.verify-deps-before-run=false`。
- 复用应用构建，在两个空目录中构建 AppX 与 NSIS。AppX 清单、图标和许可文件核对通过。两包的 ASAR 内应用构建文件与已测输出字节一致，包内及输出均无旧 GitHub 更新元数据。解包程序完成一次真实的备份恢复重启。报告位于 `output/store-distribution-packages/`，桌面回归证据位于 `output/store-distribution-full-e2e/`。

## 下一版商店验收

下一版提交前记录 Microsoft Store 实际安装、从 `1.4.0.0` 更新、用户书库及凭据保留，以及书库恢复后的重启结果。记录实际安装包版本、测试环境和结果。候选包内容检查与解包程序回归另行记录。
