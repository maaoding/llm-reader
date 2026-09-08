# OpenCode Go 请求兼容验证

2026-09-07，LLM Reader 0.4.0。测试只使用本机 HTTP 模拟服务与隔离用户数据目录，未读取日常密钥或向真实 Go 接口发送请求。

## 已实现

- 模型配置提供“自动／OpenCode Go”。官方 HTTPS origin 与 `/zen/go/v1/` 路径自动识别；中转显式启用，不根据模型名或相似域名判断。
- 主进程统一发送 `User-Agent: LLM-Reader/<app.getVersion()>`；Go 配置额外携带随机 UUID `x-opencode-session`。问答、规划、章节笔记、分层汇总、连接测试与模型列表均使用同一请求入口。
- 对话 ID 随追问、规划、重试与归档重开保持不变；清空历史形成新对话时更换。分析 ID 独立于执行批次 `jobId`，续跑保留，明确重建时更换。
- 第 10 次迁移为旧配置补默认适配模式，为旧归档与分析补持久 UUID；保留配置更新时间、原有自动模式分析指纹及历史引用快照。
- Go 请求拒绝自动重定向；明确的会话头拒绝错误转换成固定中文提示，避免无意义的流式降级和响应正文回显。

## 验证

| 检查 | 结果与范围 |
| --- | --- |
| 单元测试 | 205 项通过；含本地 HTTP 捕获、官方地址归一化与相似地址排除、配置与草稿隔离、规划和重试 ID 稳定、Go 重定向拒绝、安全错误提示、迁移重复执行及旧数据保留。 |
| 重点 Electron E2E | 4 项通过：TXT、有目录 EPUB、无目录 EPUB 的全书流程，以及中转设置。包含重启续跑、归档重启追问、范围切换、分析重建，以及明暗主题在 1440×900、940×600 窗口下的测试连接与保存。 |
| 完整回归 | `pnpm test:all` 通过：lint、typecheck、205 项单元测试、Electron 构建，64 项 Electron E2E 通过；1 项依赖另行指定个人 PDF 路径的既有用例跳过。 |
| Windows 构建 | `pnpm build:win --publish never` 通过，生成 `release/LLM Reader-0.4.0-setup.exe`；未安装或发布。 |

复现命令：

```powershell
pnpm test:all
pnpm build:win --publish never
```

桌面截图位于 `test-results/provider-compatibility-*/go-settings-*.png`，包括设置字段和底部操作区。已检查明暗主题及正常、最小窗口截图；内容通过现有设置面板滚动访问。

真实 Go 连通性、服务端是否接受特定使用方式以及中转上游是否透传请求头，均未由本轮本地测试验证。旧的全书理解真实接口评测是此前的独立记录，不作为本次请求头适配的联网证据。

## 测试临时目录

两次早期断言失败留下的模拟配置目录仍保留：

- `C:\Users\wrh37\AppData\Local\Temp\llm-reader-provider-3ipe21`
- `C:\Users\wrh37\AppData\Local\Temp\llm-reader-provider-8S98LT`

对上述明确目录的清理被自动审批拒绝，工具仅返回 `blocked by policy`，没有提供具体原因，因此未换用其他方式删除。目录只包含本轮测试生成的模拟数据；测试清理逻辑已补上失败时关闭数据库，之后的通过运行正常清理各自目录。
