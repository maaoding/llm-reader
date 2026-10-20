# 会话恢复与列表读取失败验证

记录日期：2026-10-20（UTC）。基于 `40ec2fe` 的工作区改动；没有推进版本号或发布安装包。

## 行为

- 会话标签及其所需归档读取、恢复完成后才开放自动保存和退出保存。读取失败保留已存标签，显示常显错误及重试；关闭期间的迟到结果不应用。
- 恢复顺序、激活项及归档草稿；保留暂未加载内容的其他书籍会话标签。重试前未编辑的归档恢复原草稿，已改写或主动清空的草稿保留本轮输入。
- 恢复期间主动关闭的标签不会被重试重新打开；用户仍可明确再次打开它。
- 问答集、摘录读取失败显示可重试错误，不展示正常空列表提示。失败刷新不替换现有记录；切书后旧摘录请求的成功、失败及结束状态均不能覆盖当前书的状态。

## 已执行验证

环境为 Linux、Node 24.19.0、Electron 44.7.2；桌面回归通过 Xvfb、D-Bus 与 Xfwm4 运行。每项测试使用隔离临时书库和合成资料；未调用真实模型。

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | TypeScript 7.0.2，两份配置通过 |
| `pnpm test` | 56 文件、492 项通过 |
| `pnpm build:app` 及最终 `pnpm build:electron` | 文案校验、主进程、预加载及 Renderer 构建通过 |
| 标签恢复故障回归 | 新增 10 项通过 |
| 列表读取故障回归 | 新增 3 项通过 |
| 相关既有桌面回归 | 14 项通过 |
| 最终桌面批次 | 27 项通过、0 失败、0 跳过、0 flaky，retries=0 |
| `git diff --check` | 通过 |

最终桌面批次包含 `session-tabs-recovery`、`list-load-recovery`、`session-persistence`、`highlights-navigation`、`insights-workspace-export`、`book-tabs`、`book-deletion` 和 `ui-language`。故障由隔离 Electron 主进程中的读取 IPC handler 注入，不改变生产预加载接口或权限；同时观察实际标签保存调用，检查读取失败和关闭时旧快照没有被覆盖。

本机报告在 `output/recovery-20261020/final.json` 和 `final-html/`。首轮报告保留在 `regression.json`：新增测试曾因断言外层容器上的不存在属性、以及无当前书时仍假定对话页可见而失败；修正定位和页面前置条件后完成上述最终批次。未删除相关断言或启用重试来掩盖失败。

这不是完整桌面套件、Windows 安装或升级验收。独立阅读质量评测的材料、离线执行和真实服务配置阻塞另见[独立阅读样本评测记录](independent-reading-validation.md)。
