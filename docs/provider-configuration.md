# 模型协议与文档服务配置

模型、文档处理、语义检索和重排各自保存地址、密钥与高级请求设置。
已有配置继续按 OpenAI 兼容协议工作。

## Anthropic / Claude

在“设置 → 模型服务”选择 **Anthropic / Claude**，填写接口地址、模型 ID 和 API 密钥。
可以先获取模型列表或测试连接，确认后保存、启用。
模型 ID 以服务实际提供的列表为准；列表不完整时也可以手动填写。

| 配置 | 地址示例 | 请求接口 |
| --- | --- | --- |
| Anthropic 官方 | `https://api.anthropic.com` | `/v1/messages` |
| Anthropic 兼容中转 | `https://example.com/proxy/v1` | `/proxy/v1/messages` |
| 完整自定义地址 | `https://example.com/custom/messages` | 保留完整路径 |
| OpenAI 兼容服务 | `https://example.com/v1` | `/v1/chat/completions` |

Anthropic 协议用于划词问答、全书问答、检索规划与章节笔记。系统提示词放在顶层 `system`，
支持 JSON 和 SSE 流式响应，忽略 thinking 等非正文事件，汇总输入、缓存和输出 token 用量。
错误事件、断流及 `max_tokens` 截断不会记为完成。

请求默认使用 `x-api-key` 与 `anthropic-version: 2023-06-01`。
提供 Claude 模型但仅实现 OpenAI 协议的服务，应继续选择“OpenAI 兼容”。
不包含 AWS Bedrock 签名、Vertex OAuth 或工具调用循环。

## 模型连接测试

模型设置中的“测试文本回复”和“测试流式回复”使用当前表单配置发送简短请求。
文本测试必须收到有效文本；流式测试还要求 SSE 响应及结束标记，不会用非流式降级来伪装通过。
返回 HTML、空文本、错误内容或流式中断会显示失败；请求与读取响应均受配置的超时限制。
只使用自定义认证请求头的模型也可用于章节笔记。

## PDF 文档处理

在“设置 → 阅读增强 → 文档处理”选择服务。保存后，在“本书准备”中启动处理。

复杂论文、表格和公式优先选择 MinerU 或 Docling 取得文档结构；扫描页如果主要需要逐页文字，可选择 Mistral OCR 或 Unstructured Partition。已有兼容图片输入的模型时，也可主动选择“视觉模型 OCR”。逐页路线建议先用“先识别一页”对照原 PDF，再决定是否处理全书；当前应用只按页保存识别文字，不把专门 OCR 服务的全部结构化能力作为完整表格结构提供。

| 服务 | 地址与认证 | 处理方式 |
| --- | --- | --- |
| MinerU 本机 | 默认 `http://127.0.0.1:8000`；可自定义 | 原有异步 PDF 上传、轮询及结构化结果 |
| MinerU 云端 | 默认 `https://mineru.net`；Bearer 密钥 | 原有云端任务、授权文件上传及结构化结果 |
| Docling | 默认 `http://127.0.0.1:5001`；`X-Api-Key` | 原有异步 PDF 转换与结构化结果 |
| 视觉模型 OCR | OpenAI 或 Anthropic 协议；独立的模型、地址和密钥 | PDF 逐页图片识别 |
| Mistral OCR | 默认 `https://api.mistral.ai/v1`；Bearer 密钥 | `/ocr`，默认 `mistral-ocr-latest`，逐页图片识别 |
| Unstructured Partition | 填写账户提供的 Partition 地址或本机服务地址；`unstructured-api-key` | `/general/v0/general`，逐页 multipart 图片上传 |

Unstructured 支持 Partition 兼容端点，不适用于 Workflow API。完整 Partition 地址不会重复追加路径。
Mistral OCR、Unstructured 和视觉模型的“测试”只发送内置样图，不发送书籍；测试可能消耗服务额度。

保存配置后，可在“本书准备 → 先识别一页”输入实际 PDF 页码，查看本书的页面图片与识别文字。
默认优先复用同一书籍、实际页码和已保存配置下的识别文字，包括此前正式 OCR 已完成的页面；没有缓存时仅发送所选页图片，可能消耗服务额度。界面会说明本次是否使用了缓存。
成功的预览文字保留在本机，重启后可复用，正式准备也会跳过这些页。预览不会改变原有准备进度、阅读位置或检索结果。
可用“复制文字”复制完整原文；“重新识别”会再次请求服务，成功后替换该页预览。失败或取消时保留上次成功结果；点击“重试这一页”才重新请求。已准备好的原文需点击“重新准备原文”后应用新结果，同时使笔记和向量需要重建。
取消、关闭准备窗口或修改服务配置会终止预览；取消后第三方可能已处理请求。书籍内容、页数或已保存的文档配置变化后不会复用旧预览；删除书籍一并清理对应结果。

三类逐页处理均沿用完成页缓存、暂停续传、失败页重试、600 页上限与本机页码引用。
Mistral 的 Markdown、页眉和页脚以及 Unstructured 的元素文本进入全文检索、问答和笔记流程。
这些结果按页组织，引用位置来自 PDF 渲染器，不采用服务返回的页码，也不把 OCR 内容声明为精确表格结构。
准备完成后，阅读页可切换“识别文字”，在当前 PDF 页逐页阅读、复制与划词提问；提问引用对应实际页码。阅读只使用已经发布的整本准备结果，不会触发额外服务请求。MinerU 和 Docling 等整份 PDF 处理服务暂不提供此逐页阅读视图。
需要原生章节、表格或单元格结构时，可选择现有的 MinerU / Docling。

## 高级请求设置

每类服务均有独立的“高级请求设置”，测试与正式调用使用相同配置。

### 自定义请求头

填写字符串值的 JSON 对象，例如：

```json
{
  "X-Project": "reader",
  "User-Agent": "MyReader/1.0",
  "Authorization": "Bearer your-gateway-token"
}
```

请求头名称不区分大小写，填写的值覆盖同名默认值。只靠请求头认证的模型配置可以不填写 API 密钥。
`Host`、`Content-Type`、`Content-Length` 等传输请求头由客户端管理；multipart 的 boundary 自动生成。
OpenCode Go 的会话标识由阅读器维护，不允许高级设置改变其会话归属。

请求头使用系统密钥保护器加密保存，设置页面不会读回明文。留空保留，重新填写整体替换，勾选“清除”删除。
更换地址、协议或文档处理商后不沿用原请求头；模型地址或协议改变时，保存的 API 密钥也需要重新填写。
包含自定义请求头的模型请求、Anthropic 请求和所有文档处理请求都不跟随重定向，
文档服务的文件上传/结果下载地址不会收到自定义请求头。

### 额外请求参数

填写服务支持的 JSON 对象，例如模型参数：

```json
{
  "max_tokens": 8192,
  "temperature": 0.2
}
```

Anthropic 默认输出上限为 4096 tokens，视觉 OCR 为 8192；可通过 `max_tokens` 调整。
文档服务可填写 `strategy`、`ocr_engine`、`ocr_lang`、`enable_formula` 等该服务支持的参数。
multipart 参数会转为表单字段，数组会生成同名字段。
消息、源文件、模型选择、流式开关和关键返回格式不能被额外参数覆盖。
这些参数按普通配置保存，认证信息应放入密钥或请求头。

### 超时与缓存

超时单位为秒，范围为 1–600。留空使用各功能现有默认值。
文档异步任务仍有整体处理期限；下载已授权文件沿用独立下载超时。
更改文档请求参数、请求头或认证信息后，已有准备结果会标记为配置变更，需要重新准备，避免混用不同配置的结果。

## 验证与接口参考

- 单元测试覆盖原生 Messages、分片 SSE、用量统计、截断/断流、请求头加密及隔离、超时、OCR 缓存、服务请求格式和设置交互。
- Electron 测试使用本机模拟接口，验证保存、模型列表、重启、扫描 PDF 准备和缓存复用。
- 无系统密钥库的 Linux CI 可显式使用测试启动器的 `LLM_READER_E2E_BASIC_TEXT=1`，仅适用于临时目录和虚构凭据；应用本身不启用该选项。
- 本次未调用真实收费服务，也未验收 Windows 安装包。

接口参考：[Anthropic Messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)、
[Anthropic 流式响应](https://platform.claude.com/docs/en/build-with-claude/streaming)、
[Anthropic 图片输入](https://platform.claude.com/docs/en/build-with-claude/vision)、
[Mistral OCR](https://docs.mistral.ai/studio/document-processing/basic_ocr)、
[Unstructured Partition](https://docs.unstructured.io/api-reference/legacy-api/partition/post-requests)。
