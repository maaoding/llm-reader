import { memo, useMemo, type ReactNode } from 'react'
import { parseMarkdown, previewInlines, type AnswerInline, type MarkdownBlock } from './answer-markdown'

function InlineContent({ nodes }: { nodes: AnswerInline[] }): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <span key={index}>{node.text}</span>
    if (node.type === 'code') return <code className="answer-code-inline" key={index}>{node.text}</code>
    if (node.type === 'strong') return <strong key={index}><InlineContent nodes={node.children} /></strong>
    return <em key={index}><InlineContent nodes={node.children} /></em>
  })
}

function BlockContent({ block }: { block: MarkdownBlock }): ReactNode {
  if (block.type === 'paragraph') return <p><InlineContent nodes={block.inlines} /></p>
  if (block.type === 'heading') {
    const content = <InlineContent nodes={block.inlines} />
    if (block.level === 1) return <h1>{content}</h1>
    if (block.level === 2) return <h2>{content}</h2>
    if (block.level === 3) return <h3>{content}</h3>
    return <h4>{content}</h4>
  }
  if (block.type === 'code') {
    return <pre className="answer-code-block"><code className={block.language ? `language-${block.language}` : undefined}>{block.text}</code></pre>
  }
  if (block.type === 'blockquote') {
    return <blockquote>{block.blocks.map((child, index) => <BlockContent block={child} key={index} />)}</blockquote>
  }
  const List = block.ordered ? 'ol' : 'ul'
  return <List>{block.items.map((item, index) => <li key={index}>
    <InlineContent nodes={item.inlines} />
    {item.children.map((child, childIndex) => <BlockContent block={child} key={childIndex} />)}
  </li>)}</List>
}

/** Markdown-only presentation for saved summaries. It deliberately does not parse citations. */
export const MarkdownText = memo(function MarkdownText({ text, className = '' }: { text: string; className?: string }): ReactNode {
  const blocks = parseMarkdown(text)
  return <div className={`markdown-text ${className}`.trim()}>{blocks.map((block, index) => <BlockContent block={block} key={index} />)}</div>
})

/** 单行预览：保留行内 Markdown 强调与行内代码，丢弃块级结构，超长时截断。 */
export const MarkdownPreview = memo(function MarkdownPreview({ text, limit }: { text: string; limit: number }): ReactNode {
  const nodes = useMemo(() => previewInlines(text, limit), [limit, text])
  return <InlineContent nodes={nodes} />
})
