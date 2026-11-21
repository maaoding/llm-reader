import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'

type Props = Omit<ComponentPropsWithoutRef<'details'>, 'children' | 'open' | 'onToggle'> & {
  summary: ReactNode
  children: () => ReactNode
}

/** Mount expensive details on first expansion; retain them afterward to preserve local state. */
export function DeferredDetails({ summary, children, ...props }: Props) {
  const [mounted, setMounted] = useState(false)
  return <details {...props} onToggle={(event) => {
    if (event.currentTarget.open) setMounted(true)
  }}>
    <summary>{summary}</summary>
    {mounted ? children() : null}
  </details>
}
