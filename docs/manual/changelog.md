---
title: 更新日志
description: 查看 LLM Reader 开发中的阅读功能、已发布版本，以及 Windows 安装与升级方式。
---

# 更新日志

Windows 商店首版的 AppX 版本为 **1.4.0.0**。使用商店版时，可按下方的 [v1.4.0 发布说明](./releases/v1.4.0.md)核对功能。商店首版使用独立源码快照，标签状态见[从源码构建](./build-from-source.md)。

## 开发中

以下三项正在开发，使用时以手头的构建为准。

| 想做什么 | 开发版中的操作 |
| --- | --- |
| 核对回答引用，又想留在当前阅读位置 | 将指针停在书内引用 `[P1]` 上，或用 Tab 聚焦它，先看当轮保存的摘录。需要上下文时再跳到书中。[核对回答](./asking.md#核对回答) |
| 忘了在哪本书里问过一个问题 | 在书库打开“最近对话”，输入记得的书名、问题或回答片段，选中结果即可回到那本书的会话和草稿。[找回最近对话](./asking.md#找回最近对话) |
| 记得一个观点，想不起原文用词 | 在“搜索本书”切换到“按含义查找”，提交概念或短句。使用此模式前，先配置 Embedding 并建立本书索引。[在书中搜索](./reading.md#在书中搜索) |

官网提供示例书，可以直接体验引用预览、找回最近对话和 Markdown 导出。[打开交互演示](https://llm-reader.maaoding.icu/#reader-demo-panel)

### 已合入开发主分支

在阅读页按 `F11` 可以进入全屏。独立的助手窗口支持拖动，使用双屏时可把它移到另一块屏幕。[阅读全屏](./reading.md#阅读全屏)

用 PaddleOCR 准备横排扫描页后，只要识别结果含有有效的字词坐标，就能直接在页面上拖选原文、提问或摘录。[在扫描页原图划词](./pdf.md#在扫描页原图划词)

首次使用时，可从空书库导入第一本书。划词后如果需要先配置模型，阅读助手会保留选区，供配置完成后继续提问。[快速开始](./getting-started.md)

## 已发布的 v1.4.0 {#当前版本}

[v1.4.0 — 摘录整理、会话导出与书库备份](./releases/v1.4.0.md)

当时的 GitHub 安装版及真实服务验证范围见 [v1.4.0 验收记录](https://github.com/maaoding/llm-reader/blob/main/docs/releases/v1.4.0-validation.md)。

## 历史版本

- [v1.3.1 — 阅读性能与来源定位优化](./releases/v1.3.1.md)
- [v1.3.0 — TXT Markdown 阅读与恢复优化](./releases/v1.3.0.md)
- [v1.2.0](https://github.com/maaoding/llm-reader/releases/tag/v1.2.0)
- [v1.1.0](https://github.com/maaoding/llm-reader/releases/tag/v1.1.0)
- [v1.0.0](https://github.com/maaoding/llm-reader/releases/tag/v1.0.0)
- [历史 GitHub Releases](https://github.com/maaoding/llm-reader/releases)

## 安装与升级

官方预编译版由 Microsoft Store 更新。后续每个商店包 `X.Y.Z.0` 对应一个 GitHub 源码标签 `vX.Y.Z`。自行构建的版本需手动更新。[在 Microsoft Store 打开 LLM Reader](https://apps.microsoft.com/detail/9PL7FB24VJMV)

从旧 GitHub 安装版切换到商店版时，请先[备份并迁移书库](./faq.md#如何从旧-github-安装版迁移到商店版)。
