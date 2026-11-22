import { memo, useMemo, type ReactNode } from 'react'
import { copy, type UiLanguage } from '@shared/copy'
import { isPdfImageRegion, type ContextSnapshot, type ReaderSource, type Passage, type WebSearchSource } from '@shared/contracts'
import { parseMarkdown, type AnswerInline, type MarkdownBlock } from './answer-markdown'
import { createCitationResolver, withoutIncompleteCitationMarker } from './citations'
import { MarkedText } from './MarkedText'
import { PassagePreview, type NavigatePassage } from './PassagePreview'
import { WebCitation } from './WebSources'

type CitationContext = {
  bookId: string
  resolve: ReturnType<typeof createCitationResolver>
  context?: ContextSnapshot
  bookTitle?: string
  availableBookIds?: string[]
  readOnly: boolean
  documentTarget?: Document
}
const NO_PASSAGES: Passage[] = []
const NO_WEB_SOURCES: WebSearchSource[] = []

function TextContent({
  text,
  selection,
  onNavigate,
  highlight
}: {
  text: string
  selection: CitationContext
  onNavigate?: NavigatePassage
  highlight: string
}): ReactNode {
  const segments = selection.resolve(withoutIncompleteCitationMarker(text))
  return segments.map((segment, index) => {
    if (segment.type === 'text') {
      return highlight ? <MarkedText key={index} value={segment.text} needle={highlight} /> : segment.text
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
    if (segment.type === 'web') return <WebCitation key={index} source={segment.source} bookId={selection.bookId} documentTarget={selection.documentTarget} />
    const { anchor, bookId } = segment.passage
    if (selection.context && !selection.readOnly) {
      return (
        <PassagePreview key={index} passage={segment.passage} context={selection.context}
          bookTitle={selection.bookTitle} availableBookIds={selection.availableBookIds} onNavigate={onNavigate}
          className="citation citation-valid" testId="citation-valid">{segment.label}</PassagePreview>
      )
    }
    const missing = bookId && selection.availableBookIds && !selection.availableBookIds.includes(bookId)
    if (missing) return <span className="citation citation-unknown" key={index} title={copy('workbench.missingSource')}>{segment.label} · {copy('workbench.deletedBook')}</span>
    if (onNavigate) {
      return (
        <button
          className="citation citation-valid"
          data-testid="citation-valid"
          key={index}
          type="button"
          title={segment.title}
          onClick={() => bookId ? onNavigate(anchor, bookId) : onNavigate(anchor)}
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
  onNavigate?: NavigatePassage
  highlight: string
}): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') {
      if (!node.text.includes('[')) {
        return highlight ? <MarkedText key={index} value={node.text} needle={highlight} /> : node.text
      }
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
  onNavigate?: NavigatePassage
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
  bookTitle,
  availableBookIds,
  documentTarget
}: {
  text: string
  selection: ReaderSource | null
  availableBookIds?: string[]
  context?: ContextSnapshot
  bookTitle?: string
  onNavigate?: NavigatePassage
  readOnly?: boolean
  highlight?: string
  documentTarget?: Document
  /** Invalidates memoized labels independently of the saved answer text. */
  uiLanguage?: UiLanguage
}): ReactNode {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  const passages = context?.passages ?? (selection && !isPdfImageRegion(selection) ? selection.passages : NO_PASSAGES)
  const webSources = context?.webSearch?.sources ?? NO_WEB_SOURCES
  const resolveCitations = useMemo(() => createCitationResolver(passages, webSources), [passages, webSources])
  const navigate = readOnly ? undefined : onNavigate
  const source: CitationContext = { context, bookTitle, availableBookIds, readOnly, resolve: resolveCitations, documentTarget, bookId: context?.books?.find((book) => !availableBookIds || availableBookIds.includes(book.id))?.id ?? context?.bookId ?? selection?.bookId ?? '' }
  return (
    <div className="answer-text answer-md">
      {blocks.map((block, index) => (
        <BlockContent block={block} selection={source} onNavigate={navigate} highlight={highlight} key={index} />
      ))}
    </div>
  )
})
