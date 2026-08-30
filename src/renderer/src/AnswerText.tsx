import { memo, type ReactNode } from 'react'
import type { SelectionContext } from '@shared/contracts'
import { parseMarkdown, type AnswerInline, type MarkdownBlock } from './answer-markdown'
import { citationSegments, withoutIncompleteCitationMarker } from './citations'
import { MarkedText } from './MarkedText'

function TextContent({
  text,
  selection,
  onNavigate,
  highlight
}: {
  text: string
  selection: SelectionContext
  onNavigate: ((anchor: string) => void) | null
  highlight: string
}): ReactNode {
  const segments = citationSegments(withoutIncompleteCitationMarker(text), selection.passages)
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
    if (onNavigate) {
      return (
        <button
          className="citation citation-valid"
          data-testid="citation-valid"
          key={index}
          type="button"
          title={segment.title}
          onClick={() => onNavigate(segment.anchor)}
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
  selection: SelectionContext
  onNavigate: ((anchor: string) => void) | null
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
  selection: SelectionContext
  onNavigate: ((anchor: string) => void) | null
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
  highlight = ''
}: {
  text: string
  selection: SelectionContext
  onNavigate?: (anchor: string) => void
  readOnly?: boolean
  highlight?: string
}): ReactNode {
  const blocks = parseMarkdown(text)
  const navigate = readOnly ? null : (onNavigate ?? null)
  return (
    <div className="answer-text answer-md">
      {blocks.map((block, index) => (
        <BlockContent block={block} selection={selection} onNavigate={navigate} highlight={highlight} key={index} />
      ))}
    </div>
  )
})
