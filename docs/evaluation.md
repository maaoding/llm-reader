# 质量评测

本页说明可重复运行的评测入口。源码回归与安装验收见[开发与验证](development.md)，已发布版本的结果见[发布验收记录](releases/v1.3.0-validation.md)。单次评测报告保存在忽略目录 `output/` 或 `tmp/`，不作为新的仓库指南提交。

## 评测入口

| 命令 | 默认行为 | 真实服务模式 | 结果位置 |
| --- | --- | --- | --- |
| `pnpm eval:offline` | 校验冻结样本的逐题证据、裁剪结果及来源；退化时退出码为 1 | 无，不接受真实服务开关 | `output/offline-evaluation-*/` |
| `pnpm eval:book-context` | 检查已有模型配置与固定样本，不调用模型 | 显式添加 `--run` | `tmp/book-context-eval-*/` |
| `pnpm eval:rerank` | 运行固定 24 题本地取材对照 | 显式添加 `--live` | `output/rerank-evaluation/` |
| `pnpm eval:document-structure` | 运行文档结构固定样本检查，不调用外部服务 | 无 | `output/document-structure-validation/structure-evaluation.json` |
| `pnpm eval:independent-reading` | 检查冻结材料与已保存配置，不启动桌面或调用外部服务 | 显式添加 `--run` | `output/independent-reading-*/`，可用 `--report-dir` 指定 |

执行需要 Electron 的模式前先运行 `pnpm build:app`，并准备可用桌面环境。无桌面 Linux 的启动方法见[开发环境](development-environment.md)。`LLM_READER_E2E_EXECUTABLE` 可改为指定已安装的可执行文件。

## 离线验收基线

```powershell
pnpm --config.verify-deps-before-run=error eval:offline
```

该命令复用下方重排对照和文档结构评测的生产取材路径，使用内存数据库，无需 Electron、模型配置或私人书库。固定检查 current、expanded 两组各 24 题，以及 retained-24、structure-24 两组各 24 题；各组正常与缩减预算均须保留全部预期证据和适用的章节覆盖，来源位置与引用编号须有效。缺题、重复题、错误来源、证据丢失或意外 fetch 调用均判定失败。真正调用 Rerank 的组必须保持未执行状态。

每次生成独立目录，可用 `--report-dir output/my-offline-check` 指定一个尚不存在的目录；已有报告不会被覆盖。`report.md` 提供摘要，`report.json` 保存失败项、版本、提交、工作区修改状态、Node 版本与输入摘要；`retrieval.json` 和 `document-structure.json` 保留逐题实际原文。评测前后再次核对输入摘要，运行中改变源码会判定失败。

基线 `offline-retrieval-v1` 冻结了原文和问题的 SHA-256。调整样本应复核并更新 `scripts/offline-eval-checks.ts` 的基线标识与摘要，不能自动接受新分数或降低阈值。无答案题单列为取材约束，不把空的证据分母记成回答正确；离线通过不代表真实模型、OCR、解析质量或回答语义正确。真实问答与人工复核继续使用下方的独立阅读流程。

## 全书问答对照

`pnpm eval:book-context --run` 使用自建三章 TXT，对原有局部上下文与全书增强分别回答固定问题，不带历史。默认使用当前模型，可用 `LLM_READER_REAL_API_PROFILE_ID` 指定另一套已有配置；`LLM_READER_REAL_API_SOURCE_USER_DATA` 可指定配置目录。

评测只将所选设置、加密凭据及其本机加密上下文复制到隔离目录，不复制日常书库。`report.json` 和 `report.md` 保留实际原文、回答、引用与服务返回用量，回答是否被原文支持仍需人工复核。

## 重排对照

本地模式比较当前检索与扩大候选，检查候选、最终原文和预算缩减后的证据命中及章节覆盖，不生成问答。真实模式额外比较相同候选经过服务排序后的结果：

```powershell
pnpm eval:rerank
pnpm eval:rerank --live
```

真实模式需要通过 `LLM_READER_RERANK_API_KEY` 提供已获授权的凭据，可用 `LLM_READER_RERANK_BASE_URL` 和 `LLM_READER_RERANK_MODEL` 指定兼容服务。只发送自建问题与候选原文，调用可能产生费用；这项对照不代表完整问答或任意书籍上的质量提升。

## 独立阅读样本

固定材料包括长篇 EPUB、数字 PDF、同内容的扫描 PDF，以及 12 个单书与跨书问题。生成器使用项目已有的 JSZip，并需要 Python 的 ReportLab 和 PyMuPDF。先生成材料，再检查条件：

```powershell
node scripts/independent-reading-generate.mjs
pnpm eval:independent-reading
```

材料位于 `tmp/independent-reading-fixtures/`。评测会核对冻结的材料与问题摘要；更改样本后应单独记录版本，不沿用原样本的分数。

### 离线与模拟

```powershell
pnpm build:app
pnpm eval:independent-reading --offline
pnpm eval:independent-reading --simulate --report-dir output/independent-reading-simulation
```

`--offline` 使用一次性书库导入三份材料并准备 EPUB 原文；PDF 仅导入，不调用解析或问答服务。

`--simulate` 使用本机模拟规划与 PDF 服务，无需真实凭据。它会等待 `queue/request-NNN.json` 对应的回答；读者仅根据请求中实际提供的原文作答，写入同编号的 `answer-NNN.txt` 后继续。模拟流程验证不代表真实模型、解析或 OCR 的质量。

### 真实服务

同一已保存配置目录中需要有可用问答模型和已启用的 PDF 处理配置，并保留原系统加密上下文：

```powershell
pnpm eval:independent-reading --run --source-user-data /absolute/path/to/saved-app-profile --report-dir output/independent-reading-live
```

可用 `--profile <id>` 选择已有模型，或使用 `LLM_READER_REAL_API_SOURCE_USER_DATA`、`LLM_READER_REAL_API_PROFILE_ID` 环境变量。脚本只复制所需配置与加密凭据到一次性目录，不复制个人书库；资料发送给所选模型与 PDF 服务，可能产生费用。

`--run`、`--offline` 和 `--simulate` 互斥。缺少材料或配置时先查看报告中的 `blockedReasons`，不要把未执行记为通过。

## 判定结果

报告分别记录实际取材、原文召回、引用编号、书籍归属、耗时和服务用量。引用编号有效或命中预期词句，不能证明回答含义正确。

人工复核应核对结论、条件与例外、无答案时的说明、表格行列与单位、跨书规则归属，以及引用能否回到真实原文。尚未完成语义复核的结果保持待复核状态；本机模拟、真实接口与安装包验收分别记录，不用一次历史结果代替当前版本的验证。
