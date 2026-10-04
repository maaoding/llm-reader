# 联网搜索设置与问答集双列验收

2026-10-04，本次在干净工作区上增量实现，未提交、推送或发布。所有运行验证使用隔离临时书库、本机模拟服务与合成凭据，没有调用用户的真实模型或搜索服务。

## 设置与兼容

“设置 → 阅读增强 → 联网搜索 → 配置详情”只保存当前一套连接。选择提供商会填写默认基础地址，可改为相同协议的中转地址。切换提供商或地址会清空凭据草稿，主进程只在提供商和地址均相同时复用已加密保存的密钥／请求头。

| 提供商 | 默认基础地址 | 接口 | 原生认证 |
| --- | --- | --- | --- |
| Tavily | `https://api.tavily.com` | `POST /search` | Bearer |
| Brave Search | `https://api.search.brave.com/res/v1` | `POST /web/search` | `X-Subscription-Token` |
| Exa | `https://api.exa.ai` | `POST /search` | `x-api-key` |

结果数量为1–5，默认5；搜索超时默认10秒，包含响应体读取。包含／排除域名支持逗号或换行分隔、规范化和去重，每组最多20个主机名。匹配自身及子域名，排除优先，不接受协议、路径、端口或通配符。Tavily、Exa 使用原生域名参数，Brave 使用内联 Goggles；所有结果还会在本机重新检查域名边界和安全 URL，域名尾点不能绕过排除。

高级区只提供自定义请求头，沿用加密保存、校验、清除和留空保留操作。连接测试使用当前草稿及固定短检索词，不保存配置、不上传书籍；配置变化使旧测试结果失效。旧配置没有提供商等新字段时继续按 Tavily、5条、无域名限制读取，无新增数据库表或迁移。

每轮仍最多一次请求，至多5条来源；Brave／Exa 在本机取至多两份短摘录，Tavily 保持 basic 和现有短摘录。三家复用 `WebSearchSource`、`[Wn]` 引用、归档、追问和 Markdown 导出。保留256 KiB响应限制、1,200 Unicode码点的单来源摘录上限、取消、禁止重定向，以及失败提示后继续书内回答；不请求服务端答案、全文或图片。

## 布局与验证

问答集在940px及以上使用两列等宽 Grid，更窄时单列；保留8px间距、三行回答预览和横线纸纹。同一行卡片等高、操作区靠底，长标题、代码和删除确认不会撑宽卡片。390px验收仅在隔离测试实例中临时降低窗口最小尺寸，生产窗口仍保持940px最小宽度。

| 检查 | 结果 |
| --- | --- |
| `pnpm test:all` | lint、typecheck、54个测试文件／471个单测通过；Electron E2E 112通过、1跳过 |
| `pnpm build:win --publish never --config.directories.output=output/search-settings-validation-20261004/package` | 本地NSIS安装包生成成功，无发布 |
| 打包程序的联网搜索与双列专项E2E | 7/7通过；覆盖三家配置、草稿测试、请求头、引用、归档、重启、回退、取消和布局 |
| 最终 lint、typecheck、`git diff --check` | 通过 |

跳过项为依赖 `LLM_READER_REAL_PDF` 的可选复杂论文样本测试。已目视检查1280px／940px浅深主题、125%缩放、390px单列，以及打包程序的提供商选择、域名字段和加密请求头提示。截图保留在 `output/search-settings-validation-20261004/screenshots/`；它们是模拟服务验收，不是实际搜索质量样本。

本地安装包：`output/search-settings-validation-20261004/package/LLM Reader-0.6.0-setup.exe`，124,620,517字节。SHA-256：`7038273C78AB0EE22973AAC5656D8AFBB6CFEDB271965F391416650DEC205318`。

真实提供商联调、搜索召回质量及用户日常书库中的安装／升级未验证。本次没有安装新包或改动用户日常书库。

协议依据：[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Brave Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/post)、[Brave Goggles](https://api-dashboard.search.brave.com/documentation/resources/goggles)、[Exa Search](https://exa.ai/docs/reference/search)。
