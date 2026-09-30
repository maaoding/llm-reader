import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function isSelectPickerOpen(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('select')?.matches(':open'))
}

export function useDialogFocus(open: boolean, onClose: () => void, dialogRef: RefObject<HTMLElement | null>, returnRef: RefObject<HTMLElement | null>): void {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : returnRef.current
    const returnTarget = returnRef.current ?? previous
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      // 先交由展开的选择菜单处理 Escape / Tab，避免同时关闭外层弹窗。
      if (isSelectPickerOpen(event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement
      if (!dialogRef.current.contains(activeElement)) {
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
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnTarget?.focus()
    }
  }, [dialogRef, open, returnRef])
}
