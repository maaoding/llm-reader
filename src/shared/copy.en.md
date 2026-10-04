# LLM Reader copy (English)

## Workspace

| key | text |
| --- | --- |
| workspace.navigation | Main navigation |
| workspace.reading | Reading |
| workspace.notes | Notes |
| workspace.conversation | Chat |
| workspace.prepare | Book preparation |
| workspace.library | Library |
| workspace.archives | Saved answers |
| workspace.continue | Continue reading |
| workspace.readingProgress | Read {percent}% |
| workspace.noteCount | Notes completed {completed}/{total} |
| workspace.tabs | This book's pages |
| workspace.bookTabs | Open books |
| workspace.closeBookTab | Close “{title}” |
| workspace.librarySearch | Search titles or authors |
| workspace.libraryCount | {count} books |
| workspace.libraryNoResults | No matching book |
| workspace.libraryNoResultsHint | Try a different title or author. |
| workspace.optional | Optional |
| preparation.title | Book preparation |
| preparation.close | Close book preparation |
| preparation.intro | Prepare the source text to question the whole book. Chapter notes and meaning search can be enabled as needed. |
| preparation.original | Source text |
| preparation.basic | The basis for whole-book questions |
| preparation.local | Extracts text and chapter structure on this machine, no model service required. |
| preparation.pdf | Sends the whole PDF to the selected document service to extract text and structure. |
| preparation.pdfGuide | For complex papers, tables and formulas prefer MinerU or Docling; for page-by-page OCR, recognize one page first and compare it with the original PDF. |
| preparation.pageOcr | Recognizes PDF text page by page with a dedicated OCR service. Text is saved per page; complete table structures are not preserved. |
| preparation.pageOcrDisclosure | During preparation, page images are sent to the selected OCR service one by one, which may consume quota. Finished pages are stored locally and you can resume after pausing. Verify recognized text and complex layouts against the original PDF. |
| preparation.documentProgress | Processed {completed}/{total} items |
| preparation.notes | Chapter notes |
| preparation.notesHint | Organizes the book's claims, concepts and conditions to clarify how chapters connect. |
| preparation.semanticHint | Finds passages with similar meaning but different wording. |
| preparation.prepare | Prepare text |
| preparation.pause | Pause preparation |
| preparation.resume | Resume preparation |
| preparation.retry | Retry preparation |
| preparation.rebuild | Re-prepare text |
| preparation.rebuildConfirm | Re-prepare the source text? This rebuilds the chapter structure; existing chapter notes and the meaning search index must be rebuilt. Saved answers are kept. |
| preparation.notesRebuildConfirm | Regenerate chapter notes? Existing notes will be replaced. Source text, the meaning search index and saved answers are kept. |
| preparation.semanticRebuildConfirm | Rebuild the meaning search index? The existing index will be replaced. Source text, chapter notes and saved answers are kept. |
| preparation.document.empty | Source text not prepared yet |
| preparation.document.preparing | Preparing source text |
| preparation.document.paused | Source text preparation paused |
| preparation.document.ready | Source text ready |
| preparation.document.error | Source text preparation incomplete |
| preparation.check | Document check · {count} hints |
| preparation.checkHint | These hints flag possible parsing issues; check them against the source. They do not measure OCR accuracy. |
| preparation.checkLimit | {count} in total; showing the first 100. |
| preparation.pageDiagnostic | Page {page}: {message} |
| preparation.missingBody | This page has no body text |
| preparation.unknownStructure | Unrecognized structure; text preserved |
| preparation.unlinkedNote | Footnote lacks a clear anchor |
| preparation.tableDegraded | Irregular table; kept as text |
| preparation.duplicate | Possible duplicate content; original kept |
| preparation.configureModel | Set up model service |
| preparation.configureDocument | Set up PDF service |
| preparation.configureSemantic | Set up meaning search service |
| preparation.details | Processing notes |
| preparation.stopFailed | Could not pause source text preparation. Try again. |
| notes.empty | No chapter notes yet |
| notes.emptyHint | Once the source text is prepared, you can generate chapter notes in “Book preparation”. |
| notes.partial | Finished notes are readable now; more will be added as they complete. |
| notes.overview | Book overview |
| notes.chapterSummary | Chapter overview |
| notes.claims | Claims and evidence |
| notes.conditions | Conditions of applicability |
| notes.exceptions | Exceptions and limits |
| notes.concepts | Concepts |
| notes.more | Load more notes |
| notes.loading | Loading notes… |
| notes.failed | Could not load notes. Try again. |
| notes.changed | Notes have been updated. Reopen this chapter. |
| notes.unavailableSource | Some source passages unavailable |
| notes.sources | View cited passages |
| notes.chapterEmpty | Notes for this chapter are not generated yet |
| notes.chapterEmptyHint | While generation runs, you can read notes from finished chapters. |
| notes.navigation | Note chapters |
| notes.aliases | Also known as: {names} |
| assistant.needModel | Set up a model service before sending questions. |
| persona.title | Assistant persona |
| persona.hint | Set the role and tone for reading Q&A. Each new session copies the default persona at that time; existing sessions can switch separately. |
| persona.default | Default for new sessions |
| persona.defaultHint | Saved immediately on selection; only affects sessions created afterwards. Existing sessions keep their own persona. |
| persona.manage | Manage personas |
| persona.manageHint | After editing the name and prompt, click “Save persona”. Saving does not make it the default. |
| persona.preset | Persona being edited |
| persona.none | No custom persona |
| persona.new | New persona |
| persona.duplicate | Duplicate persona |
| persona.copyName | Copy of {name} |
| persona.delete | Delete persona |
| persona.confirmDelete | Delete this persona? Sessions already using it keep their current persona. |
| persona.name | Persona name |
| persona.prompt | Prompt text |
| persona.promptHint | Up to 3000 characters. It only affects reading Q&A; grounding and citation rules always apply. |
| persona.save | Save persona |
| persona.edit | Edit this session's persona |
| persona.saveAs | Save as persona |
| persona.custom | Custom for this session |
| persona.select | Current assistant persona |
| persona.trigger | Assistant: {name} |
| persona.builtIn | Default |
| persona.sessionHint | Changes take effect from the next question or a manual regeneration. |
| persona.saveFailed | Save failed. Check available space and try again. |
| persona.saved | Assistant persona saved. |
| persona.limit | Up to 20 personas can be saved. |
| persona.discardChanges | You have unsaved changes. Discard them? |
| assistant.needDocument | Prepare the source text before searching the whole book for answers. |
| assistant.selectionReady | Passage selected |
| assistant.selectionPending | No passage selected |
| assistant.questionAria | Type your question |
| assistant.busyHint | An answer is being generated; you can write the next question already. |
| assistant.queued | Queued; earlier answers are still generating. |
| assistant.clearSession | Clear session |
| assistant.clearSessionQuestion | Clear the current session? |
| assistant.bookEmptyTitle | Find answers in the book |
| assistant.bookEmptyHint | Ask about claims, concepts or connections between chapters; answers cite the passages used. |
| reader.contentsButton | Contents |
| reader.layoutButton | Layout |
| reader.displayButton | PDF tools |
| reader.toolsAria | Reading tools |
| sources.wholeTable | This citation can only jump to the page containing the whole table. |

## Common

| key | text |
| --- | --- |
| knowledge.title | Reading enhancements |
| knowledge.description | Each service is configured and saved separately. Toggles apply the saved configuration immediately. Testing neither saves anything nor starts processing a book. |
| knowledge.configureBeforeEnable | First time? Expand “Configuration details”, fill it in and click “Save and enable”. |
| knowledge.pending | Unsaved changes |
| knowledge.details | Configuration details |
| knowledge.saving | Saving… |
| knowledge.changing | Updating toggle… |
| knowledge.embeddingSummary | Finds relevant passages by meaning; each book needs an index after enabling. |
| knowledge.documentSummary | Prepares searchable text for PDF Q&A. After enabling, you still start it manually in “Book preparation”. |
| rerank.summary | Picks the most relevant passages when asking; falls back to the original order if the service fails. |
| knowledge.saveService | Save configuration |
| knowledge.saveAndEnable | Save and enable |
| knowledge.savedAndEnabled | Configuration saved and enabled. |
| knowledge.testOutdated | The configuration changed. Test again. |
| knowledge.undoClear | Undo removal |
| knowledge.clearPending | The key is removed when the current configuration is saved; you can undo before saving. |
| rerank.title | Passage reranking |
| rerank.hint | When enabled, candidate passages are reranked starting from your next question. The question and candidates are sent to the selected service, with up to 5 extra seconds of waiting; on failure the original order is kept. Use a service URL compatible with /rerank. |
| rerank.model | Rerank model |
| rerank.test | Test reranking service |
| rerank.testOk | Rerank endpoint check passed. |
| rerank.required | Enter the rerank endpoint URL and model. |
| rerank.invalid | The rerank service returned an invalid ranking structure. |
| rerank.applied | Passage order optimized |
| rerank.fallback | Reranking did not finish; original order used |
| rerank.skipped | Keeping the original retrieval order for this question |
| webSearch.title | Web search |
| webSearch.summary | Once allowed, the current Q&A model decides whether outside material is needed and answers with web excerpts. |
| webSearch.hint | Choose Tavily, Brave Search or Exa, or connect a relay speaking the same protocol. When enabled, the model sends one short query when needed, which may include keywords from the question or selection; the book text is never uploaded. If search fails or finds nothing, the answer continues from the book. |
| webSearch.provider | Search provider |
| webSearch.endpointHint | Enter the service base URL; the app appends the search endpoint path. Changing the provider or URL requires re-entering the key and headers. Only one connection is saved. |
| webSearch.maxResults | Results (1–5) |
| webSearch.includeDomains | Only search these domains |
| webSearch.excludeDomains | Exclude these domains |
| webSearch.domainsHint | Optional. Separate with commas or newlines, up to 20 hostnames per group (e.g. example.com), subdomains included. Exclusions win, so results may be fewer than requested. |
| webSearch.domainsInvalid | Enter hostnames only, without protocol, path, port or wildcards; up to 20 distinct hostnames per group. |
| webSearch.test | Test search service |
| webSearch.testOk | Search endpoint check passed. |
| webSearch.required | Enter the search service URL. |
| webSearch.invalid | The search service returned an invalid result structure. |
| webSearch.modeLabel | Web access |
| webSearch.modeAuto | Web: auto |
| webSearch.modeOff | Web: off |
| webSearch.modeHint | In auto mode the model decides whether to search; the choice is saved with the session. |
| webSearch.imageUnavailable | Web search is not yet available for image questions. |
| webSearch.deciding | Deciding whether to search the web… |
| webSearch.searching | Searching the web… |
| webSearch.searched | Web search · {count} sources |
| webSearch.notNeeded | This turn needs no web search |
| webSearch.planningFailed | The web decision did not finish; answering from the book only |
| webSearch.empty | No usable web results; continuing with the book |
| webSearch.budgetEmpty | Searched, but there was no room in the input for web excerpts |
| webSearch.failed | Web search did not finish; continuing with the book |
| webSearch.failedReason | Web search did not finish ({reason}); continuing with the book |
| webSearch.sourcesTitle | Web sources |
| webSearch.bookSourcesTitle | Book passages |
| webSearch.openInBrowser | Open in browser |
| webSearch.openFailed | Could not open this web source. |
| webSearch.searchedAt | Searched at {time} |
| webSearch.queryLabel | Query: {query} |
| webSearch.reason.timeout | Search timed out |
| webSearch.reason.rateLimit | Search requests too frequent |
| webSearch.reason.authentication | Invalid search key |
| webSearch.reason.server | Search service error |
| webSearch.reason.network | Network connection lost |
| webSearch.reason.configuration | Search configuration unavailable |
| webSearch.reason.redirect | The search URL redirected |
| webSearch.reason.tooLarge | Search response too large |
| webSearch.reason.invalidResponse | Invalid search response |
| webSearch.reason.http | The search service returned an error |
| webSearch.openDenied | This URL is not one of the recorded web sources. |
| webSearch.unavailable | Enable the search service in Reading enhancements first; this turn answers from the book only. |
| webSearch.exportTitle | Web sources and search log |
| webSearch.close | Close |
| knowledge.embeddingTitle | Meaning search (embeddings) |
| knowledge.embeddingHint | Enter a /v1/embeddings-compatible URL and model. Local services can omit the key. After enabling, build an index per book in “Book preparation”. |
| knowledge.baseUrl | Endpoint URL |
| knowledge.model | Embedding model |
| knowledge.apiKey | API key (optional) |
| knowledge.keySaved | Key saved; leave blank to keep |
| knowledge.keyEmpty | No key saved |
| knowledge.clearKey | Remove saved key |
| knowledge.endpointHint | Re-enter the key when changing the endpoint or document service. |
| knowledge.documentTitle | PDF parsing |
| knowledge.documentStartHint | When enabled, PDFs are processed only in “Book preparation”; the file is sent when you click “Prepare text”. Disabling keeps the configuration and prepared text and pauses work in progress. |
| knowledge.processor | Processing service |
| knowledge.none | Select a processing service |
| knowledge.mineruLocal | MinerU local service |
| knowledge.mineruCloud | MinerU cloud service |
| knowledge.docling | Docling Serve |
| knowledge.documentHint | For Docling Serve and MinerU local, enter the service root URL; for MinerU cloud enter https://mineru.net. Local services must be deployed by you; the app does not install them. |
| knowledge.processorGuide | For complex papers, tables and formulas prefer MinerU or Docling; for scanned pages needing text only, choose Mistral OCR or Unstructured; with a compatible vision model you can use vision OCR — try one page first. |
| knowledge.ocr | Enable OCR |
| knowledge.extractionMethod | Text extraction method |
| knowledge.extractText | Extract the text already in the PDF |
| knowledge.extractOcr | Recognize scanned content via OCR |
| knowledge.doclingOcr | Recognize text on scanned pages |
| knowledge.extractionHint | Changing this requires re-preparing the text. Whichever method you choose, preparation calls the service selected above. |
| knowledge.pageOcrOnly | This service always recognizes PDF text page by page. |
| knowledge.language | Recognition language |
| knowledge.ch | Chinese |
| knowledge.en | English |
| knowledge.testEmbedding | Test embeddings |
| knowledge.testDocument | Check processing service |
| vision.title | Vision model OCR |
| vision.model | Vision model name |
| vision.hint | Recognize PDF text page by page with an OpenAI-compatible or Anthropic endpoint that accepts images, configured separately from the Q&A model. Test with the fixed sample image first, then one page of this book. Testing may consume quota. |
| vision.preparation | Recognizes PDF text page by page with a compatible vision model. Results support whole-book questions and chapter notes; verify complex tables and chapter structure. |
| vision.disclosure | When you click prepare, page images are sent to the configured model service one by one, which may incur charges. Finished pages are stored locally; after pausing, failing or quitting you can continue manually, and unfinished pages may be billed again. The original PDF is kept and citations can return to the page for checking. Recognition can be wrong; no selectable text layer is generated yet, and complex tables and chapter structure are not guaranteed. |
| vision.progress | Recognized {completed}/{total} pages |
| vision.test | Test image recognition |
| vision.testOk | The sample image was recognized successfully. Verify quality on real PDFs against the original text. |
| vision.testFailed | The sample image was not recognized correctly. Confirm the endpoint and model accept image input, then retry. |
| vision.configRequired | Enter the vision model endpoint URL and model name. |
| vision.renderFailed | Could not render the current PDF page for recognition. Check the file and retry; finished pages are kept. |
| vision.invalidResponse | The model returned no valid recognized text. Confirm the model accepts image input and retry. |
| vision.incomplete | Recognition of this page was truncated or did not finish; the incomplete result was not saved. Check the model's output limits and retry. |
| vision.emptyDocument | Recognition finished but no usable text was extracted. Check the PDF content or switch vision models and prepare again. |
| knowledge.testHint | The embedding test sends a fixed short text and the vision test a fixed sample image, which may consume quota. None of the checks send your book. |
| knowledge.testOk | Endpoint check passed. |
| knowledge.documentTestOk | The service endpoint is reachable. Verify actual document processing on a book. |
| knowledge.save | Save settings |
| knowledge.saved | This configuration is saved. |
| knowledge.testing | Checking… |
| knowledge.indexTitle | Meaning search |
| knowledge.indexStart | Build meaning search index |
| knowledge.indexResume | Resume indexing |
| knowledge.indexRebuild | Rebuild meaning search index |
| knowledge.indexCancel | Pause indexing |
| knowledge.indexDisclosure | Sends the book's passages to the embedding service in batches, which may consume quota. The index is stored locally. When asking questions, the question is also sent to that service to find relevant passages. Work does not resume automatically after pausing or quitting. |
| knowledge.pdfDisclosure | Preparing a PDF sends the whole file to the document processing service. Pausing only stops local waiting; the remote task may keep running, and resuming prefers the same task. Recognized text can be wrong; citations can return to the PDF page for checking. |
| knowledge.pdfRequired | First configure a PDF parsing service in “Settings → Reading enhancements”. |
| knowledge.pdfPausedByDisable | The PDF parsing service is disabled, so preparation is paused. Re-enable it to continue manually. |
| knowledge.pdfPage | Page {page} |
| knowledge.indexProgress | Indexed {completed}/{total} passages |
| knowledge.status.disabled | Not enabled |
| knowledge.status.empty | No index yet |
| knowledge.status.indexing | Building index |
| knowledge.status.paused | Indexing paused |
| knowledge.status.ready | Ready for meaning search |
| knowledge.status.error | Index incomplete |
| knowledge.status.stale | Service settings changed; rebuild the index |
| knowledge.indexChanged | Meaning search service settings changed; the index must be rebuilt. Chapter notes are kept. |
| knowledge.indexBusy | Another book is indexing; pause it first. |
| knowledge.embeddingRequired | Configure and enable meaning search in the Reading enhancement settings. |
| knowledge.vectorInvalid | The embeddings returned an invalid count, dimension or value. Finished progress is kept. |
| knowledge.secretError | This key could not be stored or read securely. Enter it again. |
| knowledge.httpError | The reading enhancement service returned HTTP {status}. Check the URL, key and service status. |
| knowledge.redirect | The endpoint redirected. Enter the final service URL. |
| knowledge.timeout | The reading enhancement service timed out. Retrying reuses saved progress. |
| knowledge.network | The connection to the reading enhancement service dropped. Check the service settings and retry. |
| knowledge.invalid | The PDF service returned an invalid text structure or page number; preparation is not complete. |
| knowledge.tooLarge | The content exceeds local limits. Use a smaller document or an embedding model with fewer dimensions. |
| knowledge.documentFailed | PDF preparation did not finish. You can retry reading the existing task; if the task failed or expired, prepare the text again. |
| knowledge.cloudKey | The MinerU cloud service requires an API token. |
| knowledge.documentChanged | PDF service settings changed; prepare the text again. Saved answers are kept. |
| settings.compatibilityLabel | Request adaptation |
| settings.compatibilityAuto | Auto (default) |
| settings.compatibilityGo | OpenCode Go |
| settings.compatibilityHint | Official Go URLs are adapted automatically. When calling Go through a relay, choose OpenCode Go and make sure the relay passes session identifiers through. |
| error.providerRedirect | The Go endpoint returned a redirect. Enter the final endpoint URL in the model settings and retry. |
| error.providerSessionRejected | The endpoint rejected the Go session identifier. Check the request adaptation settings and confirm the relay passes session identifiers through. |
| analysis.scopeLabel | Question scope |
| analysis.selection | Selection |
| analysis.book | Whole book |
| analysis.prepare | Generate chapter notes |
| analysis.resume | Resume generating notes |
| analysis.rebuild | Regenerate chapter notes |
| analysis.cancel | Pause note generation |
| analysis.profile | Model used for notes |
| analysis.disclosure | Sends the prepared text to the selected model in batches, which may consume quota. Work does not resume automatically after pausing or quitting. |
| analysis.needed | Prepare the source text first. Once done you can question the whole book; chapter notes and meaning search can be enabled later. |
| analysis.unsupported | This book does not support text preparation yet; you can still read or explain selectable text. |
| analysis.textSection | Text sections |
| analysis.failed | Chapter notes are incomplete; progress is kept. You can continue generating. |
| analysis.summaryTooLong | The summary returned {count} characters, over the {limit}-character limit. Progress is kept. |
| analysis.summaryEmpty | The summary returned no usable body text. Progress is kept. |
| analysis.noteInvalid | A section note has an invalid format or length. Progress is kept. |
| analysis.referenceInvalid | A section note cites a passage number that does not exist in that section. Progress is kept. |
| analysis.responseTooLarge | The analysis response exceeded the length limit. Progress is kept. |
| analysis.networkError | The analysis request lost connection. Progress is kept. |
| analysis.timeout | The analysis request did not finish within 3 minutes. Progress is kept. |
| analysis.stage.sections | Organizing chapter content |
| analysis.stage.chapters | Summarizing chapter notes |
| analysis.stage.overview | Writing the book overview |
| analysis.stageProgress | {stage}: {completed}/{total} |
| analysis.retrying | Retrying the current step ({attempt}/3); finished results are reused. |
| analysis.recentFailures | Recent failures |
| analysis.disclosureRetry | Transient errors are retried up to 3 times per step, which may consume quota. Regenerating only replaces notes; source text, the meaning search index and saved answers are kept. |
| analysis.busy | Another book is preparing text or generating notes; pause that task first. |
| analysis.changed | The configuration used for notes changed; regenerate the chapter notes. |
| analysis.tooLarge | This book exceeds the analysis limits. Use a smaller volume. |
| analysis.sourceCount | Passages referenced · {count} |
| analysis.coverage | Used notes {covered}/{total} sections |
| analysis.bookQuestion | Ask about this book's claims, concepts or chapter connections… |
| analysis.bookSource | Whole-book Q&A |
| analysis.status.empty | No notes yet |
| analysis.status.stale | Notes need regeneration |
| analysis.status.extracting | Preparing source text |
| analysis.status.analyzing | Generating notes |
| analysis.status.paused | Paused |
| analysis.status.ready | Chapter notes complete |
| analysis.status.error | Notes incomplete |
| analysis.status.unsupported | Chapter notes not supported yet |
| app.name | LLM Reader |
| common.retry | Retry |
| common.confirm | Confirm |
| common.back | Back |
| common.currentChapter | Current chapter |
| common.unknownAuthor | Unknown author |
| common.durationSeconds | {count}s |
| common.durationMinutes | {minutes}m {seconds}s |
| window.controlsAria | Window controls |
| window.minimizeAria | Minimize |
| window.maximizeAria | Maximize |
| window.restoreAria | Restore |
| window.closeAria | Close |

## About

| key | text |
| --- | --- |
| about.title | About |
| about.versionLabel | Version |
| about.versionUnknown | Unknown |
| about.licenseLabel | License |
| about.licenseValue | GPL-3.0-or-later |
| about.licenseNotice | This software is released under the GNU General Public License v3 or later. |
| about.copyright | © 2026 wrh37 |
| about.repositoryLabel | Source repository |
| about.repositoryUrl | https://github.com/maaoding/llm-reader |
| about.thirdPartyNoticesTitle | Third-party licenses |
| about.thirdPartyNoticesIntro | This software uses the following open-source components: |
| about.noticeElectron | Electron (MIT) |
| about.noticeElectronUpdater | electron-updater (MIT) |
| about.noticeEpubjs | epub.js (BSD-2-Clause) |
| about.noticeJszip | JSZip (MIT OR GPL-3.0-or-later) |
| about.noticeLocalforage | localforage (Apache-2.0) |
| about.noticePdfjs | PDF.js (Apache-2.0) |
| about.noticeLucide | lucide-react (ISC) |
| about.noticeReact | React, React DOM (MIT) |
| about.noticeZod | Zod (MIT) |
| about.thirdPartyNoticesFull | Full license texts are in THIRD_PARTY_NOTICES.md in the repository. |
| about.updateLabel | Updates |
| about.updateStatusIdle | Updates not checked yet |
| about.updateStatusChecking | Checking for updates… |
| about.updateStatusUpToDate | Up to date |
| about.updateStatusAvailable | New version {version} available |
| about.updateStatusDownloading | Downloading update… {percent}% |
| about.updateStatusDownloaded | Update downloaded |
| about.updateStatusError | Update failed. Try again later. |
| about.updateStatusUnsupported | Update checks are not supported in this environment |
| about.updateCheckAction | Check for updates |
| about.updateDownloadAction | Download update |
| about.updateInstallAction | Restart and install |
| about.updateNotesTitle | What's new |
| about.updateDownloadedHint | The new version installs after a restart; saved reading progress is unaffected. |

## Assistant and conversation

| key | text |
| --- | --- |
| assistant.title | Reading assistant |
| assistant.viewsAria | Reading assistant views |
| assistant.tabCurrent | Current chat |
| assistant.closeTab | Close session tab |
| assistant.emptyTitle | Select a passage to start |
| assistant.emptyDetail | Answers use the current selection and nearby passages. |
| assistant.sourceTitle | Selected passage |
| assistant.sourceSummary | {chapter} · {count} nearby passages referenced |
| assistant.backToSource | Back to passage |
| assistant.thinking | Thinking with the passage |
| assistant.generatingAria | Generating |
| assistant.modelUnavailable | Unknown model |
| assistant.tokenUsage | Usage {count} tokens |
| assistant.contextHintTitle | Previous-turn context |
| assistant.contextSummary | Last turn · {source} |
| assistant.contextPassages | {count} passages |
| assistant.contextHistory | {count} history messages |
| assistant.contextTruncated | History trimmed |
| assistant.generationDuration | Took {duration} |
| assistant.save | Save answer |
| assistant.saved | Saved |
| assistant.regenerate | Regenerate |
| assistant.editQuestion | Edit question |
| assistant.searchConversation | Search this session |
| assistant.searchTurns | {count} matching turns |
| assistant.insightLabel | Saved answers |
| assistant.insightFollowupLabel | Follow-up |
| assistant.stop | Stop generating |
| assistant.placeholderFollowup | Ask more about this passage… |
| assistant.placeholderFirst | Ask about this passage… |
| assistant.placeholderNoSelection | Write a question; select a passage before sending… |
| assistant.sendAria | Send question |
| assistant.actionExplain | Explain this |
| assistant.actionContext | In context |
| assistant.actionAsk | Ask freely |
| assistant.actionSaveHighlight | Extract this |
| assistant.pdfRegionPrompt | Explain this region of the PDF page image. |
| assistant.questionExplain | Explain my selected passage so I truly understand it, not merely restated. State the core meaning in one or two sentences, then explain what the key concepts mean here, and clarify references, turns or cause and effect. For arguments, spell out the author's claim, evidence and the conditions under which it holds. When simplifying, preserve the original qualifications, negations and tone; do not turn possibility into certainty or present the author's view as common knowledge. Use a brief hypothetical example when helpful and mark it as such. Ground the explanation in the provided passage, quote key sentences as support, and separate explicit statements from inference; where things are ambiguous or information is missing, say exactly what is uncertain. Answer directly in natural, clear English, adjusting length to difficulty; do not apply rigid sections or restate the whole passage. |
| assistant.questionContext | Centered on my selected passage and using the actual surrounding text and related passages provided, explain its role in the text. First name the most important contextual connection, then explain what question or idea it continues, and whether it defines, exemplifies, advances the argument, marks a turn, rebuts, adds a qualification or concludes — pointing to the specific words that show it. For argumentative writing, connect premises to conclusions; for narrative or description, focus on characters, plot or theme instead of forcing an argument structure. Quote key provided passages as support and separate textual evidence, background notes and inference; do not treat the order of retrieved fragments as the original order or invent a book-wide thesis from it. When context is insufficient, state what can be determined first, then what is missing. Answer in natural, clear English, centered on the selection; avoid vague evaluations, chapter-length summaries and rigid sections. |
| assistant.cancelledPartial | Generation stopped |
| assistant.cancelledEmpty | Request cancelled |
| assistant.expandDialog | Expand chat |
| assistant.citationUnknownTitle | This citation is not in the current context |
| assistant.citationUnverified | Unverified citation |
| assistant.citationSourceFallback | Passage excerpt |
| assistant.citationExcerpt | Text: {excerpt} |
| assistant.citationJumpTitle | Jump to passage: {excerpt} |
| assistant.selectionToolbarAria | Selection actions |
| assistant.selectionCloseAria | Close selection tools |

## Saved answers

| key | text |
| --- | --- |
| insights.loading | Loading saved answers |
| insights.noBookTitle | No book open |
| insights.noBookDetail | Open a book to see its saved questions and answers here. |
| insights.emptyTitle | No saved answers yet |
| insights.emptyDetail | Click “Save answer” under an assistant reply to keep it with its passage location. |
| insights.removeQuestion | Delete this Q&A? |
| insights.removeAria | Delete Q&A |
| insights.removed | Q&A deleted. |
| insights.alreadyRemoved | This Q&A no longer exists. |
| insights.removeFailed | Could not delete the Q&A. Try again. |
| insights.savedToast | Answer and passage location saved. |
| insights.saveFailed | Could not save the answer. |
| insights.readFailed | Could not load saved answers. |
| insights.scopeAll | All |
| insights.scopeBook | This book |
| insights.scopeAria | Saved answers scope |
| insights.searchPlaceholder | Search titles, authors, quotes or answers… |
| insights.searchAria | Search saved answers |
| insights.noSearchResultsTitle | No matching Q&A |
| insights.noSearchResultsDetail | Try a different keyword. |
| insights.exportAll | Export all |
| insights.exportBook | Export this book |
| insights.exportOneAria | Export this Q&A |
| insights.exportedToast | Exported {fileName} |
| insights.exportFailed | Could not export saved answers. |
| insights.exportEmpty | Nothing to export. |
| insights.bookMissing | This book is no longer in the library; its saved answers cannot be opened. |

## Extracts

| key | text |
| --- | --- |
| highlights.loading | Loading extracts |
| highlights.noBookTitle | No book open |
| highlights.noBookDetail | Open a book to see its extracts here. |
| highlights.emptyTitle | No extracts yet |
| highlights.emptyDetail | Select a passage and click “Extract this”. |
| highlights.title | Extracts |
| highlights.count | Extracts · {count} |
| highlights.removeQuestion | Delete this extract? |
| highlights.removeAria | Delete extract |
| highlights.removed | Extract deleted. |
| highlights.removeFailed | Could not delete the extract. |
| highlights.savedToast | Extracted; the source stays highlighted. |
| highlights.saveFailed | Could not save the extract. |
| highlights.readFailed | Could not load extracts. |

## Settings and connections

| key | text |
| --- | --- |
| settings.title | Settings |
| settings.closeAria | Close settings |
| settings.sectionsAria | Settings sections |
| settings.appearanceTitle | Appearance |
| settings.themeLabel | Theme |
| settings.themeHint | “System” follows the operating system appearance |
| settings.themeGroupAria | Interface theme |
| settings.themeLight | Light |
| settings.themeLightAria | Use light theme |
| settings.themeSystem | System |
| settings.themeSystemAria | Follow system theme |
| settings.themeDark | Dark |
| settings.themeDarkAria | Use dark theme |
| settings.languageLabel | Interface language |
| settings.languageHint | Switches the language of menus, buttons and messages. Applies immediately. |
| settings.languageGroupAria | Interface language |
| settings.languageZh | 中文 |
| settings.languageEn | English |
| settings.scaleLabel | Interface scale |
| settings.scaleHint | Does not affect the book text size |
| settings.scaleGroupAria | Interface scale |
| settings.assistantTitle | Selection actions |
| settings.assistantHint | Customize the names and fixed prompts of the selection buttons. Changes are saved immediately and used from the next selection action. The selection and the current chapter context are still sent together. |
| settings.immediateHint | Changes are saved and applied immediately. |
| settings.modelSaveHint | “Save configuration” keeps the current input; “Save and use” also switches the model used by later requests. Saving the active configuration applies immediately. Testing neither saves nor switches. |
| settings.readingScopeHint | Font, text size and paragraph layout apply to reflowable text like EPUB and TXT; PDF pages are unchanged. Adjust PDF zoom and display in “PDF tools” while reading. |
| settings.assistantExplainName | “Explain” button name |
| settings.assistantExplainPrompt | “Explain” button prompt |
| settings.assistantContextName | “In context” button name |
| settings.assistantContextPrompt | “In context” button prompt |
| settings.assistantAskName | “Ask freely” button name |
| settings.assistantAskHint | “Ask freely” uses no preset prompt; you type the question after clicking. |
| settings.assistantIconLabel | Button icon |
| settings.assistantIconHighlighter | Highlighter |
| settings.assistantIconBookOpen | Open book |
| settings.assistantIconMessageSquareText | Chat bubble |
| settings.assistantIconSearch | Search |
| settings.assistantIconLightbulb | Lightbulb |
| settings.assistantIconPenLine | Pen |
| settings.assistantIconQuote | Quote |
| settings.assistantIconBookMarked | Bookmarked book |
| settings.readingTitle | Reading |
| settings.restoreDefaults | Restore defaults |
| settings.fontLabel | Body text size |
| settings.fontAria | Body text size |
| settings.fontFamilyLabel | Font |
| settings.commonChineseFonts | Common Chinese |
| settings.allFonts | All fonts |
| settings.fontsLoading | Loading system fonts… |
| settings.fontsUnavailable | Could not load system fonts. Try again once the list is available. |
| settings.fontUnavailableHint | This font cannot be loaded right now. Restart the app or reinstall the font and try again. |
| settings.lineHeight | Line height |
| settings.indent | First-line indent |
| settings.contentWidth | Content width |
| settings.contentWidthNarrow | Narrow (640 px) |
| settings.contentWidthStandard | Standard (760 px) |
| settings.contentWidthWide | Wide (920 px) |
| settings.paragraphSpacing | Paragraph spacing |
| settings.spacingCompact | Compact |
| settings.spacingStandard | Standard |
| settings.spacingRelaxed | Relaxed |
| settings.textAlign | Alignment |
| settings.textAlignJustify | Justified |
| settings.textAlignLeft | Left-aligned |
| settings.paperTheme | Paper theme |
| settings.paperThemeHint | Switches paper automatically with the interface appearance. |
| settings.paperThemeDefault | Default |
| settings.paperThemeEyeCare | Eye care |
| settings.followBookDefault | Follow book / Default |
| settings.noIndent | No indent |
| settings.modelTitle | Model service |
| settings.profileLabel | Profile |
| settings.profileNameLabel | Profile name |
| settings.profileNamePlaceholder | e.g. OpenRouter daily |
| settings.newProfile | New profile |
| settings.deleteProfile | Delete profile |
| settings.activeProfile | Active |
| settings.setActive | Set active |
| settings.profileLimit | Up to 10 profiles can be saved. |
| settings.newProfilePlaceholder | New profile (unsaved) |
| settings.unsavedHint | You have unsaved changes. Switching sections keeps the draft; save before closing. |
| settings.discardChanges | You have unsaved changes. Discard them? |
| settings.deleteProfileQuestion | Delete profile “{name}” and its API key? |
| settings.baseUrlLabel | Endpoint URL |
| settings.baseUrlPlaceholder | https://api.openai.com |
| settings.baseUrlHint | The app requests {path} under this URL. |
| settings.modelLabel | Model name |
| settings.modelPlaceholder | e.g. gpt-5-mini |
| settings.modelSuggestions | Model suggestions |
| settings.fetchModels | Fetch models |
| settings.fetchingModels | Fetching models |
| settings.modelsFetched | Fetched {count} models; type to filter or enter one directly. |
| settings.modelsTruncated | Many models; showing the first {count}. |
| settings.apiKeyLabel | API key |
| settings.apiKeySaved | Saved securely |
| settings.apiKeyPlaceholderSaved | Leave blank to keep the saved key |
| settings.apiKeyPlaceholderEmpty | Enter API key |
| settings.apiKeyHint | The key is encrypted by the main process only and never written to the library database. |
| assistant.recentSessions | Recent chats |
| assistant.recentSessionsLoading | Loading recent chats… |
| assistant.promptDetails | View this prompt |
| vision.previewTitle | Recognize one page first |
| vision.previewHint | Reuses results from the same book and configuration when available; otherwise only the selected page image is sent. Full preparation reuses recognized pages. |
| vision.previewPage | PDF page |
| vision.previewStart | View this page |
| vision.previewRetry | Retry this page |
| vision.previewRefresh | Re-recognize |
| vision.previewRefreshHint | Re-recognizing sends this page again and may consume quota; the previous result is kept on failure. |
| vision.previewCached | Reused the locally stored result; no recognition request was sent. |
| vision.previewSaved | The result is saved and can be used for later preparation. |
| vision.previewPreparedHint | Click “Re-prepare text” before the new result is used for search and notes. |
| vision.previewCopy | Copy text |
| vision.previewCopied | Copied |
| vision.previewCopyFailed | Copy failed. Select the text below and copy it manually. |
| vision.previewCancel | Cancel preview |
| vision.previewRendering | Rendering page image… |
| vision.previewRecognizing | Recognizing this page… |
| vision.previewImage | Page image |
| vision.previewText | Recognized text |
| vision.previewBlank | No text was recognized on this page. Compare with the image or try another page. |
| vision.previewFailed | Single-page recognition failed. Check the document service settings and retry. |
| vision.previewCancelled | Preview cancelled. |
| vision.previewUnsupported | Single-page preview supports vision models, Mistral OCR and Unstructured. Configure and save first. |
| vision.previewBusy | A document is being processed. Pause or wait for it to finish before previewing. |
| vision.previewPageRange | Enter a PDF page number between 1 and {count}. |
| ocrReading.title | Recognized text |
| ocrReading.viewPdf | View original PDF page |
| ocrReading.hint | Reads prepared text from local storage without re-recognizing. Select text to explain, add context or ask; return to the PDF to verify anytime. |
| ocrReading.loading | Loading this page's text… |
| ocrReading.loadFailed | Could not load recognized text. Try again. |
| ocrReading.unprepared | Finish page-by-page OCR preparation for this book before viewing and selecting recognized text. |
| ocrReading.unsupported | This book has no stored page OCR text. Re-prepare the text with a vision model, Mistral OCR or Unstructured. |
| ocrReading.prepare | Open book preparation |
| ocrReading.previous | Previous page |
| ocrReading.next | Next page |
| ocrReading.go | Go |
| ocrReading.copy | Copy page |
| ocrReading.blank | No text recognized on this page; check the original PDF page. |
| ocrReading.selectionTooLong | The selection is too long. Narrow it below 20,000 characters before asking. |
| assistant.recentSessionTurns | {count} turns |
| assistant.recentSessionsHint | Each book keeps the 20 most recent chats, up to 20 turns each. Click to restore selection, answers and drafts. |
| assistant.recentSessionsEmpty | No other chats yet. |
| assistant.sessionRestoreFailed | Could not read or restore the chat. Try again. |
| assistant.sessionLoading | Restoring chat… |
| assistant.sessionSaveFailed | Saving the chat failed. Check available space and retry; the current chat must save before switching. |
| settings.testConnection | Test text reply |
| settings.testStream | Test streaming reply |
| provider.testStreamConnected | Streaming test passed: text and end marker received. |
| provider.testStreamUnsupported | No streaming reply received. Check that the endpoint supports streaming, or test the text reply first. |
| settings.save | Save configuration |
| settings.saveAndUse | Save and use |
| settings.savedAndActivatedToast | Model configuration saved and set active |
| settings.savedActivationFailed | Saved, but could not be set active: {reason} |
| settings.savedToast | Model settings saved securely |
| settings.profileActivatedToast | Active model profile switched |
| settings.profileDeletedToast | Deleted profile “{name}” |
| settings.saveFailed | Save failed. Check your input. |
| settings.testSuccessToast | Model connection OK |
| settings.testFailed | Connection failed. Check the URL, model and key. |
| provider.statusNotConfigured | API not configured |
| provider.statusChecking | Checking API connection |
| provider.statusConnected | API connected |
| provider.statusDisconnected | API not connected |
| provider.backgroundTestFailed | API connection check failed. |

## Library and reader

| key | text |
| --- | --- |
| library.tabHighlights | Extracts |
| library.highlightsAria | This book's extracts |
| library.loading | Loading library |
| library.resumeTitle | Continue “{title}” |
| library.unavailableTitle | Library unavailable |
| library.emptyTitle | Library is empty |
| library.emptyDetail | You can import EPUB, TXT, PDF, MOBI or AZW3. |
| library.tocAria | This book's contents |
| library.tocLoading | Parsing contents |
| library.tocEmptyTitle | No contents available |
| library.tocEmptyDetail | You can still scroll through the full text. |
| library.tocExpandAria | Expand {title} |
| library.tocCollapseAria | Collapse {title} |
| library.import | Import books |
| library.importing | Importing… |
| library.importProgressTitle | Import books |
| library.importProgressAria | Book import progress |
| library.importCurrent | Processing: {fileName} |
| library.importProgress | {processed} / {total} |
| library.importCancel | Stop import |
| library.importStopping | Stopping; finishes after the current file… |
| library.importSummaryTitle | Import finished |
| library.importSummary | Imported {imported} · Duplicates {duplicates} · Failed {failed} · Skipped {skipped} |
| library.importFailuresTitle | Failure details |
| library.importClose | Close |
| library.importCanceled | Import stopped. |
| library.importBusy | An import is already running. Wait for it to finish. |
| library.dropTitle | Drop to import books |
| library.dropDetail | Supports EPUB, TXT, PDF, MOBI and AZW3; up to 300 files at a time. |
| library.dropBusyTitle | Importing books |
| library.dropBusyDetail | Wait for the current batch to finish before importing. |
| library.unknownFile | Unknown file |
| library.duplicateToast | This book is already in the library and has been opened. |
| library.importedToast | Book imported to the local library. |
| library.importFailed | Import failed. Make sure the file has no DRM and is a supported format. |
| library.readFailed | Could not read the local library. |
| library.deleteBook | Delete this book |
| library.deleteQuestion | Delete “{title}”? |
| library.deleteDetail | Its extracts and saved answers are deleted too and cannot be recovered. |
| library.deletedToast | Deleted “{title}”. |
| library.alreadyRemoved | This book is no longer in the library. |
| library.deleteFailed | Could not delete the book. |
| bookDetails.title | Book details |
| bookDetails.closeAria | Close book details |
| bookDetails.openAria | View details of “{title}” |
| bookDetails.coverAlt | Cover of “{title}” |
| bookDetails.loading | Loading book details |
| bookDetails.readFailed | Could not read this book's details. The file may be damaged or was moved. |
| bookDetails.coverMissing | No cover |
| bookDetails.titleLabel | Title |
| bookDetails.authorLabel | Author |
| bookDetails.formatLabel | Format |
| bookDetails.formatEpub | EPUB |
| bookDetails.formatTxt | TXT |
| bookDetails.formatPdf | PDF |
| bookDetails.formatMobi | MOBI (converted with Calibre) |
| bookDetails.formatAzw3 | AZW3 (converted with Calibre) |
| bookDetails.originalNameLabel | Original file name |
| bookDetails.fileSizeLabel | File size |
| bookDetails.importedAtLabel | Imported |
| bookDetails.lastOpenedAtLabel | Last opened |
| bookDetails.neverOpened | Never opened |
| bookDetails.progressLabel | Reading progress |
| bookDetails.languageLabel | Language |
| bookDetails.publisherLabel | Publisher |
| bookDetails.publishedAtLabel | Published |
| bookDetails.identifierLabel | Identifier |
| bookDetails.descriptionLabel | Description |
| bookDetails.notProvided | Not provided |
| reader.progressAria | Reading progress {percent}% |
| reader.returnToReading | Back to reading position |
| reader.searchOpen | Search this book |
| reader.searchTitle | Search this book |
| reader.searchInputAria | Enter a search term |
| reader.searchPlaceholder | Search this book… |
| reader.searchSubmit | Search |
| reader.searchLoading | Searching the full text… |
| reader.searchResultCount | {count} matches |
| reader.searchResultLimit | Showing the first {count} |
| reader.searchNoResultsTitle | No matches found |
| reader.searchNoResultsDetail | Try a different word. |
| reader.searchFailed | Search failed. Try again. |
| reader.searchInvalid | Enter 1–100 characters. |
| reader.pdfPage | Page {number} |
| reader.pdfZoomOut | Zoom out |
| reader.pdfZoomIn | Zoom in |
| reader.pdfFitWidth | Fit width |
| reader.pdfWholeDocument | Whole document |
| reader.pdfUntitledSection | Untitled section |
| reader.pdfRegionSelect | Select text region |
| visual.select | Select image region |
| visual.hint | Within a single PDF page, select the image region you want the model to understand. |
| visual.reviewTitle | Confirm image region |
| visual.reviewHint | This region's image is sent to the current model service with every question. |
| visual.explain | Explain image |
| visual.ask | Ask about image |
| visual.source | PDF page {page} region |
| visual.renderFailed | Could not render the selected region. Select it again. |
| visual.crossPage | Select an image region within a single page only. |
| visual.modelUnsupported | The current Q&A model may not accept images. Switch to a vision-capable model and retry. |
| reader.pdfRegionHint | Within one page, select a paragraph, a single column or a table region. |
| reader.pdfRegionTooSmall | The selected region is too small. Drag again. |
| reader.pdfRegionEmpty | The selected region contains no extractable text. |
| reader.pdfRegionTooLarge | The selected text exceeds 20,000 characters. Narrow the region. |
| reader.pdfRegionReviewTitle | Confirm selected text |
| reader.pdfRegionReviewDetail | Review and fix the extracted text, then continue with selection actions. |
| reader.pdfRegionReviewInputAria | Selected text content |
| reader.pdfRegionCancel | Cancel |
| reader.pdfRegionConfirm | Use this selection |
| reader.pdfInternalLink | Jump to internal PDF page |
| reader.pdfNoText | This page has no selectable text. After page-by-page OCR, use “Recognized text” to read and select, or search and ask across the book. |
| reader.pdfPageNoText | This page has no text layer |
| reader.pdfSearchUnavailable | This PDF has no searchable text layer. Recognize the text in “Book preparation” before searching. |
| reader.pdfInvalidAnchor | Invalid PDF anchor. |
| reader.pdfOpenFailed | Could not open the PDF. It may be damaged or password-protected. |
| reader.areaAria | Main reading area |
| reader.emptyAria | No book open |
| reader.emptyText | Open a book from the library or import one |
| reader.welcomeTitle | Start with a book |
| reader.welcomeDetail | Import EPUB, TXT or PDF. With Calibre installed, MOBI and AZW3 convert to EPUB on import. |
| reader.opening | Opening “{title}” |
| reader.openingDetail | Parsing content and last reading position… |
| reader.openFailedTitle | This book cannot be opened right now |
| reader.openAgain | Open again |
| reader.openFailed | Could not open this book. The file may be damaged or has DRM. |
| reader.preferencesFailed | Could not apply reading settings. |
| reader.bridgeFailed | The app's security bridge failed to load. Restart LLM Reader. |
| reader.navigateSourceFailed | Could not jump to this passage. |
| reader.navigateChapterFailed | Could not jump to this chapter. |

## File and content errors

| key | text |
| --- | --- |
| error.internal | The operation failed. Try again later. |
| error.invalidInput | Invalid input. |
| error.untrustedSender | Rejected a request from an untrusted page. |
| dialog.importTitle | Import books |
| dialog.importFilter | EPUB, UTF-8 TXT, PDF, MOBI or AZW3 |
| dialog.exportTitle | Export saved answers |
| dialog.exportFilter | Markdown files |
| error.epubUnsafePath | The EPUB contains unsafe internal paths. |
| error.epubIncomplete | The EPUB structure is incomplete. |
| error.epubMetadataTooLarge | The EPUB metadata is unusually large. |
| error.epubOpenFailed | Could not open the EPUB. It may be damaged. |
| error.epubTooManyEntries | The EPUB has an unusually large number of internal files. |
| error.epubEntryTooLarge | The EPUB contains an unusually large internal file. |
| error.epubExpandedTooLarge | The EPUB's expanded content exceeds the safe limit. |
| error.epubInvalid | The file is not a valid EPUB. |
| error.epubDrm | DRM-protected EPUBs are not supported. |
| error.epubMissingContent | The EPUB is missing content documents. |
| error.txtEncoding | TXT files must use UTF-8 encoding. |
| error.txtBinary | The TXT contains invalid binary content. |
| error.importAbsolutePath | Only local files with absolute paths can be imported. |
| error.importNotFound | The file to import was not found. |
| error.importNotFile | The selected path is not a file. |
| error.importEmpty | Empty files cannot be imported. |
| error.importTooLarge | The file exceeds the 250 MB import limit. |
| error.importUnsupported | Only .epub, .txt, .pdf, .mobi and .azw3 files can be imported. |
| error.importBatchTooLarge | Up to 300 files per import; split them into batches. |
| error.importBusy | An import is already running. |
| error.txtTooLarge | The TXT file exceeds the 64 MB import limit. |
| error.pdfInvalid | The file is not a valid PDF. |
| error.calibreNotFound | Calibre was not found. Install Calibre, or convert the file to EPUB manually first. |
| error.calibreConversionFailed | Calibre could not convert this file. It may be damaged, DRM-protected or in an unsupported format. |
| error.calibreTimeout | Calibre conversion timed out. Check the file and retry. |
| library.untitled | Untitled book |
| error.bookNotFound | This book was not found. |
| error.storagePath | The book storage path is invalid. |
| reader.epubUntitledChapter | Untitled chapter |
| reader.epubEmpty | The EPUB file is empty |
| reader.epubUntitled | Untitled EPUB |
| reader.epubInvalidAnchor | Invalid or untrusted EPUB anchor |
| reader.epubAnchorFailed | The EPUB anchor could not be resolved |
| reader.epubInvalidHighlight | Invalid EPUB highlight anchor |
| reader.epubSection | Section {number} |
| reader.epubNotOpen | The EPUB reader has not opened a document yet |
| reader.txtEmpty | The TXT file contains no readable text |
| reader.txtOpening | Opening |
| reader.txtInvalidAnchor | Invalid TXT anchor |
| reader.txtAnchorOutside | The TXT anchor is not in the current document |
| reader.txtInvalidHighlight | Invalid TXT highlight anchor |
| reader.txtFullText | Full text |

## Saved answer export

| key | text |
| --- | --- |
| export.title | LLM Reader saved answers |
| export.generatedAt | Exported at {datetime} |
| export.summary | {books} books · {insights} Q&As |
| export.bookHeading | {title} |
| export.entryHeading | Q&A {index} |
| export.chapterLabel | Chapter |
| export.quoteLabel | Passage |
| export.questionLabel | Question |
| export.answerLabel | Answer |
| export.modelLabel | Model |
| export.dateLabel | Saved at |
| export.followupsLabel | Follow-ups |
| export.followupLabel | Follow-up {index} |
| export.userLabel | Q |
| export.assistantLabel | A |
| export.citationsNote | [passage-id] in answers are the reader's internal citations. |
| export.untitledBook | Untitled book |
| export.fileNameAll | LLM-Reader-All-Saved-Answers |
| export.fileNameBook | LLM-Reader-{title}-Saved-Answers |

## Model service errors

| key | text |
| --- | --- |
| error.baseUrlInvalid | The endpoint URL is invalid. |
| error.baseUrlUnsafe | The endpoint URL must be an HTTP(S) URL without account information. |
| error.http400 | The request was rejected by the model service (400). |
| error.http401 | The API key is invalid or unauthorized (401). |
| error.http403 | The model service denied access (403). |
| error.http404 | The endpoint or model was not found (404). |
| error.http429 | Too many requests or out of quota (429). |
| error.httpOther | The model service returned an error ({status}). |
| error.responseTooLarge | The model response exceeds the local processing limit. |
| error.providerInvalidJson | The model service returned invalid JSON. |
| error.providerEmptyText | The model service returned no text. |
| error.answerTooLarge | The model answer exceeds the local display limit. |
| error.providerEmptyStream | The model service returned no stream. |
| error.streamEventTooLarge | The streaming event exceeds the local processing limit. |
| error.streamInterrupted | The streamed answer was interrupted unexpectedly. Try again. |
| error.duplicateRequest | A request with the same ID already exists. |
| error.answerCancelled | The answer was cancelled. |
| error.requestTimeout | The model request timed out. |
| error.requestStartFailed | The request could not start. Check the model settings. |
| error.keyStorageUnavailable | This system cannot store API keys securely. |
| error.providerNotConfigured | Save the API key and model settings first. |
| error.keyReadUnavailable | This system cannot read API keys. |
| error.keyDecryptFailed | The API key could not be decrypted. Save it again. |
| provider.testConnected | Text test passed: a valid reply was received. |
| provider.testTimeout | Connection timed out. |
| provider.testFailed | Could not connect to the model service. |
| error.keyReadFailed | Could not read the encrypted API key. |
| error.keyCipherInvalid | The API key cipher file is invalid. Save it again. |
| error.keyCipherSize | The API key cipher size is invalid. |
| error.keyWriteFailed | Could not save the encrypted API key. |
| error.providerProfileNameExists | This profile name already exists. |
| error.providerProfileLimit | Up to 10 model profiles can be saved. |
| error.providerProfileNotFound | This model profile was not found. |
| error.providerProfileKeyRequired | Enter or save this profile's API key first. |
| error.providerModelsInvalid | The model service returned an invalid model list. |
| error.providerModelsEmpty | The model service returned no usable model IDs. |

## Document and input validation

| key | text |
| --- | --- |
| error.documentCancelled | Source text preparation stopped. |
| error.notesUpdated | The source text changed. Regenerate the chapter notes. |
| error.documentCacheLimit | The document structure cache exceeded its limit. |
| document.bodyGroup | Body group |
| validation.sourceRange | Invalid source range |
| validation.documentSource | Invalid document structure or source |
| validation.passageId | passage id must be unique |
| validation.contextLimit | Context too large |
| validation.contextMismatch | Context source mismatch |
| validation.contextSource | Invalid context source |
| validation.archiveSelection | The Q&A and selection must belong to the same book |
| validation.archiveHistory | The Q&A history must belong to the same book |
| validation.httpUrl | The endpoint must be an HTTP(S) URL |
| validation.question | The question cannot be empty |
| validation.endpoint | The endpoint URL cannot contain query parameters or fragments |
| validation.rerank | Enter the rerank URL and model |
| validation.embedding | Enter the embedding URL and model |
| validation.documentUrl | Enter the document processing service URL |
| validation.sectionLimit | Section too large |
| validation.tableDepth | Tables are nested too deeply. |
| validation.tableSpan | Invalid table span. |
| validation.tableCount | Invalid table count. |
| validation.tableStructure | Incomplete table structure. |
| validation.tableRows | Invalid table row count. |
| validation.tableOverlap | Table cells overlap. |
| validation.tableEmpty | The table has no cells. |

## Request configuration

| key | text |
| --- | --- |
| request.advanced | Advanced request settings |
| request.protocol | API protocol |
| request.openai | OpenAI compatible |
| request.anthropic | Anthropic / Claude |
| request.headers | Custom headers (JSON) |
| request.headersSaved | Headers saved; leave blank to keep, filling replaces them entirely |
| request.headersExample | e.g. {example} |
| request.headersHint | Headers are stored encrypted. They can override Authorization, x-api-key, User-Agent and more; names are case-insensitive. Re-enter them after changing the URL or protocol. |
| request.headersInvalid | Enter a JSON object whose values are all strings. Names must be unique and cannot set transport headers like Host, Content-Type or Content-Length. |
| request.clearHeaders | Remove saved custom headers |
| request.clearDraftHeaders | Clear unsaved headers |
| request.clearPending | Headers are removed when the current configuration is saved; you can undo before saving. |
| request.body | Extra request parameters (JSON) |
| request.bodyExample | e.g. {example} |
| request.bodyHint | Fill in options the service supports, such as max_tokens or temperature for models, or strategy and ocr_engine for document services. Files, messages, the model and response format are filled by the reader. Put keys in headers. |
| request.bodyInvalid | Enter a valid JSON object; do not override reader-managed fields like files, messages, the model or response format. |
| request.timeout | Request timeout (seconds, 1–600) |
| request.timeoutDefault | Use default timeout |
| request.streamError | The model service returned an error mid-stream. Try again later. |
| request.incomplete | The model output ended prematurely. Increase max_tokens or adjust model parameters and retry. |
| request.mistral | Mistral OCR |
| request.unstructured | Unstructured Partition |
| request.ocrModel | OCR model name |
| request.testOcr | Test OCR |
| request.pageHint | Recognizes PDF text page by page with a dedicated OCR service; finished pages are cached and you can resume after pausing. Text is saved per page, so complex table structures need checking. Try one page of this book first. |
| request.partitionHint | Enter an Unstructured Partition endpoint or a local compatible service URL; not for Workflow endpoints. |
| request.preset | Preset services |
| request.custom | Custom URL |

| request.keyScope | After changing the endpoint URL or protocol, re-enter the API key; the old key is not sent to the new endpoint automatically. |
