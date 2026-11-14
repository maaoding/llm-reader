import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function isSelectPickerOpen(target: EventTarget | null): boolean {
  const element = target as Element | null
  return typeof element?.closest === 'function' && Boolean(element.closest('select')?.matches(':open'))
}

export function useDialogFocus(
  open: boolean, onClose: () => void, dialogRef: RefObject<HTMLElement | null>, returnRef: RefObject<HTMLElement | null>,
  fallbackRef?: RefObject<HTMLElement | null>
): void {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    const ownerDocument = dialog?.ownerDocument
    const view = ownerDocument?.defaultView
    if (!open || !dialog || !ownerDocument || !view) return undefined
    const active = ownerDocument.activeElement
    const previous = active && 'focus' in active ? active as HTMLElement : null
    const returnTarget = returnRef.current ?? previous
    const fallbackTarget = fallbackRef?.current
    dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      // 先交由展开的选择菜单处理 Escape / Tab，避免同时关闭外层弹窗。
      if (isSelectPickerOpen(event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = ownerDocument.activeElement
      if (!dialog.contains(activeElement)) {
        event.preventDefault()
        const boundaryTarget = event.shiftKey ? last : first
        boundaryTarget.focus()
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    view.addEventListener('keydown', onKeyDown)
    return () => {
      view.removeEventListener('keydown', onKeyDown)
      if (returnTarget?.isConnected && !returnTarget.closest('[hidden], [inert]')) returnTarget.focus()
      else fallbackTarget?.focus()
    }
  }, [dialogRef, open, returnRef, fallbackRef])
}
