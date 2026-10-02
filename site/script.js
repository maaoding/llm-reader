/* global document, window */

const demo = document.querySelector('[data-reader-demo]')

if (demo) {
  const find = (selector) => demo.querySelector(selector)
  const answer = find('[data-demo-answer]')
  const empty = find('[data-demo-empty]')
  const source = find('[data-demo-source]')
  const selection = find('[data-demo-selection]')
  const reader = find('.demo-reader-surface')
  const scroll = find('.demo-assistant-scroll')
  const viewport = demo.closest('.product-viewport')
  const composer = find('#demo-followup')
  const send = find('[data-demo-send]')
  const contextHint = find('[data-demo-context-hint]')
  const composerScope = find('#demo-composer-scope')
  const conversationSearch = find('[data-demo-search]')
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
  const question = find('[data-demo-question]')
  const questionLabel = find('[data-demo-question-label]')
  const questionPrompt = find('[data-demo-prompt]')
  const save = find('[data-demo-save]')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let scope = 'book'
  let scenario = 'selection'
  let hasSelection = true
  let hasAnswer = false
  let lastAction = 'explain'
  let lastQuestion = ''
  let toastTimer
  let citationTimer
  let savedPersonas = 0
  let maximized = false
  let sizeBeforeMaximize = 'compact'
  const personas = new Map([
    ['default', { name: '本会话自定义', prompt: '' }],
    ['evidence', { name: '证据与边界', prompt: '先核对原文，再解释概念；区分作者的明确表述与推断，说明结论的前提和边界。' }]
  ])

  function setWindowSize(size) {
    demo.dataset.demoSize = size
    demo.closest('.product-stage').dataset.demoSize = size
    for (const button of document.querySelectorAll('button[data-demo-size]')) button.setAttribute('aria-pressed', String(button.dataset.demoSize === size))
    resizeInput()
    closePersona()
  }

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
    find('[data-demo-clear]').hidden = (!hasAnswer && !composer.value) || !clearConfirm.hidden
  }

  function closePersona(restoreFocus = false) {
    personaPanel.hidden = true
    personaTrigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) personaTrigger.focus({ preventScroll: true })
  }

  function setView(view) {
    closePersona()
    demo.dataset.demoView = view
    for (const button of demo.querySelectorAll('button[data-demo-view]')) {
      const active = button.dataset.demoView === view
      button.classList.toggle('is-active', active)
      if (button.closest('.demo-bookbar')) {
        if (active) button.setAttribute('aria-current', 'page')
        else button.removeAttribute('aria-current')
      }
    }
    viewport.scrollLeft = 0
    resizeInput()
  }

  function renderScope() {
    demo.dataset.demoScope = scope
    composerScope.value = scope
    find('[data-demo-scope-status]').textContent = scope === 'book' ? '原文已就绪' : hasSelection ? '已选中原文' : '尚未选中原文'
    source.hidden = scope === 'book' || !hasSelection
    empty.hidden = hasAnswer || (scope === 'selection' && hasSelection)
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
    for (const button of document.querySelectorAll('[data-demo-scenario]')) {
      button.setAttribute('aria-pressed', String(button.dataset.demoScenario === scenario))
    }
    composer.placeholder = scope === 'book' ? '询问本书的观点、概念或章节联系…'
      : !hasSelection ? '写下问题，发送前先选中原文…'
        : hasAnswer ? '继续追问这段原文…' : '针对这段原文提问…'
    resizeInput()
  }

  function setScenario(nextScope) {
    scenario = nextScope
    scope = 'book'
    hasSelection = scenario === 'selection'
    hasAnswer = false
    demo.dataset.demoState = hasSelection ? 'selected' : 'reading'
    answer.hidden = true
    contextHint.hidden = true
    questionPrompt.open = false
    find('.demo-answer-sources').open = false
    conversationSearch.value = ''
    clearConfirm.hidden = true
    renderSearch()
    composer.value = ''
    save.disabled = false
    save.querySelector('span').textContent = '归档回答'
    closePersona()
    renderScope()
    scroll.scrollTop = 0
    if (window.innerWidth <= 1088) viewport.scrollLeft = scenario === 'book' ? viewport.scrollWidth : 0
  }

  function showAnswer(action, value = '') {
    if (action !== 'ask') scope = 'selection'
    if (scope === 'selection' && !hasSelection) return
    closePersona()
    lastAction = action
    lastQuestion = value
    hasAnswer = true
    demo.dataset.demoState = 'answered'
    answer.hidden = false
    questionLabel.textContent = action === 'explain' ? '解释这段' : action === 'context' ? '联系上下文' : '自由提问'
    questionPrompt.hidden = action === 'ask'
    question.hidden = action !== 'ask'
    question.textContent = value
    questionPrompt.querySelector('p').textContent = action === 'context'
      ? '请结合选区及附近原文，说明这段话在上下文中的作用，理清论证关系和成立条件。'
      : '请解释我选中的原文，帮助我读懂它，而不只是换一种说法。以原文为依据，理清关键概念、前提与适用边界，区分明确表述与推断。'
    const paragraphs = find('[data-demo-answer-text]').querySelectorAll('p')
    paragraphs[0].textContent = scope === 'book'
      ? '这本书将理解概念分为三个层面：定义说明它是什么，成立条件说明结论依赖什么前提，适用边界说明它在哪些情境中有效。'
      : action === 'context'
        ? '前文先介绍“定义”，后文继续讨论“适用边界”。这段话在两者之间补上成立条件，提醒读者不能仅凭定义就接受一个结论。'
        : '这段话区分了“定义”和“成立条件”：知道概念是什么，还要检查结论依赖的前提是否仍然成立。'
    paragraphs[2].textContent = personaSelect.value === 'evidence' || personaSelect.value === 'custom' || personaSelect.value.startsWith('saved-')
      ? '原文明确指出，关键前提变化时，结论“可能失效”。这里强调的是重新检查适用条件，并不意味着结论一定错误。'
      : '比如，一项结论依赖“其他条件不变”。一旦这个前提改变，就需要重新判断。这是辅助理解的假设例子。'
    find('[data-demo-web-sources]').hidden = web.getAttribute('aria-pressed') !== 'true'
    contextHint.hidden = false
    save.disabled = false
    save.querySelector('span').textContent = '归档回答'
    composer.value = ''
    renderScope()
    window.requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight
      if (window.innerWidth <= 1088) viewport.scrollLeft = viewport.scrollWidth
    })
    status.textContent = '已显示预设示例回答，可查看参考原文和返回引用。'
    renderSearch()
  }

  for (const button of demo.querySelectorAll('[data-demo-passive]')) {
    button.title = '此入口请在桌面应用中使用'
    button.addEventListener('click', (event) => event.preventDefault())
  }
  for (const button of document.querySelectorAll('[data-demo-scenario]')) {
    button.addEventListener('click', () => { setView('reading'); setScenario(button.dataset.demoScenario) })
  }
  for (const button of demo.querySelectorAll('button[data-demo-scope]')) {
    button.addEventListener('click', () => {
      if (scope === button.dataset.demoScope) return
      setScenario(button.dataset.demoScope)
      scope = button.dataset.demoScope
      renderScope()
    })
  }
  for (const button of demo.querySelectorAll('button[data-demo-view]')) {
    button.addEventListener('click', () => setView(button.dataset.demoView))
  }
  find('[data-demo-explain]').addEventListener('click', () => showAnswer('explain'))
  find('[data-demo-context]').addEventListener('click', () => showAnswer('context'))
  find('[data-demo-ask]').addEventListener('click', () => {
    scope = 'selection'
    demo.dataset.demoState = 'reading'
    renderScope()
    composer.focus()
    if (window.innerWidth <= 1088) viewport.scrollLeft = viewport.scrollWidth
  })
  find('[data-demo-clear-selection]').addEventListener('click', () => {
    demo.dataset.demoState = hasAnswer ? 'answered' : 'reading'
    if (!hasAnswer) hasSelection = false
    renderScope()
  })
  find('[data-demo-excerpt]').addEventListener('click', (event) => {
    event.currentTarget.querySelector('span').textContent = '已保存摘录'
    notify('已保存演示摘录。')
  })
  function selectPassage() {
    scenario = 'selection'
    hasSelection = true
    demo.dataset.demoState = 'selected'
    renderScope()
  }
  selection.addEventListener('click', selectPassage)
  selection.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPassage() }
  })
  for (const button of demo.querySelectorAll('[data-demo-return]')) {
    button.addEventListener('click', () => {
      window.clearTimeout(citationTimer)
      setView('reading')
      const target = button.dataset.demoReturn === 'boundaries' ? find('[data-demo-boundaries]')
        : button.dataset.demoReturn === 'question' ? find('[data-demo-source-question]') : selection
      demo.dataset.demoState = hasAnswer ? 'answered' : 'reading'
      reader.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 70), behavior: reduceMotion.matches ? 'instant' : 'smooth' })
      viewport.scrollLeft = 0
      if (target !== selection) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
      for (const previous of reader.querySelectorAll('.is-citation-return')) previous.classList.remove('is-citation-return')
      window.requestAnimationFrame(() => {
        target.classList.add('is-citation-return')
        demo.dataset.demoState = 'citation'
      })
      citationTimer = window.setTimeout(() => {
        target.classList.remove('is-citation-return')
        demo.dataset.demoState = hasAnswer ? 'answered' : 'reading'
      }, 1000)
      status.textContent = '已返回并强调对应原文。'
    })
  }
  reader.addEventListener('scroll', () => {
    const maximum = reader.scrollHeight - reader.clientHeight
    const percent = maximum > 0 ? Math.round(reader.scrollTop / maximum * 100) : 0
    find('[data-demo-progress-label]').textContent = percent + '%'
    find('.demo-title-progress').setAttribute('aria-valuenow', String(percent))
    find('.demo-title-progress i').style.width = percent + '%'
  })
  composer.addEventListener('input', resizeInput)
  composerScope.addEventListener('change', () => {
    const nextScope = composerScope.value
    setScenario(nextScope)
    scope = nextScope
    renderScope()
  })
  function renderSearch() {
    const needle = conversationSearch.value.trim().toLocaleLowerCase()
    const matches = hasAnswer && answer.textContent.toLocaleLowerCase().includes(needle)
    answer.classList.toggle('is-search-hidden', Boolean(needle) && !matches)
    searchCount.hidden = !needle
    searchCount.textContent = (matches ? 1 : 0) + ' 轮匹配'
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
    const previousScope = scope
    setScenario(scenario)
    scope = previousScope
    renderScope()
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
  find('[data-demo-regenerate]').addEventListener('click', () => showAnswer(lastAction, lastQuestion))
  find('[data-demo-edit-question]').addEventListener('click', () => {
    composer.value = lastQuestion || (lastAction === 'context' ? '请联系上下文解释这段原文。' : '请解释这段原文。')
    resizeInput()
    composer.focus()
  })
  save.addEventListener('click', () => {
    save.disabled = true
    save.querySelector('span').textContent = '已归档'
    notify('已归档演示回答。')
  })
  web.addEventListener('click', () => {
    const automatic = web.getAttribute('aria-pressed') !== 'true'
    const label = automatic ? '联网：自动' : '联网：关闭'
    web.setAttribute('aria-pressed', String(automatic))
    web.setAttribute('aria-label', label)
    find('#demo-web-tooltip strong').textContent = label
    web.querySelector('use').setAttribute('href', automatic ? '#di-globe' : '#di-globe-off')
  })
  personaTrigger.addEventListener('click', () => {
    if (viewport.scrollWidth > viewport.clientWidth) viewport.scrollLeft = demo.dataset.demoView === 'reading' ? viewport.scrollWidth : 0
    const open = personaPanel.hidden
    personaPanel.hidden = !open
    personaEditor.hidden = true
    personaTrigger.setAttribute('aria-expanded', String(open))
    find('[data-demo-persona-save-as]').hidden = personaSelect.value === 'default'
    if (open) personaSelect.focus({ preventScroll: true })
  })
  function updatePersona() {
    const name = personaSelect.value === 'default' ? '默认' : personaSelect.selectedOptions[0].textContent
    personaTrigger.setAttribute('aria-label', '助手：' + name)
    find('#demo-persona-tooltip').textContent = '助手：' + name
    find('[data-demo-persona-save-as]').hidden = personaSelect.value === 'default'
    closePersona(true)
  }
  personaSelect.addEventListener('change', updatePersona)
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
    if (!personaPanel.hidden && !personaPanel.contains(event.target) && !personaTrigger.contains(event.target)) closePersona()
  })
  demo.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !personaPanel.hidden) { event.preventDefault(); closePersona(true) }
  })
  for (const button of document.querySelectorAll('button[data-demo-size]')) {
    button.addEventListener('click', () => {
      maximized = false
      find('[data-demo-window-toggle] use').setAttribute('href', '#di-square')
      find('[data-demo-window-toggle]').setAttribute('aria-label', '最大化')
      find('[data-demo-window-toggle]').title = '最大化'
      setWindowSize(button.dataset.demoSize)
    })
  }
  find('[data-demo-window-toggle]').addEventListener('click', (event) => {
    if (!maximized) sizeBeforeMaximize = demo.dataset.demoSize
    maximized = !maximized
    const label = maximized ? '还原' : '最大化'
    event.currentTarget.setAttribute('aria-label', label)
    event.currentTarget.title = label
    event.currentTarget.querySelector('use').setAttribute('href', maximized ? '#di-restore' : '#di-square')
    setWindowSize(maximized ? 'wide' : sizeBeforeMaximize)
  })
  document.querySelector('[data-demo-reset]').addEventListener('click', () => {
    window.clearTimeout(citationTimer)
    window.clearTimeout(toastTimer)
    toast.hidden = true
    setView('reading')
    setScenario('selection')
    web.setAttribute('aria-pressed', 'true')
    web.click()
    personaSelect.value = 'default'
    updatePersona()
    find('[data-demo-excerpt] span').textContent = '摘录这段'
    reader.scrollTop = 0
    viewport.scrollLeft = 0
    status.textContent = '演示已重置。'
  })
  renderScope()
}
