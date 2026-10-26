<p align="center">
  <img src="resources/icon.png" alt="LLM Reader icon" width="128" />
</p>

<h1 align="center">LLM Reader</h1>

<p align="center">本地优先的 Windows 桌面阅读器：连续阅读，用原文核对每次理解。</p>

<p align="center">
  <a href="https://github.com/maaoding/llm-reader/releases/latest">下载 Windows x64 版本</a>
  ·
  <a href="https://llm-reader.maaoding.icu/">项目主页与交互演示</a>
  ·
  <a href="https://llm-reader.maaoding.icu/docs/">使用文档</a>
</p>

当前版本 **v1.3.0**：TXT Markdown 阅读与恢复优化。[发布说明](docs/releases/v1.3.0.md) · [验收记录](docs/releases/v1.3.0-validation.md)

## 核心功能

- **连续阅读**：支持 EPUB、UTF-8 TXT 与 PDF，提供目录、书内搜索、摘录和阅读位置恢复。TXT 支持 Markdown 自动排版与按书切换。
- **有来源的问答**：选中原文即可提问；原文准备后可围绕整本书对话，或选择最多 5 本书比较观点。回答保留实际参考资料，有效引用可回到原文，未知引用标记为未验证。
- **笔记与归档**：按章节生成笔记，将有价值的回答保存到“问答集”，支持搜索、继续追问和 Markdown 导出。
- **按需增强**：支持助手设定、单轮联网搜索、PDF 图片提问，以及可选的 PDF 解析、逐页 OCR、Embedding 和 Rerank 服务。

书籍、进度、摘录、笔记和会话保存在本机，无需注册 LLM Reader 账号，不提供同步或遥测。普通阅读无需模型；AI 功能需自行配置服务，会发送所需文本、检索词、PDF 或图片，调用可能产生费用。凭据在本机加密保存，PDF 处理由你主动开始。

## 安装

- 从 [GitHub Releases](https://github.com/maaoding/llm-reader/releases/latest) 下载 Windows x64 安装程序。安装包未签名，Windows 可能显示安全提示。
- 已有版本可在“设置 → 关于”检查更新，点击“重启并安装”，或退出后手动运行新安装器；本机书库和配置继续沿用。
- MOBI/AZW3 导入需本机已安装 [Calibre](https://calibre-ebook.com/)，仅支持无 DRM 文件。

## 开始使用

1. 导入书籍，直接开始阅读。
2. 在“设置 → 模型服务”填写协议、Base URL、API Key 和模型，测试后保存并启用。
3. 选中原文点击“解释这段”；整本书或多书提问前，先完成“本书准备 → 原文准备”。
4. 按需生成章节笔记、开启阅读增强，在“问答集”归档回答或建立多书工作台。

支持 OpenAI 兼容与 Anthropic / Claude 原生协议。原文就绪即可提问，章节笔记和检索增强均为可选。

## 开发

Node.js 范围与 pnpm 版本以 [package.json](package.json) 为准。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

## 验证

```powershell
pnpm test:all
pnpm build:win --publish never
```

完整回归、CI、Windows 安装验收及真实服务评测见[开发与验证](docs/development.md)。源码测试、安装升级和真实服务质量分别验收。

## 文档

- [快速开始](https://llm-reader.maaoding.icu/docs/getting-started.html) · [常见问题](https://llm-reader.maaoding.icu/docs/faq.html)
- [用户手册源码](docs/manual/index.md)
- [模型与服务配置](docs/provider-configuration.md)
- [阅读增强](docs/knowledge-processing.md) · [视觉模型 OCR](docs/vision-ocr.md)
- [开发与验证](docs/development.md) · [Linux 环境](docs/development-environment.md) · [质量评测](docs/evaluation.md)
- [产品契约](PRODUCT.md) · [v1.3.0 发布说明](docs/releases/v1.3.0.md)

## 许可证

[GPL-3.0-or-later](LICENSE) · Copyright (C) 2026 wrh37。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
