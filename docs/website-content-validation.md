# 官网与文档整理验收 · 2026-10-25

## 本轮范围

基于 `90c59ee` 整理 v1.3.0 发布说明、README 与官网内容。README 从 160 行缩减为 68 行（含标记与链接共 2,057 字符），开发、CI、安装验收和评测说明迁入[开发与验证](development.md)，Go 请求适配迁入[服务配置说明](provider-configuration.md#opencode-go-请求适配)。官网保留交互演示，将核心能力收敛为三项，删除重复介绍及对应样式。

应用版本、源码、依赖、标签和安装文件沿用原有发布。[v1.3.0 发布验收](releases/v1.3.0-validation.md)记录应用与安装包的历史结果，本页单独记录本轮内容整理。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| `git diff --check` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | TypeScript 7.0.2，通过 |
| `pnpm test` | 64 个文件、561 项测试通过，包含现有官网与文案测试 |
| 文档链接与编码 | 核对新增或调整文档的本地链接；UTF-8 无 BOM、LF 换行，保留 README 的 `#验证` 锚点 |
| 官网布局 | Chrome 155.0.8059.85，1440×1000 与 390×844、系统浅/深色偏好共四组通过，无整页横向溢出 |
| 官网交互 | 实际点击能力导航、桌面格式导航、预设选区提问与引用返回；两个下载按钮均指向最新 Release |
| 浏览器与视觉 | 无页面或控制台错误，无外部服务请求；已查看桌面、手机和演示回答截图 |

官网继续使用原有浅色主题；系统深色偏好也按此主题显示。手机可在演示区域内横向查看完整工作台。演示使用预设书籍与回答，检查结果不代表真实模型质量。

本轮没有重新构建或验收安装包，也没有执行真实服务评测。日志、布局结果与截图保存在忽略目录 `output/docs-refresh-20261025/`。

## 公开交付

- 内容提交为 [`8bda025`](https://github.com/maaoding/llm-reader/commit/8bda02581df8c3bd7e81f2fa3311b471246bf6c3)，[GitHub Pages 部署](https://github.com/maaoding/llm-reader/actions/runs/40166449725)已成功。本轮提交按文档惯例跳过应用 CI，官网工作流单独触发；本地 lint、类型检查和单元测试结果见上表。
- [v1.3.0 Release](https://github.com/maaoding/llm-reader/releases/tag/v1.3.0)标题已统一为“v1.3.0 — TXT Markdown 阅读与恢复优化”，正文与仓库发布说明一致。Release ID、Latest 状态、非草稿/非预发布状态、标签与三个附件的 ID、大小和 SHA-256 均与修改前一致。
- 公开 README 内容与本地文件一致。README、开发文档、服务配置和标签内的验收记录均返回 HTTP 200；最新下载入口仍指向 v1.3.0。
- [新版官网链接](https://llm-reader.maaoding.icu/?v=8bda025)与 `/index.html` 已显示精简内容。正常首页 `/` 仍命中旧的 Cloudflare 缓存（`Cache-Control: max-age=14400`）；按用户选择，暂缓清理缓存，先交付带版本参数的新版链接。
- 新版公开链接重复通过 1440×1000、390×844 与系统浅/深色偏好四组检查。导航、下载入口、预设提问与引用返回正常，无整页横向溢出或页面脚本错误，已查看公开截图。公开 HTML 去除既有 Cloudflare 注入的统计脚本后与源码一致，CSS 与源码完全一致；演示未调用模型或搜索接口。

公开结果见本机同轮目录下的 `public-versioned-website.json`、`public-source.json`、`public-links.json`、`delivery-invariants.json` 与 `screenshots/public-versioned-*.png`。原有 v1.3.0 验收记录保留原样。
