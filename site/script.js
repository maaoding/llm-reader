/* global document, window */

const demo = document.querySelector('[data-reader-demo]')

if (demo) {
  const explainButton = demo.querySelector('[data-demo-explain]')
  const explainLabel = demo.querySelector('[data-demo-explain-label]')
  const answer = demo.querySelector('[data-demo-answer]')
  const emptyState = demo.querySelector('[data-demo-empty]')
  const selection = demo.querySelector('[data-demo-selection]')
  const citationAction = demo.querySelector('[data-citation-action]')
  const citationButton = demo.querySelector('[data-demo-citation]')
  const status = demo.querySelector('[data-demo-status]')
  const passiveControls = demo.querySelectorAll('[data-demo-passive]')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  for (const control of passiveControls) {
    control.addEventListener('click', (event) => event.preventDefault())
  }

  explainButton.addEventListener('click', () => {
    demo.dataset.demoState = 'answered'
    emptyState.hidden = true
    answer.hidden = false
    explainButton.setAttribute('aria-pressed', 'true')
    explainLabel.textContent = '已解释'
    citationAction.textContent = '返回原文'
  })

  citationButton.addEventListener('click', () => {
    demo.dataset.demoState = 'answered'
    window.requestAnimationFrame(() => {
      demo.dataset.demoState = 'citation'
      selection.focus({ preventScroll: true })
      selection.scrollIntoView({
        behavior: reduceMotion.matches ? 'auto' : 'smooth',
        block: 'center',
        inline: 'center'
      })
      citationAction.textContent = '已返回原文'
      status.textContent = '已返回并强调对应原文。'
    })
  })

  selection.addEventListener('animationend', () => {
    if (demo.dataset.demoState === 'citation') demo.dataset.demoState = 'answered'
  })
}
