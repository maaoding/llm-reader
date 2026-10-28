import { useLayoutEffect, type RefObject } from 'react'
import type { ReaderSource } from '@shared/contracts'
import type { InterfaceScale } from './SettingsModal'

interface SelectionAnchorRect {
  top: number
  bottom: number
  centerX: number
}

function rectFromNativeSelection(selection: Selection | null): DOMRect | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

/**
 * 找到当前活跃选区的视口矩形:TXT 在主文档,EPUB 在同源 iframe 内,
 * PDF 区域框选则是确认后的 .pdf-region-overlay.is-selection 元素。
 */
function findSelectionAnchorRect(host: HTMLElement | null): SelectionAnchorRect | null {
  const own = rectFromNativeSelection(window.getSelection())
  if (own) return { top: own.top, bottom: own.bottom, centerX: own.left + own.width / 2 }
  if (!host) return null
  for (const frame of Array.from(host.querySelectorAll('iframe'))) {
    try {
      const rect = rectFromNativeSelection(frame.contentWindow?.getSelection() ?? null)
      if (!rect) continue
      const frameRect = frame.getBoundingClientRect()
      return {
        top: frameRect.top + rect.top,
        bottom: frameRect.top + rect.bottom,
        centerX: frameRect.left + rect.left + rect.width / 2
      }
    } catch {
      continue
    }
  }
  const region = host.querySelector('.pdf-region-overlay.is-selection')
  if (region) {
    const rect = region.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, centerX: rect.left + rect.width / 2 }
  }
  return null
}

export function useSelectionToolbar({ hostRef, surfaceRef, toolbarRef, selection, ready, interfaceScale }: {
  hostRef: RefObject<HTMLDivElement | null>
  surfaceRef: RefObject<HTMLElement | null>
  toolbarRef: RefObject<HTMLDivElement | null>
  selection: ReaderSource | null
  ready: boolean
  interfaceScale: InterfaceScale
}): void {
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const surface = surfaceRef.current
    if (!toolbar || !surface || !selection || !ready) return

    const position = (): void => {
      const anchor = findSelectionAnchorRect(hostRef.current)
      const surfaceRect = surface.getBoundingClientRect()
      const toolbarWidth = toolbar.offsetWidth
      const toolbarHeight = toolbar.offsetHeight
      let left: number
      let top: number
      if (anchor) {
        const anchorTop = anchor.top - surfaceRect.top
        const anchorBottom = anchor.bottom - surfaceRect.top
        const anchorCenterX = anchor.centerX - surfaceRect.left
        top = anchorTop - toolbarHeight - 10
        if (top < 4) top = anchorBottom + 10
        left = anchorCenterX - toolbarWidth / 2
      } else {
        left = (surfaceRect.width - toolbarWidth) / 2
        top = surfaceRect.height - toolbarHeight - 24
      }
      left = Math.max(8, Math.min(left, surfaceRect.width - toolbarWidth - 8))
      top = Math.max(4, Math.min(top, surfaceRect.height - toolbarHeight - 4))
      toolbar.style.left = `${Math.round(left)}px`
      toolbar.style.top = `${Math.round(top)}px`
    }

    position()
    let frame = 0
    const schedulePosition = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        position()
      })
    }
    window.addEventListener('scroll', schedulePosition, true)
    window.addEventListener('resize', schedulePosition)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedulePosition, true)
      window.removeEventListener('resize', schedulePosition)
    }
  }, [selection, ready, interfaceScale, hostRef, surfaceRef, toolbarRef])

}
