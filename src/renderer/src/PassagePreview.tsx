import { useCallback, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { ContextSnapshot, Passage } from '@shared/contracts'
import { copy } from '@shared/copy'
import { evidencePages, passageChapter, passagePage } from './passage-locations'

export type NavigatePassage = (anchor: string, bookId?: string, chapterTitle?: string) => void

interface PassagePreviewProps {
  passage: Passage
  context: Pick<ContextSnapshot, 'scope' | 'bookId' | 'books' | 'selection'>
  bookTitle?: string
  availableBookIds?: string[]
  onNavigate?: NavigatePassage
  className?: string
  testId: string
  children: ReactNode
}

export function PassagePreview({
  passage, context, bookTitle, availableBookIds, onNavigate, className, testId, children
}: PassagePreviewProps): ReactNode {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const restoreFocus = useRef(false)
  const focusOnOpen = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const panelId = useId()

  const cancelClose = useCallback((): void => {
    clearTimeout(closeTimer.current)
  }, [])
  const show = (): void => {
    cancelClose()
    if (!restoreFocus.current) setOpen(true)
  }
  const close = useCallback((returnFocus: boolean): void => {
    cancelClose()
    focusOnOpen.current = false
    setOpen(false)
    if (returnFocus) {
      restoreFocus.current = true
      triggerRef.current?.focus({ preventScroll: true })
      restoreFocus.current = false
    }
  }, [cancelClose])
  const scheduleClose = (keepFocus: boolean): void => {
    if (!open) return
    cancelClose()
    closeTimer.current = setTimeout(() => {
      const active = triggerRef.current?.ownerDocument.activeElement
      if (keepFocus && (active === triggerRef.current || panelRef.current?.contains(active ?? null))) return
      close(false)
    }, 160)
  }
  const onBlur = (event: FocusEvent<HTMLElement>): void => {
    if (event.relatedTarget !== triggerRef.current && !panelRef.current?.contains(event.relatedTarget)) scheduleClose(false)
  }

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    const view = trigger?.ownerDocument.defaultView
    if (!open || !trigger || !panel || !view) return

    // The top layer avoids clipping inside the conversation scroll area, including in the assistant window.
    panel.showPopover?.({ source: trigger })
    const place = (): void => {
      const edge = 12
      const rect = trigger.getBoundingClientRect()
      const above = rect.top - edge
      const below = view.innerHeight - rect.bottom - edge
      const placeBelow = below >= 360 || below >= above
      panel.style.left = `${Math.max(edge, Math.min(rect.left, view.innerWidth - panel.offsetWidth - edge))}px`
      panel.style.top = placeBelow ? `${rect.bottom + 4}px` : ''
      panel.style.bottom = placeBelow ? '' : `${view.innerHeight - rect.top + 4}px`
      panel.style.maxHeight = `${Math.max(0, Math.min(360, (placeBelow ? below : above) - 4))}px`
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || (typeof panel.showPopover === 'function' && !panel.matches(':popover-open'))) return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    place()
    if (focusOnOpen.current) {
      focusOnOpen.current = false
      textRef.current?.focus({ preventScroll: true })
    }
    view.addEventListener('resize', place)
    view.addEventListener('scroll', place, true)
    view.addEventListener('keydown', escape, true)
    return () => {
      cancelClose()
      view.removeEventListener('resize', place)
      view.removeEventListener('scroll', place, true)
      view.removeEventListener('keydown', escape, true)
    }
  }, [open, close, cancelClose])

  const bookId = passage.bookId || (context.scope === 'books' ? undefined : context.bookId)
  const title = passage.bookTitle || context.books?.find((book) => book.id === bookId)?.title || bookTitle
  const deleted = Boolean(bookId && availableBookIds && !availableBookIds.includes(bookId))
  const canNavigate = Boolean(onNavigate && !deleted && (context.scope !== 'books' || bookId))
  const chapterTitle = open ? passageChapter(passage, bookId, context.selection) : undefined
  const jump = (anchor: string): void => {
    close(true)
    onNavigate?.(anchor, bookId, chapterTitle)
  }

  return <>
    <button ref={triggerRef} type="button" className={className} data-testid={testId}
      aria-haspopup="dialog" aria-controls={open ? panelId : undefined} aria-expanded={open}
      popoverTarget={open ? panelId : undefined} popoverTargetAction="show"
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') show() }}
      onPointerLeave={() => scheduleClose(true)} onFocus={show} onBlur={onBlur}
      onClick={() => {
        show()
        if (textRef.current) textRef.current.focus({ preventScroll: true })
        else focusOnOpen.current = true
      }}>{children}{deleted && ` · ${copy('workbench.deletedBook')}`}</button>
    {open && <span ref={panelRef} id={panelId} popover="auto" className="source-preview"
      role="dialog" aria-label={copy('sources.preview')} data-testid="source-preview"
      onPointerEnter={cancelClose} onPointerLeave={() => scheduleClose(true)} onBlur={onBlur}
      onToggle={(event) => { if (event.newState === 'closed') close(false) }}>
      <span className="source-preview-header">
        <strong>{title || copy('sources.preview')}</strong>
        <button type="button" className="icon-button" aria-label={copy('window.closeAria')} onClick={() => close(true)}><X size={16} aria-hidden="true" /></button>
      </span>
      <PreviewBody passage={passage} chapterTitle={chapterTitle} textRef={textRef} canNavigate={canNavigate} deleted={deleted} onJump={jump} />
    </span>}
  </>
}

function PreviewBody({ passage, chapterTitle, textRef, canNavigate, deleted, onJump }: {
  passage: Passage
  chapterTitle?: string
  textRef: RefObject<HTMLSpanElement | null>
  canNavigate: boolean
  deleted: boolean
  onJump: (anchor: string) => void
}): ReactNode {
  const pages = evidencePages(passage)
  const anchorPage = passagePage(passage.anchor)
  const heading = passage.headingPath?.length ? passage.headingPath.join(' / ') : chapterTitle
  const hasAnchor = Boolean(passage.anchor.trim())
  const canJump = canNavigate && hasAnchor
  const canJumpToPage = canNavigate && pages.some(({ anchor }) => anchor.trim())
  return <>
    {(heading || anchorPage || pages.length > 0) && <span className="source-preview-location">
      {heading && <span>{heading}</span>}
      {pages.length > 0
        ? <span>{pages.map(({ page }) => copy('knowledge.pdfPage', { page })).join(' · ')}</span>
        : anchorPage && <span>{copy('knowledge.pdfPage', { page: anchorPage })}</span>}
    </span>}
    <span className="source-preview-text" ref={textRef} tabIndex={0} role="region"
      aria-label={copy('assistant.citationSourceFallback')} data-testid="source-preview-text">{passage.text}</span>
    {passage.sources?.some((source) => source.precision === 'table') && <small>{copy('sources.wholeTable')}</small>}
    {canJump || canJumpToPage ? <span className="source-preview-actions">
      {canJump && <button type="button" className="secondary-button" data-testid="source-preview-jump"
        onClick={() => onJump(passage.anchor)}>{copy('sources.jump')}</button>}
      {canJumpToPage && pages.map(({ anchor, page }) => anchor.trim() && (
        <button key={page} type="button" className="secondary-button" onClick={() => onJump(anchor)}>{copy('knowledge.pdfPage', { page })}</button>
      ))}
    </span> : <small>{copy(deleted ? 'workbench.missingSource' : 'sources.locationUnavailable')}</small>}
  </>
}
