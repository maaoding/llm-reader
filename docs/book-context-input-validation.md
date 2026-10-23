# 全书问答切换范围后的输入验证

记录日期：2026-10-23（UTC）。基于 `f26b2cc`，修复全书问答桌面测试在切换会话范围后的输入时序。

## 故障与原因

[主分支 Windows CI](https://github.com/maaoding/llm-reader/actions/runs/39874004840) 中代码检查通过；桌面回归 135 项通过、2 项失败、1 项可选私有 PDF 跳过。失败的是 `book-context.spec.ts` 的 TXT 和无目录 EPUB 用例，均在切换“选中内容 → 全书”后的第二次提问中等不到回答。

切换范围时，应用先保存旧会话，期间使用 `inert` 暂停输入区交互。Playwright 的 `fill()` 不等待祖先节点解除 `inert`，可能在没有聚焦、没有写入文本的情况下返回，随后的回车也没有发出问题。

本机使用原测试复现：三种格式中 2 项通过、1 项 EPUB 在同一位置失败。诊断时临时将 `sessions:save` 延迟 750 毫秒，旧输入步骤仍失败，`fill()` 前后均为 `inert: true`、未聚焦、文本为空。修改后，相同延迟条件下用例通过，填写后为 `inert: false`、已聚焦、文本与问题一致。

## 修复与验证

提问 helper 先点击输入框，利用点击的可交互性检查等待输入区可接收操作；填写后断言文本内容和发送按钮可用，再按回车并验证回答与引用。临时延迟和诊断日志已移除。

- `pnpm build:app` 通过；本次仅修改测试，应用构建与基线一致。
- `pnpm lint`、`pnpm typecheck` 通过。
- `book-context.spec.ts --repeat-each=3`：TXT、有目录 EPUB、无目录 EPUB 各运行三次，9 项全部通过，耗时 1.1 分钟，无重试、无跳过。覆盖分析、取材与 rerank 降级、引用导航、归档、重启恢复和导出流程。
- Windows 完整回归由本分支 PR 的 Application CI 单独记录。

本机使用隔离书库、合成材料和模拟接口；运行记录保存在忽略目录 `output/scope-transition-baseline-*`、`output/scope-transition-delayed-*`、`output/scope-transition-delayed-fixed-*` 和 `output/scope-transition-final-*`。
