/* global document, window */

const demo = document.querySelector('[data-reader-demo]')

if (demo) {
  const find = (selector) => demo.querySelector(selector)
  const turnList = find('[data-demo-turns]')
  const turnTemplate = find('#demo-answer-template')
  const turns = []
  const recentSessions = []
  const empty = find('[data-demo-empty]')
  const source = find('[data-demo-source]')
  const selection = find('[data-demo-selection]')
  const reader = find('.demo-reader-surface')
  const sidebar = find('.demo-right-sidebar')
  const scroll = find('.demo-assistant-scroll')
  const viewport = demo.closest('.product-viewport')
  const bookTitle = find('.demo-book-heading > strong').textContent
  const chapter = find('[data-demo-chapter]').textContent
  const passages = new Map(Array.from(demo.querySelectorAll('[data-demo-passage]'),
    (target) => [target.dataset.demoPassage, { text: target.textContent, target }]))
  const closePreview = enablePassagePreview(demo, passages, bookTitle, chapter, jumpToPassage)
  const fullscreen = find('button[data-demo-fullscreen]')
  const openAssistant = find('[data-demo-open-assistant]')
  const closeAssistant = find('[data-demo-close-assistant]')
  const highlights = find('#demo-highlights')
  const readingPlaceButton = find('[data-demo-reading-place]')
  const composer = find('#demo-followup')
  const send = find('[data-demo-send]')
  const contextHint = find('[data-demo-context-hint]')
  const composerScope = find('#demo-composer-scope')
  const conversationSearch = find('[data-demo-search]')
  const recentPanel = find('#demo-recent')
  const recentQuery = find('[data-demo-recent-query]')
  const searchCount = find('[data-demo-search-count]')
  const clearConfirm = find('[data-demo-clear-confirm]')
  const status = find('[data-demo-status]')
  const toast = find('[data-demo-toast]')
  const web = find('[data-demo-web-search]')
  const personaTrigger = find('[data-demo-persona-trigger]')
  const personaPanel = find('[data-demo-persona-panel]')
  const personaSelect = find('#demo-persona-select')
  const personaEditor = find('[data-demo-persona-editor]')
  const personaName = find('#demo-persona-name')
  const personaPrompt = find('#demo-persona-prompt')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const compact = window.matchMedia('(max-width: 720px)')
  const prompts = {
    explain: '请解释我选中的原文，帮助我读懂它，而不只是换一种说法。以原文为依据，理清关键概念、前提与适用边界，区分明确表述与推断。',
    context: '请以我选中的原文为中心，结合本次实际提供的前后文和相关原文，说明它在文本中的作用。请指出它承接的观点，并给出原文依据。'
  }
  let scope = demo.dataset.demoScope
  let hasSelection = true
  let readingPlace = null
  let emphasized = null
  let toastTimer
  let citationTimer
  let savedPersonas = 0
  let recentTrigger = null
  let updatedAt = new Date()
  const personas = new Map([
    ['default', { name: '本会话自定义', prompt: '' }],
    ['evidence', { name: '证据与边界', prompt: '先核对原文，再解释概念；区分作者的明确表述与推断，说明结论的前提和边界。' }]
  ])
  source.querySelector('blockquote').textContent = '“' + selection.textContent + '”'

  function notify(message) {
    window.clearTimeout(toastTimer)
    toast.textContent = message
    toast.hidden = false
    status.textContent = message
    toastTimer = window.setTimeout(() => { toast.hidden = true }, 2200)
  }

  function resizeInput() {
    composer.style.height = 'auto'
    composer.style.height = Math.min(160, Math.max(64, composer.scrollHeight)) + 'px'
    send.disabled = !composer.value.trim() || (scope === 'selection' && !hasSelection)
    find('[data-demo-clear]').hidden = (!turns.length && !composer.value) || !clearConfirm.hidden
  }

  function closePersona(restoreFocus = false) {
    personaPanel.hidden = true
    personaTrigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) personaTrigger.focus({ preventScroll: true })
  }

  function setView(view) {
    closeRecent()
    closePreview()
    closePersona()
    setHighlights(false)
    if (view === 'conversation' && fullscreen.getAttribute('aria-pressed') === 'true') setFullscreen(false)
    demo.dataset.demoView = view
    for (const button of demo.querySelectorAll('.demo-bookbar button[data-demo-view]')) {
      const active = button.dataset.demoView === view
      button.classList.toggle('is-active', active)
      if (active) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
    viewport.scrollLeft = 0
    resizeInput()
    renderSearch()
  }

  function renderScope() {
    demo.dataset.demoScope = scope
    composerScope.value = scope
    find('[data-demo-scope-status]').textContent = scope === 'book' ? '原文已就绪' : hasSelection ? '已选中原文' : '尚未选中原文'
    source.hidden = scope === 'book' || !hasSelection
    empty.hidden = Boolean(turns.length) || (scope === 'selection' && hasSelection)
    empty.querySelector('strong').textContent = scope === 'book' ? '从书中寻找答案' : '选中原文，开始理解'
    empty.querySelector('p').textContent = scope === 'book'
      ? '询问书中的观点、概念或章节联系，回答会附上本次参考的原文。'
      : '回答会结合当前选区及附近段落。'
    empty.querySelector('use').setAttribute('href', scope === 'book' ? '#di-book' : '#di-sparkles')
    for (const button of demo.querySelectorAll('button[data-demo-scope]')) {
      const active = button.dataset.demoScope === scope
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
    composer.placeholder = scope === 'book' ? '询问本书的观点、概念或章节联系…'
      : !hasSelection ? '写下问题，发送前先选中原文…'
        : turns.length ? '继续追问这段原文…' : '针对这段原文提问…'
    contextHint.hidden = turns.length === 0
    for (const button of demo.querySelectorAll('[data-demo-copy-session], [data-demo-export]')) {
      button.disabled = turns.length === 0
    }
    resizeInput()
  }

  function resetConversation(nextScope) {
    closeRecent()
    closePreview()
    clearEmphasis()
    scope = nextScope
    updatedAt = new Date()
    turns.length = 0
    turnList.replaceChildren()
    demo.dataset.demoState = hasSelection && scope === 'selection' ? 'selected' : 'reading'
    conversationSearch.value = ''
    clearConfirm.hidden = true
    renderSearch()
    composer.value = ''
    closePersona()
    renderScope()
    scroll.scrollTop = 0
  }

  function sessionSnapshot() {
    return { scope, hasSelection, turns: turns.slice(-20), draft: composer.value, updatedAt,
      persona: personaSelect.value, customPersona: personas.get('custom'), web: web.getAttribute('aria-pressed') === 'true' }
  }

  function rememberSession() {
    if (!turns.length && !composer.value.trim()) return
    recentSessions.unshift(sessionSnapshot())
    recentSessions.splice(19) // The current session occupies the twentieth slot.
  }

  function switchScope(nextScope) {
    if (nextScope === scope) return
    rememberSession()
    resetConversation(nextScope)
    personaSelect.value = 'default'
    updatePersona(false)
    setWeb(false)
  }

  function restoreSession(session) {
    closeRecent(true)
    const index = recentSessions.indexOf(session)
    if (index < 0) return // A search can also match the open session.
    recentSessions.splice(index, 1)
    rememberSession()
    resetConversation(session.scope)
    hasSelection = session.hasSelection
    turns.push(...session.turns)
    turnList.replaceChildren(...turns.map((turn) => turn.element))
    composer.value = session.draft
    updatedAt = session.updatedAt
    if (session.persona === 'custom' && session.customPersona) {
      personas.set('custom', session.customPersona)
      personaSelect.querySelector('option[value="custom"]').textContent = session.customPersona.name
    }
    personaSelect.value = session.persona
    updatePersona(false)
    setWeb(session.web)
    demo.dataset.demoState = turns.length ? 'answered' : scope === 'selection' && hasSelection ? 'selected' : 'reading'
    renderScope()
    renderSearch()
    scroll.scrollTop = scroll.scrollHeight
  }

  function closeRecent(restoreFocus = false) {
    if (!recentTrigger) return
    recentPanel.hidden = true
    recentTrigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) recentTrigger.focus({ preventScroll: true })
    recentTrigger = null
  }

  function renderRecent() {
    const needle = recentQuery.value.trim().toLocaleLowerCase()
    const sessions = needle && (turns.length || composer.value.trim()) ? [sessionSnapshot(), ...recentSessions] : recentSessions
    const list = recentPanel.querySelector('.demo-recent-list')
    list.replaceChildren()
    for (const session of sessions) {
      const fields = [{ label: '', text: bookTitle }]
      for (const turn of session.turns) {
        fields.push({ label: '问题', text: turn.question }, { label: '回答', text: turn.lead + ' ' + turn.example })
      }
      const match = fields.find((field) => field.text.toLocaleLowerCase().includes(needle))
      if (!match) continue
      const item = find('#demo-recent-item').content.firstElementChild.cloneNode(true)
      const title = item.querySelector('strong')
      title.textContent = bookTitle
      title.hidden = !needle
      const scopeLabel = session.scope === 'book' ? '整本书' : '选中内容'
      item.querySelector('span').textContent = excerpt(session.turns[0]?.question || scopeLabel, 48)
      const snippet = item.querySelector('.demo-recent-match')
      snippet.hidden = !match.label
      if (needle) {
        const hit = match.text.toLocaleLowerCase().indexOf(needle)
        const mark = document.createElement('mark')
        mark.textContent = match.text.slice(hit, hit + needle.length)
        const field = match.label ? snippet : title
        field.replaceChildren(match.label ? match.label + ' · ' : '', match.text.slice(Math.max(0, hit - 12), hit),
          mark, excerpt(match.text.slice(hit + needle.length), 32))
      }
      item.querySelector('small').textContent = scopeLabel + ' · ' + session.updatedAt.toLocaleString('zh-CN') + ' · ' + session.turns.length + ' 轮'
      item.addEventListener('click', () => restoreSession(session))
      list.append(item)
    }
    const emptyRecent = find('[data-demo-recent-empty]')
    emptyRecent.hidden = list.childElementCount > 0
    emptyRecent.textContent = needle ? '最近保留的对话中没有匹配结果。' : '还没有其他对话。'
  }

  for (const button of demo.querySelectorAll('button[data-demo-recent]')) {
    button.addEventListener('click', () => {
      if (recentTrigger === button) { closeRecent(true); return }
      closePreview()
      closePersona()
      recentTrigger = button
      button.setAttribute('aria-expanded', 'true')
      recentPanel.hidden = false
      recentQuery.value = ''
      renderRecent()
      recentQuery.focus({ preventScroll: true })
    })
  }
  recentQuery.addEventListener('input', renderRecent)
  find('[data-demo-close-recent]').addEventListener('click', () => closeRecent(true))
  recentPanel.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !recentPanel.contains(event.relatedTarget) && event.relatedTarget !== recentTrigger) closeRecent()
  })

  function revealAssistant() {
    sidebar.hidden = false
    if (demo.dataset.demoView !== 'reading') return
    if (compact.matches) sidebar.scrollIntoView({ block: 'nearest' })
    else if (viewport.scrollWidth > viewport.clientWidth) viewport.scrollLeft = viewport.scrollWidth
  }

  function showAnswer(action, value = prompts[action]) {
    if (action !== 'ask') switchScope('selection')
    if (scope === 'selection' && !hasSelection) return
    closePreview()
    closePersona()
    clearEmphasis()
    demo.dataset.demoState = 'answered'
    const lead = scope === 'book'
      ? '作者建议从三个方面读一个概念。先弄清定义，再找出结论依赖的前提，最后核对它在哪些情境中适用。'
      : action === 'context'
        ? '作者先区分定义和成立条件，随后用“适用边界”限定了模型的使用范围。这段话把概念的定义和它在什么情况下有用连了起来。'
        : '读到一个结论时，可以先找出它依赖的前提。作者写的是“可能失效”，所以前提一旦改变，就需要重新检查结论。'
    const example = personaSelect.value === 'default'
      ? '例如，用固定步速估算到达时间，就假定了途中能保持这个速度。遇到陡坡时，这个估算也要跟着调整。这个例子用来说明前提的作用。'
      : '核对时可以把结论和前提分别写下来，再标出原文对适用范围的限制。'
    const citation = scope === 'book' ? 'P3' : action === 'context' ? 'P2' : 'P1'
    const element = turnTemplate.content.firstElementChild.cloneNode(true)
    const turn = { action, question: value, lead, example, citation, scope, element }
    turns.push(turn)
    updatedAt = new Date()
    const field = (selector) => element.querySelector(selector)
    field('[data-demo-question-label]').textContent = action === 'explain' ? '解释这段' : action === 'context' ? '联系上下文' : '自由提问'
    const prompt = field('.demo-question-prompt')
    prompt.hidden = action === 'ask'
    field('[data-demo-question]').hidden = action !== 'ask'
    field(action === 'ask' ? '[data-demo-question]' : '.demo-question-prompt p').textContent = value
    field('[data-demo-answer-lead]').textContent = lead
    field('[data-demo-answer-example]').textContent = example
    const inline = field('.demo-citation')
    inline.dataset.demoPreview = citation
    inline.textContent = '原文：' + excerpt(passages.get(citation).text, 24)
    for (const [id, passage] of passages) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.demoPreview = id
      button.setAttribute('aria-haspopup', 'dialog')
      button.setAttribute('aria-expanded', 'false')
      button.textContent = chapter + '：' + excerpt(passage.text, 60)
      field('.demo-answer-sources').append(button)
    }
    field('[data-demo-web-sources]').hidden = web.getAttribute('aria-pressed') !== 'true'
    field('[data-demo-save]').addEventListener('click', (event) => {
      event.currentTarget.disabled = true
      event.currentTarget.querySelector('span').textContent = '已归档'
      notify('已归档演示回答。')
    })
    field('[data-demo-copy-turn]').addEventListener('click', () => copyMarkdown(turn))
    field('[data-demo-edit-question]').addEventListener('click', () => {
      removeLastTurn()
      composer.value = value
      updatedAt = new Date()
      renderScope()
      renderSearch()
      composer.focus()
    })
    field('[data-demo-regenerate]').addEventListener('click', () => {
      removeLastTurn()
      showAnswer(action, value)
    })
    turnList.append(element)
    composer.value = ''
    renderScope()
    renderSearch()
    revealAssistant()
    if (action !== 'ask') element.focus({ preventScroll: true })
    window.requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight
    })
    status.textContent = '已显示预设回答，可查看引用的原文。'
  }

  function removeLastTurn() {
    closePreview()
    turns.pop().element.remove()
  }

  function markdown(singleTurn) {
    const title = singleTurn ? '第 ' + (turns.indexOf(singleTurn) + 1) + ' 轮' : '当前会话'
    const lines = ['# ' + bookTitle + ' · ' + title, '']
    turns.forEach((turn, index) => {
      if (singleTurn && turn !== singleTurn) return
      lines.push('## 第 ' + (index + 1) + ' 轮', '', '**原文**', '',
        turn.scope === 'selection' ? '> ' + selection.textContent : '整本书', '',
        '**问题**', '', turn.question, '', '**回答**', '',
        turn.lead + ' [' + turn.citation + ']', '', turn.example, '', '**本轮实际参考原文**', '')
      for (const [id, passage] of passages) lines.push('### [' + id + '] ' + chapter, '', '> ' + passage.text, '')
    })
    return lines.join('\n')
  }

  async function copyMarkdown(turn) {
    try {
      await window.navigator.clipboard.writeText(markdown(turn))
      notify(turn ? '已复制本轮问答。' : '已复制当前会话。')
    } catch {
      notify('浏览器未能复制。可点「另存为 Markdown」下载会话。')
    }
  }

  for (const button of demo.querySelectorAll('[data-demo-copy-session]')) {
    button.addEventListener('click', () => copyMarkdown())
  }
  for (const button of demo.querySelectorAll('[data-demo-export]')) {
    button.addEventListener('click', () => {
      const file = new window.Blob([markdown()], { type: 'text/markdown;charset=utf-8' })
      const url = window.URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = bookTitle + '-当前会话.md'
      link.click()
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
    })
  }

  for (const button of demo.querySelectorAll('[data-demo-passive]')) {
    button.title = '此入口请在桌面应用中使用'
    button.disabled = true
  }
  for (const button of demo.querySelectorAll('button[data-demo-scope]')) {
    button.addEventListener('click', () => {
      switchScope(button.dataset.demoScope)
    })
  }
  for (const button of demo.querySelectorAll('button[data-demo-view]')) {
    button.addEventListener('click', () => setView(button.dataset.demoView))
  }
  find('[data-demo-explain]').addEventListener('click', () => showAnswer('explain'))
  find('[data-demo-context]').addEventListener('click', () => showAnswer('context'))
  find('[data-demo-ask]').addEventListener('click', () => {
    switchScope('selection')
    demo.dataset.demoState = 'reading'
    renderScope()
    revealAssistant()
    composer.focus()
  })
  find('[data-demo-clear-selection]').addEventListener('click', () => {
    demo.dataset.demoState = turns.length ? 'answered' : 'reading'
    if (!turns.length) hasSelection = false
    renderScope()
    selection.focus({ preventScroll: true })
  })
  function setHighlights(open) {
    highlights.hidden = !open
    find('[data-demo-highlights]').setAttribute('aria-expanded', String(open))
  }
  find('[data-demo-highlights]').addEventListener('click', () => setHighlights(highlights.hidden))
  find('[data-demo-close-highlights]').addEventListener('click', () => {
    setHighlights(false)
    find('[data-demo-highlights]').focus()
  })
  find('[data-demo-excerpt]').addEventListener('click', () => {
    selection.classList.add('is-excerpt')
    find('[data-demo-no-highlights]').hidden = true
    const saved = find('[data-demo-saved-highlight]')
    saved.querySelector('span').textContent = selection.textContent
    saved.hidden = false
    demo.dataset.demoState = turns.length ? 'answered' : 'reading'
    selection.focus({ preventScroll: true })
    notify('已摘录，并保留原文高亮。')
  })
  find('[data-demo-saved-highlight]').addEventListener('click', () => jumpToPassage('P1'))
  function selectPassage() {
    clearEmphasis()
    hasSelection = true
    demo.dataset.demoState = 'selected'
    renderScope()
  }
  selection.addEventListener('click', selectPassage)
  selection.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPassage() }
  })
  function clearEmphasis() {
    window.clearTimeout(citationTimer)
    emphasized?.classList.remove('is-citation-return')
    emphasized = null
  }
  function jumpToPassage(id) {
    clearEmphasis()
    setView('reading')
    const target = passages.get(id).target
    const top = Math.min(reader.scrollHeight - reader.clientHeight,
      Math.max(0, target.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 70))
    if (readingPlace === null && Math.abs(top - reader.scrollTop) > 1) readingPlace = reader.scrollTop
    readingPlaceButton.hidden = readingPlace === null
    reader.scrollTo({ top, behavior: reduceMotion.matches ? 'instant' : 'smooth' })
    if (compact.matches) {
      if (demo.dataset.demoFullscreen === 'true') sidebar.hidden = true
      reader.scrollIntoView({ block: 'nearest' })
    }
    target.focus({ preventScroll: true })
    emphasized = target
    target.classList.add('is-citation-return')
    demo.dataset.demoState = 'citation'
    citationTimer = window.setTimeout(() => {
      clearEmphasis()
      demo.dataset.demoState = turns.length ? 'answered' : 'reading'
    }, 1000)
    status.textContent = '已返回对应原文。'
  }
  find('[data-demo-return]').addEventListener('click', () => jumpToPassage('P1'))
  readingPlaceButton.addEventListener('click', () => {
    reader.scrollTo({ top: readingPlace, behavior: reduceMotion.matches ? 'instant' : 'smooth' })
    readingPlace = null
    readingPlaceButton.hidden = true
    reader.focus({ preventScroll: true })
  })
  function setFullscreen(active) {
    closeRecent()
    closePreview()
    closePersona()
    demo.dataset.demoFullscreen = String(active)
    const label = active ? '退出阅读全屏' : '进入阅读全屏'
    fullscreen.title = label
    fullscreen.setAttribute('aria-label', label)
    fullscreen.setAttribute('aria-pressed', String(active))
    fullscreen.querySelector('use').setAttribute('href', active ? '#di-collapse' : '#di-expand')
    openAssistant.hidden = !active
    closeAssistant.hidden = !active
    sidebar.hidden = false
    resetAssistantPosition()
    viewport.scrollLeft = 0
  }
  fullscreen.addEventListener('click', () => setFullscreen(demo.dataset.demoFullscreen !== 'true'))
  closeAssistant.addEventListener('click', () => {
    closeRecent()
    closePreview()
    closePersona()
    sidebar.hidden = true
    openAssistant.focus()
  })
  openAssistant.addEventListener('click', () => {
    revealAssistant()
    composer.focus()
  })
  const dragHandle = find('.demo-assistant-title')
  let drag = null
  function resetAssistantPosition() {
    sidebar.style.removeProperty('--demo-float-right')
    sidebar.style.removeProperty('--demo-float-bottom')
  }
  dragHandle.addEventListener('pointerdown', (event) => {
    if (demo.dataset.demoFullscreen !== 'true' || !event.isPrimary || event.button !== 0) return
    const frame = demo.getBoundingClientRect()
    const box = sidebar.getBoundingClientRect()
    drag = {
      x: event.clientX, y: event.clientY, right: frame.right - box.right, bottom: frame.bottom - box.bottom,
      maxRight: frame.width - box.width - 4, maxBottom: frame.bottom - find('.demo-bookbar').getBoundingClientRect().bottom - box.height - 4
    }
    dragHandle.setPointerCapture(event.pointerId)
  })
  dragHandle.addEventListener('pointermove', (event) => {
    if (!drag || !dragHandle.hasPointerCapture(event.pointerId)) return
    const right = Math.max(4, Math.min(drag.maxRight, drag.right + drag.x - event.clientX))
    const bottom = Math.max(4, Math.min(drag.maxBottom, drag.bottom + drag.y - event.clientY))
    sidebar.style.setProperty('--demo-float-right', right + 'px')
    sidebar.style.setProperty('--demo-float-bottom', bottom + 'px')
  })
  dragHandle.addEventListener('lostpointercapture', () => { drag = null })
  window.addEventListener('resize', resetAssistantPosition)
  reader.addEventListener('scroll', () => {
    const maximum = reader.scrollHeight - reader.clientHeight
    const percent = maximum > 0 ? Math.round(reader.scrollTop / maximum * 100) : 0
    find('[data-demo-progress-label]').textContent = percent + '%'
    find('.demo-title-progress').setAttribute('aria-valuenow', String(percent))
    find('.demo-title-progress i').style.width = percent + '%'
  })
  composer.addEventListener('input', () => {
    updatedAt = new Date()
    resizeInput()
  })
  composerScope.addEventListener('change', () => {
    switchScope(composerScope.value)
  })
  function renderSearch() {
    const needle = demo.dataset.demoView === 'conversation' ? conversationSearch.value.trim().toLocaleLowerCase() : ''
    let count = 0
    for (const turn of turns) {
      const quote = turn.scope === 'selection' ? selection.textContent : ''
      const matches = [turn.question, turn.lead, turn.example, quote].some((text) => text.toLocaleLowerCase().includes(needle))
      turn.element.classList.toggle('is-search-hidden', Boolean(needle) && !matches)
      if (matches) count++
      if (needle && turn.action !== 'ask' && turn.question.toLocaleLowerCase().includes(needle)) {
        turn.element.querySelector('.demo-question-prompt').open = true
      }
    }
    searchCount.hidden = !needle
    searchCount.textContent = count + ' 轮匹配'
  }
  conversationSearch.addEventListener('input', renderSearch)
  find('[data-demo-clear]').addEventListener('click', () => {
    clearConfirm.hidden = false
    find('[data-demo-clear]').hidden = true
  })
  find('[data-demo-clear-no]').addEventListener('click', () => {
    clearConfirm.hidden = true
    resizeInput()
  })
  find('[data-demo-clear-yes]').addEventListener('click', () => {
    resetConversation(scope)
    notify('已清空当前演示会话。')
  })
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      if (!send.disabled) find('[data-demo-form]').requestSubmit()
    }
  })
  find('[data-demo-form]').addEventListener('submit', (event) => {
    event.preventDefault()
    if (!send.disabled) showAnswer('ask', composer.value.trim())
  })
  function setWeb(automatic) {
    const label = automatic ? '联网：自动' : '联网：关闭'
    web.setAttribute('aria-pressed', String(automatic))
    web.setAttribute('aria-label', label)
    find('#demo-web-tooltip strong').textContent = label
    web.querySelector('use').setAttribute('href', automatic ? '#di-globe' : '#di-globe-off')
  }
  web.addEventListener('click', () => setWeb(web.getAttribute('aria-pressed') !== 'true'))
  personaTrigger.addEventListener('click', () => {
    if (viewport.scrollWidth > viewport.clientWidth) viewport.scrollLeft = demo.dataset.demoView === 'reading' ? viewport.scrollWidth : 0
    const open = personaPanel.hidden
    personaPanel.hidden = !open
    personaEditor.hidden = true
    personaTrigger.setAttribute('aria-expanded', String(open))
    find('[data-demo-persona-save-as]').hidden = personaSelect.value === 'default'
    if (open) personaSelect.focus({ preventScroll: true })
  })
  function updatePersona(restoreFocus = true) {
    const name = personaSelect.value === 'default' ? '默认' : personaSelect.selectedOptions[0].textContent
    personaTrigger.setAttribute('aria-label', '助手：' + name)
    find('#demo-persona-tooltip').textContent = '助手：' + name
    find('[data-demo-persona-save-as]').hidden = personaSelect.value === 'default'
    closePersona(restoreFocus)
  }
  personaSelect.addEventListener('change', () => updatePersona())
  find('[data-demo-persona-edit]').addEventListener('click', () => {
    const persona = personas.get(personaSelect.value) || personas.get('default')
    personaName.value = persona.name
    personaPrompt.value = persona.prompt
    personaEditor.hidden = false
    personaName.focus({ preventScroll: true })
  })
  find('[data-demo-persona-apply]').addEventListener('click', () => {
    const option = personaSelect.querySelector('option[value="custom"]')
    option.hidden = false
    option.textContent = personaName.value.trim() || '本会话自定义'
    personas.set('custom', { name: option.textContent, prompt: personaPrompt.value })
    personaSelect.value = 'custom'
    updatePersona()
    notify('已保存助手设定。')
  })
  find('[data-demo-persona-save-as]').addEventListener('click', () => {
    if (savedPersonas >= 20) { notify('最多保存 20 套人设。'); return }
    const persona = personas.get(personaSelect.value) || personas.get('default')
    const option = document.createElement('option')
    option.value = 'saved-' + (++savedPersonas)
    option.textContent = persona.name
    personas.set(option.value, { ...persona })
    personaSelect.append(option)
    personaSelect.value = option.value
    updatePersona()
    notify('已另存演示人设。')
  })
  document.addEventListener('click', (event) => {
    if (recentTrigger && !recentPanel.contains(event.target) && !recentTrigger.contains(event.target)) closeRecent()
    if (!personaPanel.hidden && !personaPanel.contains(event.target) && !personaTrigger.contains(event.target)) closePersona()
  })
  demo.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && recentTrigger) { event.preventDefault(); closeRecent(true) }
    if (event.key === 'Escape' && !personaPanel.hidden) { event.preventDefault(); closePersona(true) }
  })
  renderScope()
}

function excerpt(text, limit) {
  const characters = Array.from(text)
  return characters.length > limit ? characters.slice(0, limit).join('') + '…' : text
}

function enablePassagePreview(demo, passages, bookTitle, chapter, onJump) {
  const panel = demo.querySelector('#demo-source-preview')
  if (!panel.showPopover) panel.removeAttribute('popover')
  const text = panel.querySelector('.demo-preview-text')
  panel.querySelector('strong').textContent = bookTitle
  panel.querySelector('[data-demo-preview-location]').textContent = chapter
  let trigger = null
  let restoringFocus = false
  let closeTimer

  function close(returnFocus = false) {
    window.clearTimeout(closeTimer)
    if (!trigger) return
    const previous = trigger
    trigger = null
    previous.setAttribute('aria-expanded', 'false')
    previous.removeAttribute('aria-controls')
    panel.hidePopover?.()
    panel.hidden = true
    demo.append(panel)
    if (returnFocus) {
      restoringFocus = true
      previous.focus({ preventScroll: true })
      restoringFocus = false
    }
  }

  function place() {
    if (!trigger || !panel.showPopover) return
    const rect = trigger.getBoundingClientRect()
    const bounds = trigger.closest('.demo-assistant-scroll').getBoundingClientRect()
    if (rect.height && (rect.bottom <= Math.max(0, bounds.top) || rect.top >= Math.min(window.innerHeight, bounds.bottom))) {
      close()
      return
    }
    const frame = (demo.dataset.demoFullscreen === 'true' ? trigger.closest('.demo-right-sidebar') : demo.closest('.product-viewport')).getBoundingClientRect()
    const left = Math.max(0, frame.left) + 8
    const right = Math.min(window.innerWidth, frame.right) - 8
    const above = rect.top - Math.max(0, frame.top) - 8
    const below = Math.min(window.innerHeight, frame.bottom) - rect.bottom - 8
    const useBelow = below >= 300 || below >= above
    panel.style.width = Math.min(420, right - left) + 'px'
    panel.style.maxHeight = Math.max(0, Math.min(360, (useBelow ? below : above) - 4)) + 'px'
    panel.style.left = Math.max(left, Math.min(rect.left, right - panel.offsetWidth)) + 'px'
    panel.style.top = useBelow ? rect.bottom + 4 + 'px' : 'auto'
    panel.style.bottom = useBelow ? 'auto' : window.innerHeight - rect.top + 4 + 'px'
  }

  function show(button, focusText = false) {
    window.clearTimeout(closeTimer)
    if (trigger !== button) {
      close()
      trigger = button
      text.textContent = passages.get(button.dataset.demoPreview).text
      button.setAttribute('aria-expanded', 'true')
      button.setAttribute('aria-controls', panel.id)
      // Keep Tab order beside the citation. Without the Popover API the excerpt opens inline.
      button.after(panel)
      panel.hidden = false
      panel.showPopover?.()
      place()
    }
    if (focusText && trigger) text.focus({ preventScroll: true })
  }

  function inside(target) {
    return target && (trigger?.contains(target) || panel.contains(target))
  }

  function scheduleClose(event) {
    if (!trigger || !inside(event.target) || inside(event.relatedTarget)) return
    window.clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => {
      if (event.type === 'pointerout' && inside(document.activeElement)) return
      close()
    }, 160)
  }

  function enter(event) {
    if (restoringFocus || (event.type === 'pointerover' && event.pointerType === 'touch')) return
    const button = event.target.closest('button[data-demo-preview]')
    if (button) show(button, event.type === 'click')
    else if (panel.contains(event.target)) window.clearTimeout(closeTimer)
  }

  demo.addEventListener('pointerover', enter)
  demo.addEventListener('focusin', enter)
  demo.addEventListener('click', enter)
  demo.addEventListener('pointerout', scheduleClose)
  demo.addEventListener('focusout', scheduleClose)
  document.addEventListener('pointerdown', (event) => {
    if (trigger && !inside(event.target)) close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !trigger) return
    event.preventDefault()
    close(inside(document.activeElement))
  })
  panel.querySelector('[data-demo-close-preview]').addEventListener('click', () => close(true))
  panel.querySelector('[data-demo-jump]').addEventListener('click', () => {
    const id = trigger.dataset.demoPreview
    close()
    onJump(id)
  })
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  return close
}
