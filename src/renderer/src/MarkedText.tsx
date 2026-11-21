import { type ReactNode } from 'react'
import { splitMatches } from './highlight'

export function MarkedText({ value, needle }: { value: string; needle: string }): ReactNode {
  return splitMatches(value, needle).map((segment, index) => (
    segment.hit ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
  ))
}
