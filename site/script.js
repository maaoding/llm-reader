/* global document, window */

const demo = document.querySelector('[data-reader-demo]')

if (demo) {
  const explainButton = demo.querySelector('[data-demo-explain]')
  const answer = demo.querySelector('[data-demo-answer]')
  const emptyState = demo.querySelector('[data-demo-empty]')
  const selection = demo.querySelector('[data-demo-selection]')
  const returnButtons = demo.querySelectorAll('[data-demo-return]')
  const status = demo.querySelector('[data-demo-status]')
  const composer = demo.querySelector('#demo-followup')
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
    composer.disabled = false
    composer.placeholder = '继续追问这段原文…'
  })

  for (const button of returnButtons) {
    button.addEventListener('click', () => {
      demo.dataset.demoState = 'answered'
      status.textContent = ''
      window.requestAnimationFrame(() => {
        if (reduceMotion.matches) {
          status.textContent = '已返回并强调对应原文。'
          return
        }
        demo.dataset.demoState = 'citation'
        selection.focus({ preventScroll: true })
        status.textContent = '已返回并强调对应原文。'
      })
    })
  }

  selection.addEventListener('animationend', () => {
    if (demo.dataset.demoState === 'citation') demo.dataset.demoState = 'answered'
  })
}
