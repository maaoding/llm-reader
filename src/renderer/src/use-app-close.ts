import { useCallback, useEffect, useState, type RefObject } from 'react'

interface CloseOptions {
  closingRef: RefObject<boolean>
  isBusy: () => boolean
  prepareClose: () => Promise<void>
  flushSessions: () => Promise<boolean>
  closeWorkbenches: () => Promise<boolean>
  resumeWorkbenches: () => void
  retryWorkbenchSaves: () => Promise<void>
  retryTabRestoration: () => void
}

/** Coordinates the close handshake without owning conversation or reader state. */
export function useAppClose({
  closingRef, isBusy, prepareClose, flushSessions, closeWorkbenches,
  resumeWorkbenches, retryWorkbenchSaves, retryTabRestoration
}: CloseOptions) {
  const [closing, setClosing] = useState(false)
  const [closeSaveFailed, setCloseSaveFailed] = useState(false)
  const [retryingSaves, setRetryingSaves] = useState(false)

  const resume = useCallback(() => {
    closingRef.current = false
    resumeWorkbenches()
    setClosing(false)
    retryTabRestoration()
  }, [closingRef, resumeWorkbenches, retryTabRestoration])

  useEffect(() => {
    if (!window.readerApi) return undefined
    return window.readerApi.onBeforeClose(async () => {
      if (closingRef.current) return false
      if (isBusy()) {
        setCloseSaveFailed(true)
        return false
      }
      closingRef.current = true
      setClosing(true)
      let saved = false
      try {
        await prepareClose()
        const [sessions, workbenches] = await Promise.allSettled([flushSessions(), closeWorkbenches()])
        saved = sessions.status === 'fulfilled' && sessions.value && workbenches.status === 'fulfilled' && workbenches.value
        return saved
      } finally {
        if (!saved) {
          resume()
          setCloseSaveFailed(true)
        }
      }
    })
  }, [closingRef, isBusy, prepareClose, flushSessions, closeWorkbenches, resume])

  useEffect(() => window.readerApi.onCloseCancelled(resume), [resume])

  const retrySessionSaves = async (): Promise<void> => {
    if (retryingSaves || closingRef.current || isBusy()) return
    setRetryingSaves(true)
    try {
      const [sessions, workbenches] = await Promise.allSettled([flushSessions(), retryWorkbenchSaves()])
      if (sessions.status === 'fulfilled' && sessions.value && workbenches.status === 'fulfilled') setCloseSaveFailed(false)
    } finally { setRetryingSaves(false) }
  }

  return { closing, closeSaveFailed, retryingSaves, retrySessionSaves }
}
