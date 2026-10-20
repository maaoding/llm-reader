# 独立阅读样本评测与当前执行状态

记录日期：2026-10-20（UTC）。本轮新增固定材料与执行工具；当前环境没有已保存的模型或 PDF 处理配置，真实问答与人工语义复核仍阻塞。未将离线检查、模拟响应或引用编号有效记为回答质量通过。

后续按用户要求完成了本机模拟：12 题全部运行并逐题复核，11 题预期证据齐全，另 1 题保留取材缺口。模拟服务与实际供应商分开记录，详见[本机模拟结果](independent-reading-simulation.md)；下文的真实服务配置阻塞和 0/12 记录仍指真实模式。

## 固定材料

材料全部为新编的虚构种子档案与苗圃配送规程，不含用户书籍、此前评测的规则或模型生成的答案。正文为英文，问题为中文并保留关键英文名称。材料、问题及预期证据在任何模型调用前定稿；后续若修改样本，必须单独记录新版本和摘要，不能把同批调参结果称为独立验证。

| 材料 | 范围 | 检查重点 |
| --- | --- | --- |
| Glasshouse Seed Archive Handbook | 8 章 EPUB，249,032 个 Unicode 字符 | 事实分散在远隔章节；湿度条件、休眠例外、批准权限和时间起点 |
| Ridge Nursery Dispatch Addendum | 4 页数字 PDF | 双栏、跨页表格、数量与时间单位、脚注和操作顺序 |
| 同页图像扫描版 | 4 页、每页一张图像、无文字层 | OCR 后的数字、单位、条件与真实页码；不能以数字版提取结果冒充扫描版解析 |

12 个固定问题包含 4 个 EPUB 问题、3 个数字 PDF 问题、3 个扫描 PDF 问题和 2 个跨书问题，共标注 28 条原文证据。含无答案题，必须人工检查是否恰当说明资料不足。数字版与扫描版是相同内容的双胞胎，用于核对处理路径；不是两个独立内容样本。

固定摘要：

```text
fixtureSha256  da169d320649d5e86779008bb1293f50903004f31bd3a249ed7d1cfa9e5d1ad9
questionsSha256 c95f62c0994a5df4e3489b77cb181fb12ac57aeff3091e5f177db48fe53ef5ff
payloadSha256  35e63b1f591a018e3968a39492821bc40c1c72a45f813fad59106502ea10b3c6
EPUB           f55dd225370c494fd055801b9afef5ccb100bf19d3618bccc45e61b0cf091995
digital PDF    6a2911fce56377ae19acd537a62112e84abdabc18b42766ab2fd76b9697e71ca
scanned PDF    f1a862a5b88f321d92e1fdcdc7481765415ffdb02d68dfea1f0c563fbc99c2a5
```

`fixtureContract` 包含版本、标题、资料说明、问题及预期证据；`fixturePayload` 另含完整 EPUB 和 PDF 正文。生成文件与冻结清单位于忽略目录 `tmp/independent-reading-fixtures/`，生成器可从源码重建，不要求保存二进制到 Git。

## 已执行检查

- 两次独立生成的三份书籍和 manifest 哈希完全一致；EPUB 容器、XML、首项未压缩 mimetype 合法。
- 数字 PDF 的全部 10 条标注原文在指定页可回读；扫描版 4 页均无文字层，每页含一张图像。已查看双栏、表格和脚注页面，无截断。
- 新增的三项单元测试通过：选择配置及密文复制边界、文件篡改/路径越界拒绝、证据召回与引用和跨书归属分别计量且不自动判语义通过。相关脚本及测试 ESLint 通过。
- 已通过实际 Electron `--offline` 检查，退出码 0：三份材料全部走生产导入；EPUB 原文准备为 `ready`，提取 248,761 个 Unicode 字符、48/48 节完成，准备耗时 777 ms。正文提取计数与文件计数分别记录，不假定标题和所有标记都原样保留。数字 PDF 与扫描 PDF 仅确认导入，报告明确记录 `not-run-no-pdf-service`。
- 已实际执行默认条件检查与显式 `--run`：都报告 `SAVED_MODEL_PROFILE_MISSING`、`PDF_PROCESSOR_CONFIGURATION_MISSING`。显式运行在启动 Electron 或发送任何服务请求前退出，退出码 2，真实调用数为 0。

本机记录：`output/independent-reading-preflight-20261020/report.json`、同目录 `report.md`；真实模式的阻塞记录在 `output/independent-reading-live-blocked-20261020/`。这些文件保留题目、期望证据、冻结哈希与阻塞原因，没有回答或质量分数。

离线生产路径记录在 `output/independent-reading-offline-20261020/report.json` 和 `report.md`，状态为 `offline-fixtures-validated`。目前真实问答 **0/12 已执行**，也没有已完成的回答语义评分；提供可用的已有模型与 PDF 服务配置后才可继续。

## 复现

生成器使用现有 JSZip，以及当前 Python 已有的 ReportLab、PyMuPDF；没有新增项目依赖。先生成材料并检查配置，默认命令不会启动桌面或调用外部服务：

```bash
node scripts/independent-reading-generate.mjs
node scripts/independent-reading-eval.mjs \
  --source-user-data /absolute/path/to/saved-app-profile
```

构建应用后，在可用桌面环境运行离线导入检查。它使用一次性空书库，导入三份样本并走生产路径准备 EPUB；PDF 仅导入，原文准备和问答不执行：

```bash
pnpm build:app
node scripts/independent-reading-eval.mjs --offline
```

真实运行要求同一已保存应用配置目录中存在可用问答配置和已启用的 PDF 处理配置，并具有原来的系统加密上下文。可选 `--profile <id>` 选择已有模型；未指定时使用已激活的配置。脚本把所选设置和加密凭据复制到一次性目录，保留协议、自定义请求设置与加密请求头，不复制日常书库，不输出凭据。其他可选增强保持关闭，PDF 服务沿用所选设置，费用和处理时间由实际服务决定。

```bash
node scripts/independent-reading-eval.mjs --run \
  --source-user-data /absolute/path/to/saved-app-profile \
  --report-dir output/independent-reading-live
```

可用 `LLM_READER_REAL_API_SOURCE_USER_DATA`、`LLM_READER_REAL_API_PROFILE_ID` 代替相应参数。无桌面 Linux 需通过项目现有 Xvfb 启动方式执行；真实凭据运行应使用原系统密钥环，不能为了测试改为明文加密后端。`LLM_READER_E2E_EXECUTABLE` 可选择已安装的可执行文件，默认使用当前源码构建。

## 报告与判定

报告逐题保存实际应用请求、问题、当轮 context、完整回答、引用编号及来源映射、耗时、接口返回用量和规划用量。单书使用生产 `startLlm(scope: 'book')`；跨书创建独立工作台并使用同一生产多书请求路径。每题独立会话，不带历史。所有样本都先通过生产导入和原文准备，不注入人工分块或预设检索结果。

自动诊断分别记录原文召回、被引用的标注原文、未知引用及超出当轮书籍范围的来源。匹配仅做 NFKC 与空白归一化，OCR 改写或结构差异可能导致字面漏检，必须查看保留的原文。无答案题没有伪造的“召回满分”分母；预期词句命中也不等于答案正确。

每题仍需人工核对：主结论是否被原文支持、条件与例外是否完整、无答案时是否恰当说明、表格是否保留行列/单位、跨书是否区分各自规则，以及引用是否能定位到真实原文。JSON 中相应 `review` 字段初始为 `null`；生成完成只标为 `completed-awaiting-review`。目前这些字段全部尚未填，不能宣称模型质量已验收，也不能据少量合成样本推断真实书籍上的普遍准确率。
