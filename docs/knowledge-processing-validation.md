# 全书上下文二期验收记录

## 实现范围

2026-09-07：设置增加“知识处理”。Embedding 与文档处理使用各自的接口和加密密钥，问答及章节分析沿用原模型配置。向量存入本机 SQLite，不增加数据库服务或自动安装模型。

语义索引按书手动建立、暂停、续跑和重建；混合检索限定当前书，接口失败回退全文检索。PDF 可接入 MinerU 本地、MinerU 云端或 Docling Serve；文档处理后进入已有全书分析流程，页内引用支持返回原阅读位置。协议、限制和使用方法见[知识处理设置与接口说明](knowledge-processing.md)。

## 自动验收

测试使用隔离数据库、仓库生成的 TXT/PDF 样本和本机 HTTP 模拟接口。没有使用用户的 API Key，也没有上传个人书籍。

| 检查 | 覆盖内容 |
| --- | --- |
| `tests/unit/backend-knowledge.test.ts` | 密钥加密及接口隔离、配置变化、向量格式和维度、同义问法、批次恢复、删除时丢弃迟到响应、失败回退、Unicode 与重复段落、表格、页码校验、任务续跑、预签名上传鉴权隔离 |
| `tests/unit/backend-provider-transport.test.ts` | 旧数据库迁移与重复打开，保留已有分析指纹、时间戳、会话 UUID、摘要与失败记录 |
| `tests/e2e/knowledge-processing.spec.ts` | 当前未保存表单测试、保存与重启、配置草稿、真实请求头；TXT 建索引、暂停和重启续跑、同义提问；三种 PDF 服务的上传、暂停、复用远端任务、章节分析、引用与归档 |
| 既有 Electron E2E | EPUB/TXT/PDF 阅读、阅读位置、选区与高亮、全书分析恢复、归档追问和导出、Go 会话兼容 |

语义取材样本用“随大流”查找仅含“群体压力”的原文。固定模拟向量用于检查取材是否进入本轮证据；同时加入大量普通词命中，防止这些命中挤掉语义独有候选。它是流程回归，不代表真实 Embedding 模型的召回率评测。

## 桌面检查

使用 Playwright `_electron` 启动真实 Electron 应用，在浅色、深色及 1440×900、940×600 窗口下检查设置表单、复选框、滚动、测试和保存。检查语义索引进度、完成后的提问，以及 PDF 引用和返回阅读位置。

截图复查发现并修复了 PDF 页内位置被误作文字范围高亮、跳转后出现“无效的 PDF 定位锚点”的问题；PDF 引用现在只定位到处理服务提供的页内位置，不伪造文字选区。回归等待跳转完成，并检查没有错误提示。来源页码必须在实际 PDF 页数范围内；Docling 返回的页面集合还须覆盖全部页码。

截图位于 `test-results/knowledge-processing-*/`。该组 PDF 服务响应为模拟内容，只验证结构转换、定位和任务生命周期；后续真实 OCR 小样本结果另见 [MinerU 云端验收](mineru-live-validation.md)。

## 验证结果

`pnpm test:all` 通过：lint、typecheck、29 个文件中的 223 项单元测试、Electron 构建，以及 70 项 Electron E2E。1 项需要个人复杂 PDF 路径的既有测试跳过。新增的 5 项二期 E2E 全部通过。

最后补充的 Docling 集合解析优化和完整页码校验另通过类型检查、目标 ESLint 及 13 项知识处理单元测试。

`pnpm build:win --publish never` 通过，生成 `release/LLM Reader-0.4.0-setup.exe`，124,300,326 字节，时间为 2026-09-07 20:30:37（北京时间）。SHA-256：`449D5F1F597D46A9886545B74FAC138254FE168D07C8B791F60EB9B34329E3AF`。

通过 `LLM_READER_E2E_EXECUTABLE` 指向 `release/win-unpacked/LLM Reader.exe`，直接启动打包产物，专项 5 项 Electron E2E 全部通过（33.5 秒）。覆盖知识设置、TXT 混合检索、Docling、MinerU 本地和云端，使用隔离测试数据，无需安装应用。打包产物截图位于 `test-results/knowledge-packaged/`，已复查深色最小窗口及 PDF 引用。最终 `git diff --check` 通过。

## 外部服务验证边界

本文件记录的自动回归未连接真实 MinerU、Docling、Embedding 或 Go 付费接口。随后根据用户授权，已完成硅基流动与 Go 的[真实小样本验收](knowledge-live-validation.md)，其中一次规划超时后回退成功；2026-09-08 另完成 [MinerU 云端扫描 PDF 验收](mineru-live-validation.md)，并修复等待上传入队状态被误判为失败的问题。Docling、MinerU 本地、复杂文档 OCR 准确率及大样本向量召回仍未验证。未安装服务或应用、提交、推送或发布。
