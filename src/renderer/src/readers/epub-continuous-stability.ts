interface ContinuousView {
  displayed: boolean
  element?: HTMLElement
  iframe?: HTMLIFrameElement
  display(request: unknown): Promise<unknown>
  show(): void
  hide(): void
}

interface ContinuousManager {
  name?: string
  settings: {
    afterScrolledTimeout?: number
    direction?: string
    fullsize?: boolean
    offset?: number
    rtlScrollType?: string
  }
  container?: HTMLElement
  request: unknown
  q: {
    enqueue<T>(task: () => T | Promise<T>): Promise<T>
    dequeue?(): Promise<unknown>
  }
  views: {
    all(): ContinuousView[]
  }
  snapper?: {
    supportsTouch?: boolean
    needsSnap(): boolean
  }
  scrollTop: number
  scrollLeft: number
  prevScrollTop?: number
  prevScrollLeft?: number
  scrollDeltaVert?: number
  scrollDeltaHorz?: number
  scrolledRequestId?: number
  trimTimeout?: ReturnType<typeof setTimeout>
  scrollTimeout?: ReturnType<typeof setTimeout>
  afterScrolled?: ReturnType<typeof setTimeout>
  addScrollListeners(): void
  scrolled(): void
  check(offsetLeft?: number, offsetTop?: number): Promise<unknown>
  destroy(): void
  emit(event: string, payload: { top: number; left: number }): void
  isVisible(
    view: ContinuousView,
    offsetTop: number,
    offsetBottom: number,
    container: DOMRect
  ): boolean
  bounds(): DOMRect
  trim(): unknown
  update(offset?: number): Promise<unknown>
}

interface RenditionWithManager {
  manager?: ContinuousManager
}

const stabilizedManagers = new WeakSet<object>()

function getScrollPosition(manager: ContinuousManager): { top: number; left: number } {
  if (!manager.settings.fullsize && manager.container) {
    return {
      top: manager.container.scrollTop,
      left: manager.container.scrollLeft
    }
  }

  const direction =
    manager.settings.direction === 'rtl' && manager.settings.rtlScrollType === 'default' ? -1 : 1
  return {
    top: window.scrollY * direction,
    left: window.scrollX * direction
  }
}

function syncScrollPosition(manager: ContinuousManager): { top: number; left: number } {
  const position = getScrollPosition(manager)
  manager.scrollTop = position.top
  manager.scrollLeft = position.left
  return position
}

/**
 * Backports the continuous-manager stability fixes that landed upstream after epub.js 0.3.93.
 * The patch remains adapter-local so TXT and the app's navigation/progress contracts are untouched.
 */
export function stabilizeContinuousManager(rendition: unknown): boolean {
  const manager = (rendition as RenditionWithManager | null)?.manager
  if (
    !manager ||
    manager.name !== 'continuous' ||
    stabilizedManagers.has(manager) ||
    typeof manager.check !== 'function' ||
    typeof manager.update !== 'function'
  ) {
    return false
  }
  stabilizedManagers.add(manager)

  // epub.js 的 Queue.run() 只用 .then 继续队列，没有拒绝分支：只要队列里任何一个任务
  // reject（例如某章资源加载失败），run() 就不再被调用，而 running 永远留在 true，
  // 后续 append/display 全部不再执行——表现为滚动卡在章节边界且不会自愈。
  // 这里让 dequeue 永不拒绝，单个任务失败后队列继续运行。
  const queue = manager.q
  const originalDequeue = queue.dequeue
  if (typeof originalDequeue === 'function') {
    const originalEnqueue = queue.enqueue.bind(queue) as (task: unknown) => Promise<unknown>
    const dequeue = originalDequeue.bind(queue)
    // 同步抛错会绕过 epub.js 的 deferred（调用方永久等待，当前队列步也会中止），
    // 先把函数任务的同步抛错转成拒绝；调用方仍能拿到失败，队列也能继续。
    queue.enqueue = ((value: unknown) => originalEnqueue(
      typeof value === 'function'
        ? () => {
          try {
            return (value as () => unknown)()
          } catch (error) {
            return Promise.reject(error)
          }
        }
        : value
    )) as typeof queue.enqueue
    queue.dequeue = (): Promise<unknown> => {
      try {
        return dequeue().catch(() => undefined)
      } catch {
        return Promise.resolve(undefined)
      }
    }
  }

  const scheduleTrim = (delay = 250): void => {
    clearTimeout(manager.trimTimeout)
    manager.trimTimeout = setTimeout(() => {
      if ((manager.scrollDeltaVert ?? 0) > 2 || (manager.scrollDeltaHorz ?? 0) > 2) {
        scheduleTrim(120)
        return
      }
      void manager.q.enqueue(() => manager.trim())
    }, delay)
  }

  const originalCheck = manager.check.bind(manager)
  manager.check = (offsetLeft?: number, offsetTop?: number): Promise<unknown> => {
    // prepend() silently adjusts the native scroller. Always read that live value instead of the
    // cached value from the preceding scroll event before deciding to prepend/append again.
    syncScrollPosition(manager)
    return originalCheck(offsetLeft, offsetTop)
  }

  manager.update = async (requestedOffset?: number): Promise<void> => {
    const offset = requestedOffset ?? manager.settings.offset ?? 0
    const containerBounds = manager.bounds()
    const pendingDisplays: Promise<unknown>[] = []

    for (const view of manager.views.all()) {
      if (manager.isVisible(view, offset, offset, containerBounds)) {
        if (!view.displayed) {
          pendingDisplays.push(
            view.display(manager.request).then(
              () => view.show(),
              () => view.hide()
            )
          )
        } else if (
          view.element?.style.visibility !== 'visible' ||
          view.iframe?.style.visibility !== 'visible'
        ) {
          view.show()
        }
      } else {
        // Keep nearby views intact during active scrolling. Destroying and recreating them at a
        // chapter boundary restarts iframe sizing and therefore the prepend compensation loop.
        if (view.displayed && view.element?.style.visibility !== 'hidden') {
          view.hide()
        }
        scheduleTrim(350)
      }
    }

    await Promise.all(pendingDisplays)
  }

  const originalAddScrollListeners = manager.addScrollListeners.bind(manager)
  manager.addScrollListeners = (): void => {
    originalAddScrollListeners()
    if (manager.container) {
      // epub.js performs its own explicit heightDelta compensation for prepended iframe views.
      manager.container.style.overflowAnchor = 'none'
    }
    const position = syncScrollPosition(manager)
    manager.prevScrollTop = position.top
    manager.prevScrollLeft = position.left
  }

  manager.scrolled = (): void => {
    const checkTask = manager.q.enqueue(() => manager.check())
    manager.scrolledRequestId = (manager.scrolledRequestId ?? 0) + 1
    const requestId = manager.scrolledRequestId

    manager.emit('scroll', { top: manager.scrollTop, left: manager.scrollLeft })
    clearTimeout(manager.afterScrolled)
    manager.afterScrolled = setTimeout(() => {
      void Promise.resolve(checkTask)
        .catch(() => undefined)
        .then(() => {
          if (requestId !== manager.scrolledRequestId) return
          if (manager.snapper?.supportsTouch && manager.snapper.needsSnap()) return
          syncScrollPosition(manager)
          manager.emit('scrolled', { top: manager.scrollTop, left: manager.scrollLeft })
        })
    }, manager.settings.afterScrolledTimeout ?? 10)
  }

  const originalDestroy = manager.destroy.bind(manager)
  manager.destroy = (): void => {
    clearTimeout(manager.trimTimeout)
    clearTimeout(manager.scrollTimeout)
    clearTimeout(manager.afterScrolled)
    originalDestroy()
  }

  return true
}
