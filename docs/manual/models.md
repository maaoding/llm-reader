---
title: 配置问答模型
description: 为 LLM Reader 配置 OpenAI 兼容或 Anthropic / Claude 接口，测试文本与流式回复，并保存为当前模型。
---

# 配置问答模型

LLM Reader 使用你提供的模型服务。普通阅读不需要模型；划词、整本书问答和章节笔记需要相应的模型配置。

## 填写配置

打开“设置 → 模型服务”，新建或修改一套配置。

1. 填写便于识别的配置名称。
2. 选择服务提供的协议。
3. 填写 Base URL、API Key 和模型 ID。
4. 分别测试文本回复与流式回复。
5. 点击“保存并使用”，将其设为当前问答模型。

模型可以从服务返回的列表中选择，也可以手动填写。服务列表不完整时，以服务商提供的实际模型 ID 为准。

![模型服务设置：配置名称、接口协议、地址、模型、密钥，以及底部的测试与保存操作](/images/model-settings.png)

*v1.3.0 界面示例，地址、模型与密钥均为演示数据，使用时请填写自己的服务信息。*

## 选择协议与地址

| 服务接口 | 协议选择 | Base URL 示例 |
| --- | --- | --- |
| OpenAI 官方或兼容 Chat Completions 的服务 | OpenAI 兼容 | `https://api.openai.com/v1` 或服务商提供的兼容根地址 |
| Anthropic 官方 | Anthropic / Claude | `https://api.anthropic.com` |
| Anthropic 兼容中转 | Anthropic / Claude | 服务商提供的 Messages 根地址或完整端点 |
| 本机 OpenAI 兼容服务 | OpenAI 兼容 | 例如 `http://localhost:11434/v1`，模型须先在本机服务部署 |

“模型叫 Claude”并不一定代表接口采用 Anthropic 协议。如果服务商提供的是 `/v1/chat/completions`，请选择 OpenAI 兼容；提供原生 `/v1/messages` 时选择 Anthropic / Claude。

地址填写 API 地址，通常不是服务商的网站首页。远程接口使用 HTTPS；本机 `localhost`、`127.0.0.1` 和 `::1` 可使用 HTTP。模型支持的能力和费用以所选服务为准。

## 测试、保存与切换

测试读取当前表单，不会自动保存配置。

- **文本回复测试**：需要收到有效文本。
- **流式回复测试**：需要服务真正支持流式响应并正常结束。文本测试成功不代表流式测试一定成功。
- **保存配置**：保存这套配置，随后可点击“设为当前”。
- **保存并使用**：保存并切换当前模型。如果切换失败，已保存的配置仍然保留，可重试“设为当前”。

测试会发送简短请求，可能产生费用。更换地址或协议后需要重新填写密钥，并重新测试。

## OpenCode Go

“请求适配”默认为“自动”，可识别 OpenCode Go 官方地址，例如 `https://opencode.ai/zen/go/v1`。通过中转调用 Go 时，可显式选择“OpenCode Go”；仍需使用支持 Chat Completions 的接口与模型。

如果服务返回重定向，请核对并填写最终接口地址。完整协议说明见仓库中的[模型与服务配置](https://github.com/maaoding/llm-reader/blob/main/docs/provider-configuration.md#opencode-go-请求适配)。

## 高级请求设置

服务需要特殊认证、参数或更长超时时，再展开“高级请求设置”。

- **自定义请求头**：填写字符串值组成的 JSON 对象，用于服务商要求的额外认证等设置。请求头加密保存。
- **额外请求参数**：填写服务支持的 JSON 对象，例如输出长度；认证信息应放在密钥或请求头中。
- **超时**：单位为秒，可设置 1–600，留空使用默认值。

例如，服务支持 `max_tokens` 时，可以在额外请求参数中指定输出上限：

```json
{
  "max_tokens": 4096
}
```

问答、PDF 解析、Embedding、Rerank 和搜索各自保存配置与凭据，不会自动共用密钥。遇到错误先看[连接问题](./faq.md#模型连接失败)，高级示例见[协议与高级配置](https://github.com/maaoding/llm-reader/blob/main/docs/provider-configuration.md#高级请求设置)。
