import { memo, type ReactNode } from 'react'
import { copy } from '@shared/copy'
import { isPdfImageRegion, type ReaderSource, type SelectionContext } from '@shared/contracts'
import { parseMarkdown, type AnswerInline, type MarkdownBlock } from './answer-markdown'
import { citationSegments, withoutIncompleteCitationMarker } from './citations'
import { MarkedText } from './MarkedText'
import { WebCitation } from './WebSources'

type CitationContext = Pick<SelectionContext, 'passages'> & { bookId: string; webSources: import('@shared/contracts').WebSearchSource[]; availableBookIds?: string[] }

function TextContent({
  text,
  selection,
  onNavigate,
  highlight
}: {
  text: string
  selection: CitationContext
  onNavigate: ((anchor: string, bookId?: string) => void) | null
  highlight: string
}): ReactNode {
  const segments = citationSegments(withoutIncompleteCitationMarker(text), selection.passages, selection.webSources)
  return segments.map((segment, index) => {
    if (segment.type === 'text') {
      return (
        <span key={index}>
          {highlight ? <MarkedText value={segment.text} needle={highlight} /> : segment.text}
        </span>
      )
    }
    if (segment.type === 'unverified') {
      return (
        <span
          className="citation citation-unknown"
          data-testid="citation-unverified"
          title={segment.title}
          key={index}
        >
          {segment.label}
        </span>
      )
    }
    if (segment.type === 'web') return <WebCitation key={index} source={segment.source} bookId={selection.bookId} />
    const missing = segment.bookId && selection.availableBookIds && !selection.availableBookIds.includes(segment.bookId)
    if (missing) return <span className="citation citation-unknown" key={index} title={copy('workbench.missingSource')}>{segment.label} · {copy('workbench.deletedBook')}</span>
    if (onNavigate) {
      return (
        <button
          className="citation citation-valid"
          data-testid="citation-valid"
          key={index}
          type="button"
          title={segment.title}
          onClick={() => segment.bookId ? onNavigate(segment.anchor, segment.bookId) : onNavigate(segment.anchor)}
        >
          {segment.label}
        </button>
      )
    }
    return (
      <span
        className="citation citation-valid"
        data-testid="citation-valid"
        title={segment.title}
        key={index}
      >
        {segment.label}
      </span>
    )
  })
}

function InlineContent({
  nodes,
  selection,
  onNavigate,
  highlight
}: {
  nodes: AnswerInline[]
  selection: CitationContext
  onNavigate: ((anchor: string, bookId?: string) => void) | null
  highlight: string
}): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') {
      return <TextContent text={node.text} selection={selection} onNavigate={onNavigate} highlight={highlight} key={index} />
    }
    if (node.type === 'code') return <code className="answer-code-inline" key={index}>{node.text}</code>
    if (node.type === 'strong') {
      return <strong key={index}><InlineContent nodes={node.children} selection={selection} onNavigate={onNavigate} highlight={highlight} /></strong>
    }
    return <em key={index}><InlineContent nodes={node.children} selection={selection} onNavigate={onNavigate} highlight={highlight} /></em>
  })
}

function BlockContent({
  block,
  selection,
  onNavigate,
  highlight
}: {
  block: MarkdownBlock
  selection: CitationContext
  onNavigate: ((anchor: string, bookId?: string) => void) | null
  highlight: string
}): ReactNode {
  if (block.type === 'paragraph') {
    return <p><InlineContent nodes={block.inlines} selection={selection} onNavigate={onNavigate} highlight={highlight} /></p>
  }
  if (block.type === 'heading') {
    const level = block.level
    return level === 1
      ? <h1><InlineContent nodes={block.inlines} selection={selection} onNavigate={onNavigate} highlight={highlight} /></h1>
      : level === 2
        ? <h2><InlineContent nodes={block.inlines} selection={selection} onNavigate={onNavigate} highlight={highlight} /></h2>
        : level === 3
          ? <h3><InlineContent nodes={block.inlines} selection={selection} onNavigate={onNavigate} highlight={highlight} /></h3>
          : <h4><InlineContent nodes={block.inlines} selection={selection} onNavigate={onNavigate} highlight={highlight} /></h4>
  }
  if (block.type === 'code') {
    return (
      <pre className="answer-code-block">
        <code className={block.language ? `language-${block.language}` : undefined}>{block.text}</code>
      </pre>
    )
  }
  if (block.type === 'blockquote') {
    return (
      <blockquote>
        {block.blocks.map((child, index) => (
          <BlockContent block={child} selection={selection} onNavigate={onNavigate} highlight={highlight} key={index} />
        ))}
      </blockquote>
    )
  }
  const List = block.ordered ? 'ol' : 'ul'
  return (
    <List>
      {block.items.map((item, index) => (
        <li key={index}>
          <InlineContent nodes={item.inlines} selection={selection} onNavigate={onNavigate} highlight={highlight} />
          {item.children.map((child, childIndex) => (
            <BlockContent block={child} selection={selection} onNavigate={onNavigate} highlight={highlight} key={childIndex} />
          ))}
        </li>
      ))}
    </List>
  )
}

export const AnswerText = memo(function AnswerText({
  text,
  selection,
  onNavigate,
  readOnly = false,
  highlight = '',
  context,
  availableBookIds
}: {
  text: string
  selection: ReaderSource | null
  availableBookIds?: string[]
  context?: import('@shared/contracts').ContextSnapshot
  onNavigate?: (anchor: string, bookId?: string) => void
  readOnly?: boolean
  highlight?: string
}): ReactNode {
  const blocks = parseMarkdown(text)
  const navigate = readOnly ? null : (onNavigate ?? null)
  const source: CitationContext = { availableBookIds, passages: context?.passages ?? (selection && !isPdfImageRegion(selection) ? selection.passages : []), bookId: context?.books?.find((book) => !availableBookIds || availableBookIds.includes(book.id))?.id ?? context?.bookId ?? selection?.bookId ?? '', webSources: context?.webSearch?.sources ?? [] }
  return (
    <div className="answer-text answer-md">
      {blocks.map((block, index) => (
        <BlockContent block={block} selection={source} onNavigate={navigate} highlight={highlight} key={index} />
      ))}
    </div>
  )
})
