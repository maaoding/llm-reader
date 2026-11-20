import { useCallback, useEffect, useState } from 'react'

type GuideStep = 'reading' | 'answer'
type GuideState = Record<GuideStep, boolean>
const STORAGE_KEY = 'llm-reader.reading-guide.v1'

function readGuide(): GuideState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (value && typeof value === 'object' && 'reading' in value && 'answer' in value &&
      typeof value.reading === 'boolean' && typeof value.answer === 'boolean') return value as GuideState
  } catch { /* Keep guidance available when local storage is unavailable. */ }
  return null
}

function persist(state: GuideState): GuideState {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* Keep the session choice. */ }
  return state
}

export function useReadingGuide(ready: boolean, existingReader: boolean) {
  const [state, setState] = useState(readGuide)
  if (ready && state === null) setState({ reading: existingReader, answer: existingReader })
  useEffect(() => {
    if (state) persist(state)
  }, [state])
  const dismiss = useCallback((step: GuideStep) => {
    setState((current) => ({ ...(current ?? { reading: false, answer: false }), [step]: true }))
  }, [])
  const replay = useCallback(() => setState({ reading: false, answer: false }), [])
  return { showReading: state?.reading === false, showAnswer: state?.answer === false, dismiss, replay }
}
