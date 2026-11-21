import { useImperativeHandle, useLayoutEffect, useRef, type ComponentProps } from 'react'

/** 保留原生选择行为，同时让长名称在收起状态下可以省略。 */
export function Select({ children, ref, ...props }: ComponentProps<'select'>) {
  const elementRef = useRef<HTMLSelectElement>(null)
  useImperativeHandle(ref, () => elementRef.current!, [])
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || !globalThis.CSS?.supports?.('appearance', 'base-select')) return
    // React 的 select 子节点校验尚未包含 selectedcontent；只把值展示交给浏览器，选项仍由 React 管理。
    const button = document.createElement('button')
    button.type = 'button'
    button.tabIndex = -1
    button.inert = true
    button.className = 'select-value'
    button.append(document.createElement('selectedcontent'))
    element.prepend(button)
    return () => button.remove()
  }, [])
  return <select {...props} ref={elementRef}>{children}</select>
}
