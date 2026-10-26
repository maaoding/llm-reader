# 仓库文档索引

这里集中列出源码开发、服务接入与发布验证资料。安装和日常操作请阅读[官网使用文档](https://llm-reader.maaoding.icu/docs/)，第一次使用从[快速开始](https://llm-reader.maaoding.icu/docs/getting-started.html)进入。

## 开发与验证

- [开发与验证](development.md)：启动应用、源码回归、Windows 打包、CI 和官网构建。
- [云端 Linux 开发环境](development-environment.md)：pnpm、Xvfb、Wine 与代理环境初始化。
- [质量评测](evaluation.md)：全书问答、重排、文档结构与独立阅读的可重复评测入口。

## 协议与产品约定

- [产品契约](../PRODUCT.md)：当前能力、数据流、任务恢复与行为边界。
- [模型协议与文档服务配置](provider-configuration.md)：请求端点、兼容适配、认证和高级参数。
- [阅读增强设置与接口说明](knowledge-processing.md)：Embedding、Rerank、PDF 服务协议与处理范围。
- [视觉模型 OCR](vision-ocr.md)：图片与页数限制、缓存、恢复及接口依据。

## 发布记录

发布说明记录版本变化；验收记录说明当时实际执行的检查及限制，不代表后续提交已重新通过相同验证。安装包见 [GitHub Releases](https://github.com/maaoding/llm-reader/releases)，面向使用者的版本入口见[官网更新日志](https://llm-reader.maaoding.icu/docs/changelog.html)。

| 版本 | 发布说明 | 验收记录 |
| --- | --- | --- |
| v1.3.0 | [发布说明](releases/v1.3.0.md) | [验收记录](releases/v1.3.0-validation.md) |
| v1.2.0 | [发布说明](releases/v1.2.0.md) | [验收记录](releases/v1.2.0-validation.md) |
| v1.1.0 | [发布说明](releases/v1.1.0.md) | [验收记录](releases/v1.1.0-validation.md) |
| v1.0.0 | [发布说明](releases/v1.0.0.md) | [验收记录](releases/v1.0.0-validation.md) |
| v0.7.0 | [发布说明](releases/v0.7.0.md) | [验收记录](releases/v0.7.0-validation.md) |
| v0.6.0 | [发布说明](releases/v0.6.0.md) | [验收记录](releases/v0.6.0-validation.md) |
| v0.5.0 | [发布说明](releases/v0.5.0.md) | — |

## 文档放在哪里

| 位置 | 负责的内容 | 阅读入口 |
| --- | --- | --- |
| [根 README](../README.md) | 项目简介、下载、使用文档和源码启动入口 | GitHub 仓库首页 |
| [site/](../site/) | 产品介绍、交互演示与下载 | [官网首页](https://llm-reader.maaoding.icu/) |
| [docs/manual/](manual/index.md) | 安装、阅读、模型配置、问答、PDF、隐私和排错教程 | [官网使用文档](https://llm-reader.maaoding.icu/docs/) |
| `docs/` 下的开发与协议指南 | 开发命令、接口细节与质量评测 | 本页各专题入口 |
| [docs/releases/](releases/) | 按版本保存的发布说明与验收记录 | 本页发布记录；当前版本说明同时展示在官网 |
| [PRODUCT.md](../PRODUCT.md) | 当前产品行为约定 | 仓库内阅读 |
| [LICENSE](../LICENSE) / [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | 项目与第三方许可 | 仓库与应用内许可入口 |

### 维护方式

- 用户操作说明维护在 `docs/manual/`；README 与官网首页提供入口。手册首页与[侧栏配置](.vitepress/config.mts)使用相同分组：开始使用、问答与笔记、可选增强、帮助与更新。
- 新增或调整教程时，同时检查手册首页、侧栏和相关页面的链接。公开页面使用 `/docs/*.html` 地址；调整分组时保留已有文件名和 URL。
- 发布说明以 `docs/releases/` 为原文，官网的[版本页面](manual/releases/v1.3.0.md)通过 include 引用。发布新版时同步版本入口、官网更新日志、手册首页与本页版本表。
- VitePress 只构建 `docs/manual/`。开发指南、协议参考和验收记录留在仓库，由官网“开发者资料”入口访问；主题与配置位于 `docs/.vitepress/`。
- 文档改动运行 `pnpm site:build`，确认页面、站内链接、资源、锚点与站点地图；预览与部署方式见[开发与验证](development.md#官网与使用文档)。
- 单次任务日志、截图和阶段报告放在忽略目录 `output/` 或 `tmp/`，交付摘要记录在 PR 或对应版本验收中。
