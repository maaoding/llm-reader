import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { DocumentTable, TableCell } from '@shared/contracts'

type Node = DefaultTreeAdapterTypes.Node
function children(node: Node): Node[] { return 'childNodes' in node ? node.childNodes : [] }
function tag(node: Node): string { return 'tagName' in node ? node.tagName : '' }
function descendants(node: Node, name: string, depth = 0): Node[] {
  if (depth > 64) throw new Error('表格嵌套过深。')
  return children(node).flatMap((child) => tag(child) === name ? [child] : descendants(child, name, depth + 1))
}
function nodeText(node: Node, depth = 0): string {
  if (depth > 64) throw new Error('表格嵌套过深。')
  if (['script', 'style', 'template', 'noscript', 'img', 'iframe', 'object'].includes(tag(node))) return ''
  if ('value' in node) return node.value
  return children(node).map((child) => nodeText(child, depth + 1) + (['td', 'th'].includes(tag(child)) ? '\t' : ['tr', 'p', 'br'].includes(tag(child)) ? '\n' : '')).join('')
}
function span(node: Node, name: string): number {
  const value = 'attrs' in node ? node.attrs.find((attr) => attr.name === name)?.value : undefined
  if (value === undefined) return 1
  if (!/^[1-9]\d{0,4}$/u.test(value)) throw new Error('表格跨度无效。')
  return Number(value)
}

export function parseHtmlTable(html: string, id: string): { text: string; table?: DocumentTable; degraded: boolean } {
  // parse5 builds a syntax tree only. It has no DOM, script execution, image loader or network access.
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
  const text = nodeText(fragment).trim()
  try {
    const tables = descendants(fragment, 'table')
    if (tables.length !== 1 || descendants(tables[0], 'table').length) throw new Error('表格数量无效。')
    if (!('sourceCodeLocation' in tables[0]) || !tables[0].sourceCodeLocation || !('endTag' in tables[0].sourceCodeLocation) || !tables[0].sourceCodeLocation.endTag) throw new Error('表格结构不完整。')
    const rows = descendants(tables[0], 'tr')
    const cells: TableCell[] = [], occupied = new Set<string>()
    const rowTexts: string[][] = []
    if (!rows.length || rows.length > 100_000) throw new Error('表格行数无效。')
    let columns = 0
    for (const [row, item] of rows.entries()) {
      let column = 0
      rowTexts.push([])
      for (const child of children(item).filter((node) => ['td', 'th'].includes(tag(node)))) {
        while (occupied.has(`${row}:${column}`)) column++
        const rowSpan = span(child, 'rowspan'), columnSpan = span(child, 'colspan')
        if (row + rowSpan > rows.length || column + columnSpan > 100_000 || rowSpan * columnSpan > 100_000 || cells.length > 100_000) throw new Error('表格跨度无效。')
        for (let r = row; r < row + rowSpan; r++) for (let c = column; c < column + columnSpan; c++) {
          const key = `${r}:${c}`
          if (occupied.has(key) || occupied.size > 200_000) throw new Error('表格单元格重叠。')
          occupied.add(key)
        }
        const inHead = 'parentNode' in item && item.parentNode && tag(item.parentNode) === 'thead'
        const scope = 'attrs' in child ? child.attrs.find((attribute) => attribute.name === 'scope')?.value : undefined
        const content = nodeText(child).trim()
        cells.push({ id: `${id}-c${cells.length}`, row, column, rowSpan, columnSpan,
          header: scope !== 'row' && scope !== 'rowgroup' && (tag(child) === 'th' || Boolean(inHead)), rowHeader: scope === 'row' || scope === 'rowgroup', text: content })
        rowTexts[row].push(content)
        column += columnSpan; columns = Math.max(columns, column)
      }
    }
    if (!cells.length || !columns) throw new Error('表格没有单元格。')
    return { text: rowTexts.map((row) => row.join('\t')).join('\n'),
      table: { rows: rows.length, columns, cells, captionIds: [], noteIds: [] }, degraded: false }
  } catch { return { text, degraded: true } }
}
