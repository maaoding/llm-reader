# LLM Reader 文案

## 书籍工作台

| key | text |
| --- | --- |
| workspace.navigation | 主导航 |
| workspace.reading | 阅读 |
| workspace.notes | 章节笔记 |
| workspace.conversation | 对话 |
| workspace.prepare | 本书准备 |
| workspace.library | 书库 |
| workspace.archives | 回答归档 |
| workspace.continue | 继续阅读 |
| workspace.backLibrary | 返回书库 |
| workspace.readingProgress | 已读 {percent}% |
| workspace.noteCount | 已完成 {completed}/{total} 条笔记 |
| workspace.tabs | 本书页面 |
| workspace.bookTabs | 打开的书籍 |
| workspace.closeBookTab | 关闭《{title}》 |
| workspace.librarySearch | 搜索书名或作者 |
| workspace.libraryCount | {count} 本书 |
| workspace.libraryNoResults | 没有找到这本书 |
| workspace.libraryNoResultsHint | 换一个书名或作者试试。 |
| workspace.optional | 可选 |
| preparation.title | 本书准备 |
| preparation.close | 关闭本书准备 |
| preparation.intro | 准备好原文就能全书提问。章节笔记和按含义查找可按需开启。 |
| preparation.original | 原文准备 |
| preparation.basic | 全书提问的基础 |
| preparation.local | 在本机提取文字与章节结构，无需模型服务。 |
| preparation.pdf | 将整份 PDF 发送到所选文档服务，提取文字与结构。 |
| preparation.pdfGuide | 复杂论文、表格和公式优先使用 MinerU 或 Docling；逐页 OCR 建议先识别一页并对照原 PDF。 |
| preparation.pageOcr | 使用专门 OCR 服务逐页识别 PDF 文字。当前接入按页保存文字，不保留完整表格结构。 |
| preparation.pageOcrDisclosure | 准备时逐页发送图片至所选 OCR 服务，可能消耗额度。完成页保存在本机，暂停后可继续；识别结果和复杂版式仍需对照原 PDF 核验。 |
| preparation.documentProgress | 已处理 {completed}/{total} 项 |
| preparation.notesHint | 整理书中的观点、概念和适用条件，帮助理解章节之间的联系。 |
| preparation.semanticHint | 帮助找到意思相近、用词不同的原文。 |
| preparation.prepare | 准备原文 |
| preparation.pause | 暂停准备 |
| preparation.resume | 继续准备 |
| preparation.retry | 重试准备 |
| preparation.rebuild | 重新准备原文 |
| preparation.rebuildConfirm | 重新准备原文？这会重建章节结构，已有章节笔记和含义查找索引需要重新建立。回答归档会保留。 |
| preparation.notesRebuildConfirm | 重新生成章节笔记？已有笔记将被替换，原文、含义查找索引与回答归档保留。 |
| preparation.semanticRebuildConfirm | 重建含义查找索引？已有索引将被替换，原文、章节笔记和回答归档保留。 |
| preparation.document.empty | 尚未准备原文 |
| preparation.document.preparing | 正在准备原文 |
| preparation.document.paused | 原文准备已暂停 |
| preparation.document.ready | 原文已就绪 |
| preparation.document.error | 原文准备未完成 |
| preparation.check | 文档检查 · {count} 条提示 |
| preparation.checkHint | 这些提示表示可能存在解析问题，请对照原文检查；不代表 OCR 准确率。 |
| preparation.checkLimit | 共 {count} 条，显示前 100 条。 |
| preparation.pageDiagnostic | 第 {page} 页：{message} |
| preparation.missingBody | 本页缺少正文 |
| preparation.unknownStructure | 结构无法识别，已保留文字 |
| preparation.unlinkedNote | 脚注缺少明确关联 |
| preparation.tableDegraded | 表格结构异常，已保留为文字 |
| preparation.duplicate | 疑似重复内容，已保留原文 |
| preparation.configureModel | 设置模型服务 |
| preparation.configureDocument | 设置 PDF 服务 |
| preparation.configureSemantic | 设置含义查找服务 |
| preparation.details | 处理说明 |
| preparation.stopFailed | 无法暂停原文准备，请重试。 |
| notes.title | 章节笔记 |
| notes.hint | 以下内容由模型整理。查看引用原文，核对观点和适用范围。 |
| notes.empty | 还没有可阅读的笔记 |
| notes.emptyHint | 准备好原文后，可在“本书准备”中生成章节笔记。 |
| notes.partial | 已完成的笔记可以先读，后续结果会继续补充。 |
| notes.overview | 全书概述 |
| notes.chapterSummary | 本章概述 |
| notes.claims | 观点与论据 |
| notes.conditions | 适用条件 |
| notes.exceptions | 例外与限制 |
| notes.concepts | 概念 |
| notes.more | 加载更多笔记 |
| notes.loading | 正在读取笔记… |
| notes.failed | 无法读取笔记，请重试。 |
| notes.changed | 笔记已更新，请重新打开本章。 |
| notes.unavailableSource | 部分原文来源不可用 |
| notes.sources | 查看引用原文 |
| notes.chapterEmpty | 本章笔记尚未生成 |
| notes.chapterEmptyHint | 生成期间可以先阅读已完成的其他章节。 |
| notes.navigation | 笔记章节 |
| notes.aliases | 也称：{names} |
| assistant.needModel | 先设置模型服务，才能发送问题。 |
| assistant.needDocument | 先准备原文，才能从整本书查找答案。 |
| assistant.selectionReady | 已选中原文 |
| assistant.selectionPending | 尚未选中原文 |
| assistant.questionAria | 输入问题 |
| assistant.busyHint | 正在回答，可先写下一个问题。 |
| assistant.queued | 已排队，前面还有回答在生成。 |
| assistant.clearSession | 清空会话 |
| assistant.clearSessionQuestion | 清空当前会话？ |
| assistant.bookEmptyTitle | 从书中寻找答案 |
| assistant.bookEmptyHint | 询问书中的观点、概念或章节联系，回答会附上本次参考的原文。 |
| reader.contentsButton | 目录 |
| reader.layoutButton | 排版 |
| reader.displayButton | PDF 工具 |
| reader.toolsAria | 阅读工具 |
| sources.wholeTable | 此处只能定位到整张表所在的页面。 |

本文件是应用自有用户可见文案的唯一来源。`key` 不可重复，动态内容使用 `{name}` 占位符。

## 通用

| key | text |
| --- | --- |
| knowledge.title | 阅读增强 |
| knowledge.description | 按需配置 PDF 解析、含义查找和原文排序服务，各项设置独立保存。 |
| rerank.title | 原文排序（Rerank） |
| rerank.enabled | 启用原文排序 |
| rerank.hint | 提问时对候选原文重新排序。问题和候选原文会发送到所选服务，最多额外等待 5 秒；失败时继续使用原有顺序。使用兼容 /rerank 的服务地址，模型和密钥独立配置。 |
| rerank.model | 重排模型 |
| rerank.test | 测试排序服务 |
| rerank.testOk | 重排接口检查通过。 |
| rerank.required | 请填写重排接口地址和模型。 |
| rerank.invalid | 重排服务返回的排序结构无效。 |
| rerank.applied | 已优化原文顺序 |
| rerank.fallback | 排序服务未完成，已使用原有顺序 |
| rerank.skipped | 本次沿用原文检索顺序 |
| knowledge.embeddingTitle | 按含义查找（Embedding） |
| knowledge.embeddingEnabled | 启用按含义查找 |
| knowledge.embeddingHint | 填写兼容 /v1/embeddings 的服务地址和模型。本机服务可不填密钥。保存后，在“本书准备”中建立索引。 |
| knowledge.baseUrl | 接口地址 |
| knowledge.model | Embedding 模型 |
| knowledge.apiKey | API Key（可选） |
| knowledge.keySaved | 已保存密钥；留空保留 |
| knowledge.keyEmpty | 未保存密钥 |
| knowledge.clearKey | 清除已存密钥 |
| knowledge.endpointHint | 更换接口地址或文档服务时，请重新填写密钥。 |
| knowledge.documentTitle | PDF 解析 |
| knowledge.processor | 处理服务 |
| knowledge.none | 未启用 |
| knowledge.mineruLocal | MinerU 本地服务 |
| knowledge.mineruCloud | MinerU 云服务 |
| knowledge.docling | Docling Serve |
| knowledge.documentHint | Docling Serve 和 MinerU 本地服务填写服务根地址；MinerU 云服务填写 https://mineru.net。需要自行部署本地服务，应用不会自动安装。 |
| knowledge.processorGuide | 复杂论文、表格和公式优先选 MinerU 或 Docling；扫描页只需文字可选 Mistral OCR 或 Unstructured；已有兼容模型时可用视觉模型 OCR，并先试一页。 |
| knowledge.ocr | 启用 OCR |
| knowledge.language | 识别语言 |
| knowledge.ch | 中文 |
| knowledge.en | 英文 |
| knowledge.testEmbedding | 测试 Embedding |
| knowledge.testDocument | 检查处理服务 |
| vision.title | 视觉模型 OCR |
| vision.model | 视觉模型名称 |
| vision.hint | 使用支持图片输入的 OpenAI 兼容或 Anthropic 接口逐页识别 PDF 文字，可与提问模型分开配置。先用固定样图测试，再试本书一页；测试可能消耗额度。 |
| vision.preparation | 使用兼容的视觉模型逐页识别 PDF 文字，结果可用于全书提问和章节笔记；复杂表格与章节结构需核对。 |
| vision.disclosure | 点击准备后，会逐页发送图片至所配置的模型服务，可能产生费用。已完成页保存在本机，暂停、失败或退出后可手动继续；未完成页可能重复计费。原 PDF 保留，引用可返回页面核对。识别结果可能有误，暂不生成可选择的文字层，也不保证复杂表格与章节结构。 |
| vision.progress | 已识别 {completed}/{total} 页 |
| vision.test | 测试图片识别 |
| vision.testOk | 样图文字识别成功。实际 PDF 的识别质量仍需对照原文核验。 |
| vision.testFailed | 未能正确识别样图。请确认接口和所选模型支持图片输入，再重试。 |
| vision.configRequired | 请填写视觉模型接口地址及模型名称。 |
| vision.renderFailed | 无法生成当前 PDF 页的识别图片。请检查文件后重试；已完成页会保留。 |
| vision.invalidResponse | 模型未返回有效的识别文字。请确认所选模型支持图片输入后重试。 |
| vision.incomplete | 当前页识别被截断或未能完成，未保存不完整结果。请检查模型的输出限制后重试。 |
| vision.emptyDocument | 识别完成，但未提取到可用文字。请检查 PDF 内容或更换视觉模型后重新准备。 |
| knowledge.testHint | Embedding 测试发送固定短文本，视觉模型测试发送固定样图，可能消耗额度；各项检查均不发送书籍。 |
| knowledge.testOk | 接口检查通过。 |
| knowledge.documentTestOk | 服务接口可用。实际文档处理需在书籍中验证。 |
| knowledge.save | 保存设置 |
| knowledge.saved | 已保存阅读增强设置。 |
| knowledge.testing | 正在检查… |
| knowledge.indexTitle | 按含义查找 |
| knowledge.indexStart | 建立含义查找索引 |
| knowledge.indexResume | 继续建立索引 |
| knowledge.indexRebuild | 重建含义查找索引 |
| knowledge.indexCancel | 暂停建立索引 |
| knowledge.indexDisclosure | 将本书原文分批发送至 Embedding 服务，可能消耗额度。索引保存在本机；提问时也会向该服务发送问题以查找相关原文。暂停或退出后不会自动继续。 |
| knowledge.pdfDisclosure | 准备 PDF 会发送整份文件至文档处理服务。暂停只停止本机等待，远端任务可能继续运行；续跑优先读取同一任务。识别文字可能有误，引用可返回 PDF 页面核对。 |
| knowledge.pdfRequired | 先到“设置 → 阅读增强”配置 PDF 解析服务。 |
| knowledge.pdfPage | 第 {page} 页 |
| knowledge.indexProgress | 已建立索引 {completed}/{total} 段 |
| knowledge.status.disabled | 尚未启用 |
| knowledge.status.empty | 尚未建立索引 |
| knowledge.status.indexing | 正在建立索引 |
| knowledge.status.paused | 索引已暂停 |
| knowledge.status.ready | 可以按含义查找 |
| knowledge.status.error | 索引未完成 |
| knowledge.status.stale | 服务设置已变化，需要重建索引 |
| knowledge.indexChanged | 含义查找服务设置已变化，需要重建索引。章节笔记会保留。 |
| knowledge.indexBusy | 另一本书正在建立索引，请先暂停。 |
| knowledge.embeddingRequired | 请在阅读增强设置中配置并启用按含义查找。 |
| knowledge.vectorInvalid | Embedding 返回的向量数量、维度或数值无效。已保留完成进度。 |
| knowledge.secretError | 无法安全保存或读取此密钥，请重新填写。 |
| knowledge.httpError | 阅读增强服务返回 HTTP {status}，请检查地址、密钥和服务状态。 |
| knowledge.redirect | 接口返回跳转，请填写最终服务地址。 |
| knowledge.timeout | 阅读增强服务响应超时。重试时会复用已保存的进度。 |
| knowledge.network | 阅读增强服务连接中断，请检查服务设置后重试。 |
| knowledge.invalid | PDF 服务返回的文字结构或页码无效，尚未完成原文准备。 |
| knowledge.tooLarge | 处理内容超出本机限制，请使用较小的文档或较低维度的 Embedding 模型。 |
| knowledge.documentFailed | PDF 原文准备未完成。可以重试读取已有任务；任务失败或过期时，请重新准备原文。 |
| knowledge.cloudKey | MinerU 云服务需要 API Token。 |
| knowledge.documentChanged | PDF 服务设置已变化，请重新准备原文。回答归档会保留。 |
| settings.compatibilityLabel | 请求适配 |
| settings.compatibilityAuto | 自动（默认） |
| settings.compatibilityGo | OpenCode Go |
| settings.compatibilityHint | 官方 Go 地址会自动适配。通过中转调用 Go 时请选择 OpenCode Go，并确保中转支持透传会话标识。 |
| error.providerRedirect | Go 接口返回了跳转。请在模型配置中填写最终接口地址后重试。 |
| error.providerSessionRejected | 接口拒绝了 Go 会话标识。请检查请求适配设置，并确认中转支持透传会话标识。 |
| analysis.scopeLabel | 提问范围 |
| analysis.selection | 选中内容 |
| analysis.book | 整本书 |
| analysis.prepare | 生成章节笔记 |
| analysis.resume | 继续生成笔记 |
| analysis.rebuild | 重新生成章节笔记 |
| analysis.cancel | 暂停生成笔记 |
| analysis.profile | 生成笔记使用的模型 |
| analysis.disclosure | 分批发送已准备的原文至所选模型，可能消耗额度。暂停或退出后不会自动继续。 |
| analysis.needed | 先准备原文。完成后即可整本书提问，章节笔记和含义查找可稍后开启。 |
| analysis.unsupported | 当前书籍尚不支持原文准备，可以先阅读或解释可选中的文字。 |
| analysis.textSection | 文本分节 |
| analysis.failed | 章节笔记未完成，已保留进度。可以继续生成。 |
| analysis.summaryTooLong | 汇总返回了 {count} 字符，超过 {limit} 字符上限。已保留进度。 |
| analysis.summaryEmpty | 汇总未返回有效正文。已保留进度。 |
| analysis.noteInvalid | 分节笔记的格式或长度不符合要求。已保留进度。 |
| analysis.referenceInvalid | 分节笔记引用了本节不存在的原文编号。已保留进度。 |
| analysis.responseTooLarge | 分析响应超出长度限制。已保留进度。 |
| analysis.networkError | 分析请求连接中断。已保留进度。 |
| analysis.timeout | 分析请求超过 3 分钟未完成。已保留进度。 |
| analysis.stage.sections | 整理章节内容 |
| analysis.stage.chapters | 汇总各章笔记 |
| analysis.stage.overview | 整理全书概述 |
| analysis.stageProgress | {stage}：{completed}/{total} |
| analysis.retrying | 正在重试当前步骤（{attempt}/3），已完成结果会继续复用。 |
| analysis.recentFailures | 最近失败记录 |
| analysis.disclosureRetry | 临时错误时每步最多尝试 3 次，重试可能消耗额度。重新生成只替换笔记，原文、含义查找索引与回答归档保留。 |
| analysis.busy | 另一本书正在准备原文或生成笔记，请先暂停该任务。 |
| analysis.changed | 笔记所用配置已变化，请重新生成章节笔记。 |
| analysis.tooLarge | 本书内容超出分析限制，请使用较小的分册。 |
| analysis.sourceCount | 本次参考原文 · {count} 处 |
| analysis.coverage | 已使用笔记 {covered}/{total} 节 |
| analysis.bookQuestion | 询问本书的观点、概念或章节联系… |
| analysis.bookSource | 全书问答 |
| analysis.status.empty | 尚未生成笔记 |
| analysis.status.stale | 笔记需要重新生成 |
| analysis.status.extracting | 正在准备原文 |
| analysis.status.analyzing | 正在生成笔记 |
| analysis.status.paused | 已暂停 |
| analysis.status.ready | 章节笔记已完成 |
| analysis.status.error | 笔记尚未完成 |
| analysis.status.unsupported | 暂不支持章节笔记 |
| app.name | LLM Reader |
| common.retry | 重试 |
| common.confirm | 确认 |
| common.back | 返回 |
| common.currentChapter | 当前章节 |
| common.unknownAuthor | 未知作者 |
| window.controlsAria | 窗口控制 |
| window.minimizeAria | 最小化 |
| window.maximizeAria | 最大化 |
| window.restoreAria | 还原 |
| window.closeAria | 关闭 |

## 关于

| key | text |
| --- | --- |
| about.title | 关于 |
| about.versionLabel | 版本 |
| about.versionUnknown | 未知 |
| about.licenseLabel | 许可证 |
| about.licenseValue | GPL-3.0-or-later |
| about.licenseNotice | 本软件按 GNU General Public License v3 或更高版本发布。 |
| about.copyright | © 2026 wrh37 |
| about.repositoryLabel | 源码仓库 |
| about.repositoryUrl | https://github.com/maaoding/llm-reader |
| about.thirdPartyNoticesTitle | 第三方许可证 |
| about.thirdPartyNoticesIntro | 本软件使用了以下开源组件： |
| about.noticeElectron | Electron（MIT） |
| about.noticeElectronUpdater | electron-updater（MIT） |
| about.noticeEpubjs | epub.js（BSD-2-Clause） |
| about.noticeJszip | JSZip（MIT OR GPL-3.0-or-later） |
| about.noticeLocalforage | localforage（Apache-2.0） |
| about.noticePdfjs | PDF.js（Apache-2.0） |
| about.noticeLucide | lucide-react（ISC） |
| about.noticeReact | React、React DOM（MIT） |
| about.noticeZod | Zod（MIT） |
| about.thirdPartyNoticesFull | 完整许可文本见仓库中的 THIRD_PARTY_NOTICES.md。 |
| about.updateLabel | 更新 |
| about.updateStatusIdle | 尚未检查更新 |
| about.updateStatusChecking | 正在检查更新… |
| about.updateStatusUpToDate | 已是最新版本 |
| about.updateStatusAvailable | 发现新版本 {version} |
| about.updateStatusDownloading | 正在下载更新… {percent}% |
| about.updateStatusDownloaded | 更新已下载完成 |
| about.updateStatusError | 更新失败，请稍后重试 |
| about.updateStatusUnsupported | 当前环境不支持更新检查 |
| about.updateCheckAction | 检查更新 |
| about.updateDownloadAction | 下载更新 |
| about.updateInstallAction | 重启并安装 |
| about.updateNotesTitle | 更新内容 |
| about.updateDownloadedHint | 重启后安装新版本，未保存的阅读进度不受影响。 |

## 助手与对话

| key | text |
| --- | --- |
| assistant.title | 阅读助手 |
| assistant.viewsAria | 阅读助手视图 |
| assistant.tabInsights | 回答归档 |
| assistant.tabCurrent | 当前对话 |
| assistant.closeTab | 关闭会话标签 |
| assistant.emptyTitle | 选中原文，开始理解 |
| assistant.emptyDetail | 回答会结合当前选区及附近段落。 |
| assistant.sourceTitle | 选中的原文 |
| assistant.sourceSummary | {chapter} · 参考附近 {count} 段原文 |
| assistant.backToSource | 回到原文 |
| assistant.thinking | 正在结合原文思考 |
| assistant.generatingAria | 正在生成 |
| assistant.modelUnavailable | 未知模型 |
| assistant.tokenUsage | 用量 {count} tokens |
| assistant.save | 保存回答 |
| assistant.saved | 已保存 |
| assistant.regenerate | 重新生成 |
| assistant.editQuestion | 编辑问题 |
| assistant.searchConversation | 搜索当前会话 |
| assistant.searchTurns | {count} 轮匹配 |
| assistant.insightLabel | 已保存的回答 |
| assistant.insightFollowupLabel | 追问 |
| assistant.stop | 停止生成 |
| assistant.placeholderFollowup | 继续追问这段原文… |
| assistant.placeholderFirst | 针对这段原文提问… |
| assistant.placeholderNoSelection | 写下问题，发送前先选中原文… |
| assistant.sendAria | 发送问题 |
| assistant.actionExplain | 解释这段 |
| assistant.actionContext | 联系上下文 |
| assistant.actionAsk | 自由提问 |
| assistant.actionSaveHighlight | 摘录这段 |
| assistant.questionExplain | 请解释我选中的原文，帮助我读懂它，而不只是换一种说法。先用一两句话说清核心意思，再按理解需要解释关键概念在这里的含义，理清指代、转折或因果；若涉及论证，说明作者的主张、依据与成立条件。简化表达时保留原文的限定、否定和语气，不把可能性说成必然，也不把作者的观点当成公认事实。必要时用一个简短的假设例子辅助理解，并标明是示例。以本次提供的原文为依据，引用关键语句支撑解释，区分明确表述与推断；遇到歧义或信息不足，说明具体不确定之处。用自然、清楚的中文直接回答，篇幅随内容难度调整，不机械套用固定栏目，不复述整段原文或反复总结。 |
| assistant.questionContext | 请以我选中的原文为中心，结合本次实际提供的前后文和相关原文，说明它在文本中的作用。先点明最重要的上下文联系，再解释它承接了什么问题或观点，以及它是在定义、举例、推进论证、转折、反驳、补充限制还是形成结论，指出体现这种关系的具体词句。论述性内容要说清相关前提与结论的联系；叙事或描写则关注人物、情节或主题，不强套论证结构。引用实际提供的关键原文支撑分析，区分原文依据、背景笔记与推断；不要把检索片段的排列当作原文顺序，也不要据此虚构全书主旨。上下文不足时，先说明能确定的关系，再指出缺少什么。用自然、清楚的中文连贯说明，围绕选区展开，避免泛泛评价、整章摘要和固定栏目。 |
| assistant.cancelledPartial | 已停止生成 |
| assistant.cancelledEmpty | 请求已取消 |
| assistant.expandDialog | 展开对话 |
| assistant.citationUnknownTitle | 该引用不在本次上下文中 |
| assistant.citationUnverified | 未验证引用 |
| assistant.citationSourceFallback | 原文片段 |
| assistant.citationExcerpt | 原文：{excerpt} |
| assistant.citationJumpTitle | 跳转到原文：{excerpt} |
| assistant.selectionToolbarAria | 选区操作 |
| assistant.selectionCloseAria | 关闭选区工具 |

## 收藏

| key | text |
| --- | --- |
| insights.loading | 正在读取归档 |
| insights.noBookTitle | 还没有打开书籍 |
| insights.noBookDetail | 打开一本书后，这里会显示与它相关的归档。 |
| insights.emptyTitle | 还没有保存的回答 |
| insights.emptyDetail | 在助手回答下方点击“保存回答”，即可保留答案与原文位置。 |
| insights.removeQuestion | 删除这条回答归档？ |
| insights.removeAria | 删除回答归档 |
| insights.removed | 已删除回答归档。 |
| insights.alreadyRemoved | 这条归档已不存在。 |
| insights.removeFailed | 无法删除回答归档，请重试。 |
| insights.savedToast | 已保存回答和原文位置。 |
| insights.saveFailed | 保存回答失败。 |
| insights.readFailed | 无法读取归档。 |
| insights.scopeAll | 全部 |
| insights.scopeBook | 本书 |
| insights.scopeAria | 归档范围 |
| insights.searchPlaceholder | 搜索书名、作者、引用或回答… |
| insights.searchAria | 搜索归档 |
| insights.noSearchResultsTitle | 没有匹配的归档 |
| insights.noSearchResultsDetail | 换一个关键词再试试。 |
| insights.exportAll | 导出全部 |
| insights.exportBook | 导出本书 |
| insights.exportOneAria | 导出这条归档 |
| insights.exportedToast | 已导出 {fileName} |
| insights.exportFailed | 导出归档失败。 |
| insights.exportEmpty | 没有可导出的归档。 |
| insights.bookMissing | 这本书已不在书库中，无法打开归档。 |

## 摘录

| key | text |
| --- | --- |
| highlights.loading | 正在读取摘录 |
| highlights.noBookTitle | 还没有打开书籍 |
| highlights.noBookDetail | 打开一本书后，这里会显示摘录的原文。 |
| highlights.emptyTitle | 还没有摘录 |
| highlights.emptyDetail | 选中原文后，点“摘录这段”。 |
| highlights.title | 摘录 |
| highlights.count | 摘录 · {count} |
| highlights.removeQuestion | 删除摘录？ |
| highlights.removeAria | 删除摘录 |
| highlights.removed | 已删除摘录。 |
| highlights.removeFailed | 删除摘录失败。 |
| highlights.savedToast | 已摘录，并保留原文高亮。 |
| highlights.saveFailed | 摘录失败。 |
| highlights.readFailed | 无法读取摘录。 |

## 设置与连接

| key | text |
| --- | --- |
| settings.title | 设置 |
| settings.closeAria | 关闭设置 |
| settings.sectionsAria | 设置栏目 |
| settings.appearanceTitle | 外观 |
| settings.themeLabel | 主题 |
| settings.themeHint | 跟随系统会响应系统外观变化 |
| settings.themeGroupAria | 界面主题 |
| settings.themeLight | 浅色 |
| settings.themeLightAria | 使用浅色主题 |
| settings.themeSystem | 跟随系统 |
| settings.themeSystemAria | 跟随系统主题 |
| settings.themeDark | 深色 |
| settings.themeDarkAria | 使用深色主题 |
| settings.scaleLabel | 界面缩放 |
| settings.scaleHint | 不影响书籍正文字号 |
| settings.scaleGroupAria | 界面缩放 |
| settings.assistantTitle | 划词操作 |
| settings.assistantHint | 自定义划词按钮的名称和发送给模型的固定提示词；选区与当前章节上下文仍会一并发送。 |
| settings.assistantExplainName | “解释”按钮名称 |
| settings.assistantExplainPrompt | “解释”按钮提示词 |
| settings.assistantContextName | “联系上下文”按钮名称 |
| settings.assistantContextPrompt | “联系上下文”按钮提示词 |
| settings.assistantAskName | “自由提问”按钮名称 |
| settings.assistantAskHint | 自由提问不使用预设提示词，点击后由你输入问题。 |
| settings.assistantIconLabel | 按钮图标 |
| settings.assistantIconHighlighter | 荧光笔 |
| settings.assistantIconBookOpen | 打开的书 |
| settings.assistantIconMessageSquareText | 对话气泡 |
| settings.assistantIconSearch | 搜索 |
| settings.assistantIconLightbulb | 灯泡 |
| settings.assistantIconPenLine | 钢笔 |
| settings.assistantIconQuote | 引号 |
| settings.assistantIconBookMarked | 带书签的书 |
| settings.readingTitle | 阅读 |
| settings.restoreDefaults | 恢复默认 |
| settings.fontLabel | 正文字号 |
| settings.fontAria | 正文字号 |
| settings.fontFamilyLabel | 字体 |
| settings.commonChineseFonts | 常用中文 |
| settings.allFonts | 全部字体 |
| settings.fontsLoading | 正在读取系统字体… |
| settings.fontsUnavailable | 未能读取系统字体，可在列表可用后重试。 |
| settings.fontUnavailableHint | 该字体当前无法被应用加载，请重启应用或重新安装字体后再试。 |
| settings.lineHeight | 行间距 |
| settings.indent | 首行缩进 |
| settings.contentWidth | 正文宽度 |
| settings.contentWidthNarrow | 窄（640 px） |
| settings.contentWidthStandard | 标准（760 px） |
| settings.contentWidthWide | 宽（920 px） |
| settings.paragraphSpacing | 段落间距 |
| settings.spacingCompact | 紧凑 |
| settings.spacingStandard | 标准 |
| settings.spacingRelaxed | 宽松 |
| settings.textAlign | 对齐 |
| settings.textAlignJustify | 两端对齐 |
| settings.textAlignLeft | 左对齐 |
| settings.paperTheme | 纸张主题 |
| settings.paperThemeHint | 随界面明暗自动切换对应纸张。 |
| settings.paperThemeDefault | 默认 |
| settings.paperThemeEyeCare | 护眼 |
| settings.followBookDefault | 跟随原书 / 默认 |
| settings.noIndent | 无缩进 |
| settings.modelTitle | 模型服务 |
| settings.profileLabel | 配置 |
| settings.profileNameLabel | 配置名称 |
| settings.profileNamePlaceholder | 例如 OpenRouter 日常 |
| settings.newProfile | 新建配置 |
| settings.deleteProfile | 删除配置 |
| settings.activeProfile | 当前使用 |
| settings.setActive | 设为当前 |
| settings.profileLimit | 最多保存 10 套配置。 |
| settings.newProfilePlaceholder | 新配置（未保存） |
| settings.unsavedHint | 有未保存的修改，切换或关闭前请先保存。 |
| settings.discardChanges | 当前修改尚未保存，确定放弃吗？ |
| settings.deleteProfileQuestion | 确定删除配置“{name}”及其密钥吗？ |
| settings.baseUrlLabel | 接口地址 |
| settings.baseUrlPlaceholder | https://api.openai.com |
| settings.baseUrlHint | 应用会请求此地址下的 {path}。 |
| settings.modelLabel | 模型名称 |
| settings.modelPlaceholder | 例如 gpt-5-mini |
| settings.fetchModels | 获取模型 |
| settings.fetchingModels | 正在获取模型 |
| settings.modelsFetched | 已获取 {count} 个模型，可输入筛选或直接填写。 |
| settings.modelsTruncated | 模型较多，仅显示前 {count} 个。 |
| settings.apiKeyLabel | API 密钥 |
| settings.apiKeySaved | 已安全保存 |
| settings.apiKeyPlaceholderSaved | 留空以继续使用已保存的密钥 |
| settings.apiKeyPlaceholderEmpty | 输入 API 密钥 |
| settings.apiKeyHint | 密钥只交给主进程加密保存，不写入书库数据库。 |
| assistant.recentSessions | 最近对话 |
| assistant.recentSessionsLoading | 正在读取最近对话… |
| assistant.promptDetails | 查看本次提示词 |
| vision.previewTitle | 先识别一页 |
| vision.previewHint | 优先使用相同书籍和配置下的识别结果；没有结果时仅发送所选页图片。正式准备会复用已识别页。 |
| vision.previewPage | PDF 页码 |
| vision.previewStart | 查看这一页 |
| vision.previewRetry | 重试这一页 |
| vision.previewRefresh | 重新识别 |
| vision.previewRefreshHint | 重新识别会再次发送此页，可能消耗服务额度；失败时保留上次结果。 |
| vision.previewCached | 已复用本机识别结果，本次未发送识别请求。 |
| vision.previewSaved | 识别结果已保存，可用于后续原文准备。 |
| vision.previewPreparedHint | 新结果需点击“重新准备原文”后才会用于检索和笔记。 |
| vision.previewCopy | 复制文字 |
| vision.previewCopied | 已复制 |
| vision.previewCopyFailed | 复制失败，可选中下方文字手动复制。 |
| vision.previewCancel | 取消预览 |
| vision.previewRendering | 正在生成页面图片… |
| vision.previewRecognizing | 正在识别这一页… |
| vision.previewImage | 页面图片 |
| vision.previewText | 识别文字 |
| vision.previewBlank | 这一页没有识别到文字。请对照图片，或尝试其他页。 |
| vision.previewFailed | 单页识别失败，请检查文档服务配置后重试。 |
| vision.previewCancelled | 已取消本次预览。 |
| vision.previewUnsupported | 单页预览支持视觉模型、Mistral OCR 和 Unstructured，请先配置并保存。 |
| vision.previewBusy | 正在处理文档，请暂停或等待完成后再预览。 |
| vision.previewPageRange | 请输入 1 至 {count} 之间的 PDF 页码。 |
| ocrReading.title | 识别文字 |
| ocrReading.viewPdf | 查看 PDF 原页 |
| ocrReading.hint | 从本机读取已准备的原文，不会重新识别。划选文字即可解释、联系上下文或提问；可随时回到 PDF 核对。 |
| ocrReading.loading | 正在读取本页文字… |
| ocrReading.loadFailed | 无法读取识别文字，请重试。 |
| ocrReading.unprepared | 请先完成本书的逐页 OCR 原文准备，再查看和划选识别文字。 |
| ocrReading.unsupported | 本书没有保存逐页 OCR 文字。可使用视觉模型、Mistral OCR 或 Unstructured 重新准备原文。 |
| ocrReading.prepare | 打开本书准备 |
| ocrReading.previous | 上一页 |
| ocrReading.next | 下一页 |
| ocrReading.go | 跳转 |
| ocrReading.copy | 复制本页 |
| ocrReading.blank | 本页未识别到文字，可查看 PDF 原页核对。 |
| ocrReading.selectionTooLong | 选中文字过长，请缩小到 2 万字以内再提问。 |
| assistant.recentSessionTurns | {count} 轮对话 |
| assistant.recentSessionsHint | 每本书保留最近 20 个对话，每个最多 20 轮。点击可恢复选区、回答和草稿。 |
| assistant.recentSessionsEmpty | 还没有其他对话。 |
| assistant.sessionRestoreFailed | 无法读取或恢复对话，请重试。 |
| assistant.sessionSaveFailed | 对话保存失败。请检查可用空间后重试，切换前需成功保存当前对话。 |
| settings.testConnection | 测试文本回复 |
| settings.testStream | 测试流式回复 |
| provider.testStreamConnected | 流式测试通过：已收到文本和结束标记。 |
| provider.testStreamUnsupported | 未收到流式回复。请检查接口是否支持流式输出，或先测试文本回复。 |
| settings.save | 保存设置 |
| settings.savedToast | 模型设置已安全保存 |
| settings.profileActivatedToast | 已切换当前模型配置 |
| settings.profileDeletedToast | 已删除配置“{name}” |
| settings.saveFailed | 保存失败，请检查输入。 |
| settings.testSuccessToast | 模型连接正常 |
| settings.testFailed | 连接失败，请检查地址、模型与密钥。 |
| provider.statusNotConfigured | API 未配置 |
| provider.statusChecking | 正在检测 API 连接 |
| provider.statusConnected | API 连接正常 |
| provider.statusDisconnected | API 未连接 |
| provider.backgroundTestFailed | API 连接检测失败。 |

## 书库与阅读器

| key | text |
| --- | --- |
| library.tabHighlights | 摘录 |
| library.highlightsAria | 本书摘录 |
| library.loading | 正在读取书库 |
| library.resumeTitle | 继续阅读《{title}》 |
| library.unavailableTitle | 书库暂不可用 |
| library.emptyTitle | 书库为空 |
| library.emptyDetail | 可导入 EPUB、TXT、PDF、MOBI 或 AZW3。 |
| library.tocAria | 本书目录 |
| library.tocLoading | 正在解析目录 |
| library.tocEmptyTitle | 没有可用目录 |
| library.tocEmptyDetail | 你仍可连续滚动阅读全文。 |
| library.tocExpandAria | 展开{title} |
| library.tocCollapseAria | 折叠{title} |
| library.import | 导入书籍 |
| library.importing | 正在导入… |
| library.importProgressTitle | 导入书籍 |
| library.importProgressAria | 书籍导入进度 |
| library.importCurrent | 正在处理：{fileName} |
| library.importProgress | {processed} / {total} |
| library.importCancel | 停止导入 |
| library.importStopping | 正在停止，将在当前文件完成后结束… |
| library.importSummaryTitle | 导入完成 |
| library.importSummary | 已导入 {imported} 本 · 重复 {duplicates} 本 · 失败 {failed} 本 · 跳过 {skipped} 本 |
| library.importFailuresTitle | 失败详情 |
| library.importClose | 关闭 |
| library.importCanceled | 导入已停止。 |
| library.importBusy | 当前已有导入任务，请等待完成。 |
| library.dropTitle | 释放以导入书籍 |
| library.dropDetail | 支持 EPUB、TXT、PDF、MOBI 和 AZW3；单次最多 300 个文件。 |
| library.dropBusyTitle | 正在导入书籍 |
| library.dropBusyDetail | 请等待当前批次完成后再导入。 |
| library.unknownFile | 未知文件 |
| library.duplicateToast | 这本书已在书库中，已为你打开。 |
| library.importedToast | 书籍已导入本地书库。 |
| library.importFailed | 导入失败。请确认文件无 DRM 且格式受支持。 |
| library.readFailed | 无法读取本地书库。 |
| library.deleteBook | 删除这本书 |
| library.deleteQuestion | 删除《{title}》？ |
| library.deleteDetail | 这本书的摘录与归档会一并删除，且无法恢复。 |
| library.deletedToast | 已删除《{title}》。 |
| library.alreadyRemoved | 这本书已不在书库中。 |
| library.deleteFailed | 删除书籍失败。 |
| bookDetails.title | 书籍信息 |
| bookDetails.closeAria | 关闭书籍信息 |
| bookDetails.openAria | 查看《{title}》信息 |
| bookDetails.coverAlt | 《{title}》封面 |
| bookDetails.loading | 正在读取书籍信息 |
| bookDetails.readFailed | 无法读取这本书的信息。文件可能已损坏或已被移动。 |
| bookDetails.coverMissing | 暂无封面 |
| bookDetails.titleLabel | 书名 |
| bookDetails.authorLabel | 作者 |
| bookDetails.formatLabel | 格式 |
| bookDetails.formatEpub | EPUB |
| bookDetails.formatTxt | TXT |
| bookDetails.formatPdf | PDF |
| bookDetails.formatMobi | MOBI（经 Calibre 转换） |
| bookDetails.formatAzw3 | AZW3（经 Calibre 转换） |
| bookDetails.originalNameLabel | 原文件名 |
| bookDetails.fileSizeLabel | 文件大小 |
| bookDetails.importedAtLabel | 导入时间 |
| bookDetails.lastOpenedAtLabel | 上次打开 |
| bookDetails.neverOpened | 尚未打开 |
| bookDetails.progressLabel | 阅读进度 |
| bookDetails.languageLabel | 语言 |
| bookDetails.publisherLabel | 出版社 |
| bookDetails.publishedAtLabel | 出版日期 |
| bookDetails.identifierLabel | 标识符 |
| bookDetails.descriptionLabel | 简介 |
| bookDetails.notProvided | 未提供 |
| reader.progressAria | 阅读进度 {percent}% |
| reader.returnToReading | 返回阅读处 |
| reader.searchOpen | 搜索本书 |
| reader.searchTitle | 搜索本书 |
| reader.searchInputAria | 输入书内搜索词 |
| reader.searchPlaceholder | 搜索本书内容… |
| reader.searchSubmit | 搜索 |
| reader.searchLoading | 正在搜索全文… |
| reader.searchResultCount | 找到 {count} 处 |
| reader.searchResultLimit | 显示前 {count} 处 |
| reader.searchNoResultsTitle | 没有找到相关内容 |
| reader.searchNoResultsDetail | 换一个词再试试。 |
| reader.searchFailed | 搜索失败，请重试。 |
| reader.searchInvalid | 请输入 1–100 个字符。 |
| reader.pdfPage | 第 {number} 页 |
| reader.pdfZoomOut | 缩小 |
| reader.pdfZoomIn | 放大 |
| reader.pdfFitWidth | 适合宽度 |
| reader.pdfWholeDocument | 全文 |
| reader.pdfUntitledSection | 未命名小节 |
| reader.pdfRegionSelect | 框选文字 |
| visual.select | 框选图片 |
| visual.hint | 请在 PDF 单页内框选需要模型理解的图片区域。 |
| visual.reviewTitle | 确认图片区域 |
| visual.reviewHint | 此区域图片将在每次提问时发送给当前模型服务。 |
| visual.explain | 解释图片 |
| visual.ask | 向图片提问 |
| visual.source | PDF 第 {page} 页区域 |
| visual.renderFailed | 无法生成所选区域的图片，请重新框选。 |
| visual.crossPage | 请只在同一页内框选图片区域。 |
| visual.modelUnsupported | 当前问答模型可能不支持图片输入；请切换到支持视觉能力的模型后重试。 |
| reader.pdfRegionHint | 请在单页内框选一个段落、单栏或表格区域。 |
| reader.pdfRegionTooSmall | 框选区域太小，请重新拖动选择。 |
| reader.pdfRegionEmpty | 框选区域没有可提取的文字。 |
| reader.pdfRegionTooLarge | 框选文字超过 20,000 字，请缩小范围。 |
| reader.pdfRegionReviewTitle | 确认框选文字 |
| reader.pdfRegionReviewDetail | 检查并修正提取结果，然后继续使用划词操作。 |
| reader.pdfRegionReviewInputAria | 框选文字内容 |
| reader.pdfRegionCancel | 取消 |
| reader.pdfRegionConfirm | 使用此选区 |
| reader.pdfInternalLink | 跳转到 PDF 内部页面 |
| reader.pdfNoText | 页面没有可选文字；完成逐页 OCR 后，可用“识别文字”阅读和划词，也可搜索或整本书提问。 |
| reader.pdfPageNoText | 本页没有文字层 |
| reader.pdfSearchUnavailable | 这份 PDF 没有可搜索的文字层。请先在「阅读准备」中识别正文，再搜索。 |
| reader.pdfInvalidAnchor | 无效的 PDF 定位锚点。 |
| reader.pdfOpenFailed | 无法打开 PDF，文件可能已损坏或受密码保护。 |
| reader.areaAria | 正文阅读区 |
| reader.emptyAria | 尚未打开书籍 |
| reader.emptyText | 从书库打开或导入一本书 |
| reader.welcomeTitle | 从一本书开始 |
| reader.welcomeDetail | 导入 EPUB、TXT 或 PDF；本机装有 Calibre 时，MOBI 与 AZW3 会在导入时转换为 EPUB。 |
| reader.opening | 正在打开《{title}》 |
| reader.openingDetail | 解析内容与上次阅读位置… |
| reader.openFailedTitle | 这本书暂时打不开 |
| reader.openAgain | 重新打开 |
| reader.openFailed | 无法打开这本书。文件可能已损坏或包含 DRM。 |
| reader.preferencesFailed | 无法应用阅读设置。 |
| reader.bridgeFailed | 应用安全桥接未能加载。请重新启动 LLM Reader。 |
| reader.navigateSourceFailed | 无法跳转到这处原文。 |
| reader.navigateChapterFailed | 无法跳转到这个章节。 |

## 文件与内容错误

| key | text |
| --- | --- |
| error.internal | 操作失败，请稍后重试。 |
| error.invalidInput | 输入参数无效。 |
| error.untrustedSender | 已拒绝非可信页面的请求。 |
| dialog.importTitle | 导入书籍 |
| dialog.importFilter | EPUB、UTF-8 TXT、PDF、MOBI 或 AZW3 |
| dialog.exportTitle | 导出归档 |
| dialog.exportFilter | Markdown 文件 |
| error.epubUnsafePath | EPUB 包含不安全的内部路径。 |
| error.epubIncomplete | EPUB 结构不完整。 |
| error.epubMetadataTooLarge | EPUB 元数据异常过大。 |
| error.epubOpenFailed | 无法打开 EPUB，文件可能已损坏。 |
| error.epubTooManyEntries | EPUB 内部文件数量异常过多。 |
| error.epubEntryTooLarge | EPUB 包含异常大的内部文件。 |
| error.epubExpandedTooLarge | EPUB 解压后的内容超过安全上限。 |
| error.epubInvalid | 文件不是有效的 EPUB。 |
| error.epubDrm | 不支持受 DRM 保护的 EPUB。 |
| error.epubMissingContent | EPUB 缺少内容文档。 |
| error.txtEncoding | TXT 必须使用 UTF-8 编码。 |
| error.txtBinary | TXT 中包含无效的二进制内容。 |
| error.importAbsolutePath | 只能导入绝对路径的本地文件。 |
| error.importNotFound | 找不到要导入的文件。 |
| error.importNotFile | 选择的路径不是文件。 |
| error.importEmpty | 不能导入空文件。 |
| error.importTooLarge | 文件超过 250 MB 的导入上限。 |
| error.importUnsupported | 只支持导入 .epub、.txt、.pdf、.mobi 和 .azw3 文件。 |
| error.importBatchTooLarge | 单次最多导入 300 个文件，请分批处理。 |
| error.importBusy | 当前已有导入任务。 |
| error.txtTooLarge | TXT 文件超过 64 MB 的导入上限。 |
| error.pdfInvalid | 文件不是有效的 PDF。 |
| error.calibreNotFound | 未检测到 Calibre。请安装 Calibre，或先手动将文件转换为 EPUB。 |
| error.calibreConversionFailed | Calibre 无法转换该文件。文件可能已损坏、受 DRM 保护或格式不受支持。 |
| error.calibreTimeout | Calibre 转换超时，请检查文件后重试。 |
| library.untitled | 未命名书籍 |
| error.bookNotFound | 找不到这本书。 |
| error.storagePath | 书籍存储路径无效。 |
| reader.epubUntitledChapter | 未命名章节 |
| reader.epubEmpty | EPUB 文件为空 |
| reader.epubUntitled | 未命名 EPUB |
| reader.epubInvalidAnchor | 无效或不受信任的 EPUB 定位锚点 |
| reader.epubAnchorFailed | EPUB 定位锚点无法解析 |
| reader.epubInvalidHighlight | 无效的 EPUB 高亮锚点 |
| reader.epubSection | 第 {number} 节 |
| reader.epubNotOpen | EPUB 阅读器尚未打开文档 |
| reader.txtEmpty | TXT 文件不包含可阅读的文本 |
| reader.txtOpening | 开篇 |
| reader.txtInvalidAnchor | 无效的 TXT 定位锚点 |
| reader.txtAnchorOutside | TXT 定位锚点不在当前文档中 |
| reader.txtInvalidHighlight | 无效的 TXT 高亮锚点 |
| reader.txtFullText | 全文 |

## 归档导出

| key | text |
| --- | --- |
| export.title | LLM Reader 回答归档 |
| export.generatedAt | 导出时间：{datetime} |
| export.summary | {books} 本书 · {insights} 条归档 |
| export.bookHeading | {title} |
| export.entryHeading | 归档 {index} |
| export.chapterLabel | 章节 |
| export.quoteLabel | 原文 |
| export.questionLabel | 问题 |
| export.answerLabel | 回答 |
| export.modelLabel | 模型 |
| export.dateLabel | 保存时间 |
| export.followupsLabel | 追问 |
| export.followupLabel | 追问 {index} |
| export.userLabel | 问 |
| export.assistantLabel | 答 |
| export.citationsNote | 回答中的 [passage-id] 为阅读器内部引用。 |
| export.untitledBook | 未命名书籍 |
| export.fileNameAll | LLM-Reader-全部归档 |
| export.fileNameBook | LLM-Reader-{title}-归档 |

## 模型服务错误

| key | text |
| --- | --- |
| error.baseUrlInvalid | 接口地址无效。 |
| error.baseUrlUnsafe | 接口地址必须是不含账号信息的 HTTP(S) 地址。 |
| error.http400 | 请求被模型服务拒绝（400）。 |
| error.http401 | API 密钥无效或无权访问（401）。 |
| error.http403 | 模型服务拒绝访问（403）。 |
| error.http404 | 找不到接口或模型（404）。 |
| error.http429 | 请求过于频繁或配额不足（429）。 |
| error.httpOther | 模型服务返回错误（{status}）。 |
| error.responseTooLarge | 模型响应超过本地处理上限。 |
| error.providerInvalidJson | 模型服务返回了无效 JSON。 |
| error.providerEmptyText | 模型服务未返回文本。 |
| error.answerTooLarge | 模型回答超过本地显示上限。 |
| error.providerEmptyStream | 模型服务未返回流。 |
| error.streamEventTooLarge | 模型流式事件超过本地处理上限。 |
| error.streamInterrupted | 模型流式回答意外中断，请重试。 |
| error.duplicateRequest | 已存在相同 ID 的模型请求。 |
| error.answerCancelled | 已取消回答。 |
| error.requestTimeout | 模型请求超时。 |
| error.requestStartFailed | 请求未能启动，请检查模型设置。 |
| error.keyStorageUnavailable | 当前系统无法安全保存 API 密钥。 |
| error.providerNotConfigured | 请先保存 API 密钥和模型设置。 |
| error.keyReadUnavailable | 当前系统无法读取 API 密钥。 |
| error.keyDecryptFailed | API 密钥解密失败，请重新保存。 |
| provider.testConnected | 文本测试通过：已收到有效回复。 |
| provider.testTimeout | 连接超时。 |
| provider.testFailed | 无法连接到模型服务。 |
| error.keyReadFailed | 无法读取加密的 API 密钥。 |
| error.keyCipherInvalid | API 密钥密文文件无效，请重新保存。 |
| error.keyCipherSize | API 密钥密文大小无效。 |
| error.keyWriteFailed | 无法保存加密的 API 密钥。 |
| error.providerProfileNameExists | 配置名称已存在。 |
| error.providerProfileLimit | 最多只能保存 10 套模型配置。 |
| error.providerProfileNotFound | 找不到这套模型配置。 |
| error.providerProfileKeyRequired | 请先输入或保存这套配置的 API 密钥。 |
| error.providerModelsInvalid | 模型服务返回了无效的模型列表。 |
| error.providerModelsEmpty | 模型服务没有返回可用的模型 ID。 |

## 文档与输入检查

| key | 文案 |
| --- | --- |
| error.documentCancelled | 原文准备已停止。 |
| error.notesUpdated | 原文已更新，请重新生成章节笔记。 |
| error.documentCacheLimit | 文档结构缓存超过上限。 |
| document.bodyGroup | 正文组 |
| validation.sourceRange | 来源范围无效 |
| validation.documentSource | 文档结构或来源无效 |
| validation.passageId | passage id 必须唯一 |
| validation.contextLimit | 上下文过大 |
| validation.contextMismatch | 上下文来源不匹配 |
| validation.contextSource | 上下文来源无效 |
| validation.archiveSelection | 归档与选区必须属于同一本书 |
| validation.archiveHistory | 归档历史必须属于同一本书 |
| validation.httpUrl | 接口地址必须是 HTTP(S) 地址 |
| validation.question | 自由提问不能为空 |
| validation.endpoint | 接口地址不能包含查询参数或片段 |
| validation.rerank | 请填写重排地址和模型 |
| validation.embedding | 请填写 Embedding 地址和模型 |
| validation.documentUrl | 请填写文档处理服务地址 |
| validation.sectionLimit | 分节过大 |
| validation.tableDepth | 表格嵌套过深。 |
| validation.tableSpan | 表格跨度无效。 |
| validation.tableCount | 表格数量无效。 |
| validation.tableStructure | 表格结构不完整。 |
| validation.tableRows | 表格行数无效。 |
| validation.tableOverlap | 表格单元格重叠。 |
| validation.tableEmpty | 表格没有单元格。 |


## 接口与请求配置

| key | 文案 |
| --- | --- |
| request.advanced | 高级请求设置 |
| request.protocol | 接口协议 |
| request.openai | OpenAI 兼容 |
| request.anthropic | Anthropic / Claude |
| request.headers | 自定义请求头（JSON） |
| request.headersSaved | 已保存请求头；留空保留，填写后整体替换 |
| request.headersExample | 例如：{example} |
| request.headersHint | 请求头加密保存。可覆盖 Authorization、x-api-key、User-Agent 等；名称不区分大小写。更换地址或协议后请重新填写。 |
| request.headersInvalid | 请输入 JSON 对象，所有值需为字符串。名称不能重复，也不能设置 Host、Content-Type、Content-Length 等传输请求头。 |
| request.clearHeaders | 清除已保存的自定义请求头 |
| request.body | 额外请求参数（JSON） |
| request.bodyExample | 例如：{example} |
| request.bodyHint | 可填写服务支持的选项，例如模型的 max_tokens、temperature，文档服务的 strategy、ocr_engine。文件、消息、模型及返回格式由阅读器填写。密钥请放在请求头中。 |
| request.bodyInvalid | 请输入有效 JSON 对象；不能覆盖文件、消息、模型、返回格式等阅读器管理的字段。 |
| request.timeout | 请求超时（秒，1–600） |
| request.timeoutDefault | 使用默认超时 |
| request.streamError | 模型服务在流式响应中返回错误，请稍后重试。 |
| request.incomplete | 模型输出未完整结束，请增加 max_tokens 或调整模型参数后重试。 |
| request.mistral | Mistral OCR |
| request.unstructured | Unstructured Partition |
| request.ocrModel | OCR 模型名称 |
| request.testOcr | 测试 OCR |
| request.pageHint | 使用专门 OCR 服务逐页识别 PDF 文字，完成页会缓存，暂停后可继续。当前应用按页保存文字，复杂表格结构需核对；建议先试本书一页。 |
| request.partitionHint | 填写 Unstructured Partition 接口地址或本机兼容服务地址；不适用于 Workflow 接口。 |
| request.preset | 常用服务 |
| request.custom | 自定义地址 |

| request.keyScope | 更换接口地址或协议后，请重新填写 API 密钥；原密钥不会自动发送到新接口。 |
