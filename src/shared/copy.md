# LLM Reader 文案

本文件是应用自有用户可见文案的唯一来源。`key` 不可重复，动态内容使用 `{name}` 占位符。

## 通用

| key | text |
| --- | --- |
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
| about.noticeEpubjs | epub.js（BSD-2-Clause） |
| about.noticeJszip | JSZip（MIT OR GPL-3.0-or-later） |
| about.noticeLocalforage | localforage（Apache-2.0） |
| about.noticeLucide | lucide-react（ISC） |
| about.noticeReact | React、React DOM（MIT） |
| about.noticeZod | Zod（MIT） |
| about.thirdPartyNoticesFull | 完整许可文本见仓库中的 THIRD_PARTY_NOTICES.md。 |

## 助手与对话

| key | text |
| --- | --- |
| assistant.title | 阅读助手 |
| assistant.viewsAria | 阅读助手视图 |
| assistant.tabConversation | 对话 |
| assistant.tabInsights | 归档 |
| assistant.emptyTitle | 选中原文，开始理解 |
| assistant.emptyDetail | 回答会结合当前选区及附近段落。 |
| assistant.sourceTitle | 当前原文 |
| assistant.sourceSummary | {chapter} · {count} 段上下文 |
| assistant.backToSource | 回到原文 |
| assistant.thinking | 正在结合原文思考 |
| assistant.generatingAria | 正在生成 |
| assistant.modelUnavailable | 未知模型 |
| assistant.tokenUsage | {count} tokens |
| assistant.save | 归档 |
| assistant.saved | 已归档 |
| assistant.insightLabel | 归档的回答 |
| assistant.insightFollowupLabel | 追问 |
| assistant.stop | 停止生成 |
| assistant.placeholderFollowup | 继续追问这段原文… |
| assistant.placeholderFirst | 针对这段原文提问… |
| assistant.placeholderNoSelection | 先在正文中选中一段内容 |
| assistant.sendAria | 发送问题 |
| assistant.actionExplain | 解释这段 |
| assistant.actionContext | 联系上下文 |
| assistant.actionAsk | 自由提问 |
| assistant.actionSaveHighlight | 收藏 |
| assistant.questionExplain | 请用清晰、准确的语言解释这段内容。 |
| assistant.questionContext | 请结合本章上下文说明这段内容的含义与作用。 |
| assistant.cancelledPartial | 已停止生成 |
| assistant.cancelledEmpty | 请求已取消 |
| assistant.expandDialog | 展开详细对话 |
| assistant.dialogTitle | 详细对话 |
| assistant.closeDialog | 关闭详细对话 |
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
| insights.emptyTitle | 还没有归档 |
| insights.emptyDetail | 在回答下方点击“归档”，即可保留答案和原文位置。 |
| insights.removeQuestion | 取消归档？ |
| insights.backToSource | 回到原文 |
| insights.removeAria | 取消归档 |
| insights.removed | 已取消归档。 |
| insights.alreadyRemoved | 这条归档已不存在。 |
| insights.removeFailed | 取消归档失败。 |
| insights.savedToast | 已归档，并保留原文位置。 |
| insights.saveFailed | 归档失败。 |
| insights.readFailed | 无法读取归档。 |

## 句段收藏

| key | text |
| --- | --- |
| highlights.loading | 正在读取句段收藏 |
| highlights.noBookTitle | 还没有打开书籍 |
| highlights.noBookDetail | 打开一本书后，这里会显示划词收藏的句段。 |
| highlights.emptyTitle | 还没有收藏句段 |
| highlights.emptyDetail | 选中原文后，在划词控件中点“收藏”。 |
| highlights.title | 收藏 |
| highlights.count | 收藏 · {count} |
| highlights.backToSource | 回到原文 |
| highlights.removeQuestion | 删除收藏？ |
| highlights.removeAria | 删除句段收藏 |
| highlights.removed | 已删除收藏。 |
| highlights.removeFailed | 删除收藏失败。 |
| highlights.savedToast | 已收藏句段，并保留原文高亮。 |
| highlights.saveFailed | 收藏句段失败。 |
| highlights.readFailed | 无法读取句段收藏。 |

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
| settings.assistantTitle | 助手 |
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
| settings.paperTheme | 纸张主题 |
| settings.paperThemeHint | 阅读区纸张独立于界面主题。 |
| settings.paperThemeLight | 浅色 |
| settings.paperThemeSepia | 米黄 |
| settings.paperThemeDark | 深色 |
| settings.followBookDefault | 跟随原书 / 默认 |
| settings.noIndent | 无缩进 |
| settings.modelTitle | 模型 |
| settings.baseUrlLabel | 接口地址 |
| settings.baseUrlPlaceholder | https://api.openai.com |
| settings.baseUrlHint | 应用会请求此地址下的 {path}。 |
| settings.modelLabel | 模型名称 |
| settings.modelPlaceholder | 例如 gpt-5-mini |
| settings.apiKeyLabel | API 密钥 |
| settings.apiKeySaved | 已安全保存 |
| settings.apiKeyPlaceholderSaved | 留空以继续使用已保存的密钥 |
| settings.apiKeyPlaceholderEmpty | 输入 API 密钥 |
| settings.apiKeyHint | 密钥只交给主进程加密保存，不写入书库数据库。 |
| settings.testConnection | 测试连接 |
| settings.save | 保存设置 |
| settings.savedToast | 模型设置已安全保存 |
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
| library.navAria | 书籍导航 |
| library.tabLibrary | 书库 |
| library.tabToc | 目录 |
| library.tabHighlights | 收藏 |
| library.highlightsAria | 本书句段收藏 |
| library.loading | 正在读取书库 |
| library.unavailableTitle | 书库暂不可用 |
| library.emptyTitle | 书库为空 |
| library.emptyDetail | 可导入 EPUB 或 TXT。 |
| library.epubDescription | EPUB 电子书 |
| library.txtDescription | TXT 文档 |
| library.tocAria | 本书目录 |
| library.tocLoading | 正在解析目录 |
| library.tocEmptyTitle | 没有可用目录 |
| library.tocEmptyDetail | 你仍可连续滚动阅读全文。 |
| library.tocExpandAria | 展开{title} |
| library.tocCollapseAria | 折叠{title} |
| library.import | 导入 EPUB/TXT |
| library.importing | 正在导入… |
| library.duplicateToast | 这本书已在书库中，已为你打开。 |
| library.importedToast | 书籍已导入本地书库。 |
| library.importFailed | 导入失败。仅支持无 DRM 的 EPUB 与 UTF-8 TXT。 |
| library.readFailed | 无法读取本地书库。 |
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
| reader.progress | 阅读进度 |
| reader.progressAria | 阅读进度 {percent}% |
| reader.readingSettings | 阅读设置 |
| reader.returnToReading | 回到阅读位置 |
| reader.searchOpen | 搜索本书 |
| reader.searchClose | 关闭搜索 |
| reader.searchTitle | 搜索本书 |
| reader.searchInputAria | 输入书内搜索词 |
| reader.searchPlaceholder | 输入 1–100 个字符… |
| reader.searchSubmit | 搜索 |
| reader.searchLoading | 正在搜索全文… |
| reader.searchResultCount | 找到 {count} 处 |
| reader.searchResultLimit | 显示前 {count} 处 |
| reader.searchNoResultsTitle | 没有找到相关内容 |
| reader.searchNoResultsDetail | 换一个词再试试。 |
| reader.searchFailed | 搜索失败，请重试。 |
| reader.searchInvalid | 请输入 1–100 个字符。 |
| reader.chapterProgress | 本章进度 |
| reader.highlightsFailed | 无法应用原文高亮。 |
| reader.areaAria | 正文阅读区 |
| reader.emptyAria | 尚未打开书籍 |
| reader.emptyText | 从书库打开或导入一本书 |
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
| dialog.importFilter | EPUB 或 UTF-8 TXT |
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
| error.importUnsupported | 只支持导入 .epub 和 .txt 文件。 |
| error.txtTooLarge | TXT 文件超过 64 MB 的导入上限。 |
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
| reader.txtDefaultTitle | TXT 文档 |
| reader.txtEmpty | TXT 文件不包含可阅读的文本 |
| reader.txtOpening | 开篇 |
| reader.txtInvalidAnchor | 无效的 TXT 定位锚点 |
| reader.txtAnchorOutside | TXT 定位锚点不在当前文档中 |
| reader.txtInvalidHighlight | 无效的 TXT 高亮锚点 |
| reader.txtHighlightOutside | TXT 高亮锚点不在当前文档中 |
| reader.txtFullText | 全文 |

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
| provider.testConnected | 连接成功。 |
| provider.testTimeout | 连接超时。 |
| provider.testFailed | 无法连接到模型服务。 |
| error.keyReadFailed | 无法读取加密的 API 密钥。 |
| error.keyCipherInvalid | API 密钥密文文件无效，请重新保存。 |
| error.keyCipherSize | API 密钥密文大小无效。 |
| error.keyWriteFailed | 无法保存加密的 API 密钥。 |
