import type { ReactNode } from 'react'
import type { SelectionContext } from '@shared/contracts'
import { citationSegments, withoutIncompleteCitationMarker } from './citations'

export function CitationText({
  text,
  selection,
  onNavigate
}: {
  text: string
  selection: SelectionContext
  onNavigate: (anchor: string) => void
}): ReactNode {
  const parsedLines = withoutIncompleteCitationMarker(text)
    .split('\n')
    .map((line) => citationSegments(line, selection.passages))

  return (
    <div className="answer-text">
      {parsedLines.map((segments, lineIndex) => {
        return (
          <p key={lineIndex}>
            {segments.map((segment, segmentIndex) => {
              if (segment.type === 'text') return <span key={segmentIndex}>{segment.text}</span>
              if (segment.type === 'unverified') {
                return (
                  <span
                    className="citation citation-unknown"
                    data-testid="citation-unverified"
                    title={segment.title}
                    key={segmentIndex}
                  >
                    {segment.label}
                  </span>
                )
              }
              return (
                <button
                  className="citation citation-valid"
                  data-testid="citation-valid"
                  key={segmentIndex}
                  type="button"
                  title={segment.title}
                  onClick={() => onNavigate(segment.anchor)}
                >
                  {segment.label}
                </button>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}
