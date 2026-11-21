// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from '../../src/renderer/src/MarkdownText'

afterEach(cleanup)

describe('summary Markdown presentation', () => {
  it('renders the supported summary syntax without creating citations or links', () => {
    const { container } = render(<MarkdownText text={'## 小标题\n\n这是 **重点** 与 *说明*，保留 [P1]。\n\n- 条目一\n- `条目二`\n\n> 引用段\n\n```ts\nconst value = 1\n```\n\n<a href="https://example.com">外链</a>\n\n![图片](https://example.com/a.png)'} />)

    expect(screen.getByRole('heading', { name: '小标题' })).not.toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('重点')
    expect(container.querySelector('em')?.textContent).toBe('说明')
    expect(screen.getByText('条目二', { selector: 'code' })).not.toBeNull()
    expect(container.querySelector('.answer-code-block')?.textContent).toContain('const value = 1')
    expect(container.querySelector('[data-testid^="citation-"]')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).toContain('[P1]')
    expect(container.textContent).toContain('<a href="https://example.com">外链</a>')
    expect(container.textContent).toContain('![图片](https://example.com/a.png)')
  })

  it('renders empty text without an invented placeholder', () => {
    const { container } = render(<MarkdownText text="" />)
    expect(container.querySelector('.markdown-text')?.childElementCount).toBe(0)
  })
})
