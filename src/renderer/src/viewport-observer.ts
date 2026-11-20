interface ObserverGroup {
  observer: IntersectionObserver
  callbacks: Map<Element, () => void>
}

const observerGroups = new WeakMap<Element, ObserverGroup>()

/** Share one observer per scroll container and stop observing each element after it is nearby. */
export function observeNearby(element: Element, root: Element | null, onNearby: () => void): () => void {
  if (!root || typeof IntersectionObserver === 'undefined') {
    onNearby()
    return () => undefined
  }

  let group = observerGroups.get(root)
  if (!group) {
    const callbacks = new Map<Element, () => void>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = callbacks.get(entry.target)
        if (!callback) continue
        callbacks.delete(entry.target)
        observer.unobserve(entry.target)
        callback()
      }
      if (callbacks.size === 0) {
        observer.disconnect()
        if (observerGroups.get(root)?.observer === observer) observerGroups.delete(root)
      }
    }, { root, rootMargin: '200px 0px' })
    group = { observer, callbacks }
    observerGroups.set(root, group)
  }

  const { callbacks, observer } = group
  callbacks.set(element, onNearby)
  observer.observe(element)
  return () => {
    if (callbacks.get(element) !== onNearby) return
    callbacks.delete(element)
    observer.unobserve(element)
    if (callbacks.size === 0) {
      observer.disconnect()
      if (observerGroups.get(root)?.observer === observer) observerGroups.delete(root)
    }
  }
}
