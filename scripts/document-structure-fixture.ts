/** Self-authored public test content. No user book, credential or model answer is included. */
export interface StructureQuestion {
  id: string
  question: string
  expected: { quote: string; pages: number[] }[]
  absent?: string
}
export const structureQuestions: StructureQuestion[] = [
  { id: 'S01', question: '分证判断的定义是什么？', expected: [{ quote: '分证判断要求分别检查事实、前提和行动范围。', pages: [1] }] },
  { id: 'S02', question: '共同验证的两个前提是什么？', expected: [{ quote: '共同验证仅在资料独立且记录可追溯时成立。', pages: [1] }] },
  { id: 'S03', question: '资料独立能否省略记录可追溯？', expected: [{ quote: '资料独立不能代替记录可追溯，两项前提必须同时满足。', pages: [1] }] },
  { id: 'S04', question: '为什么不能把沉默等同于同意？', expected: [{ quote: '沉默可能来自信息不足，因此不能等同于同意。', pages: [1] }] },
  { id: 'S05', question: '临时行动例外的四项限制？', expected: [{ quote: '临时行动只限立即危险、无法等待、措施可逆，并须事后复核。', pages: [2] }] },
  { id: 'S06', question: '能否因时间紧张而省略复核？', expected: [{ quote: '时间紧张本身不构成例外，也不能省略事后复核。', pages: [2] }] },
  { id: 'S07', question: '封存判断的脚注规定何时复核？', expected: [{ quote: '封存判断必须保留原始记录，时间见明确脚注。', pages: [2] }, { quote: '脚注：封存后的二十四小时内完成首次复核。', pages: [2] }] },
  { id: 'S08', question: '匿名脚注有没有明确关联？', expected: [{ quote: '匿名脚注：这里没有提供对应的正文标记。', pages: [2] }] },
  { id: 'S09', question: '核验表的表头“处理规则”对应什么？', expected: [{ quote: '情境\t处理规则', pages: [3, 4] }] },
  { id: 'S10', question: '立即危险在核验表中如何处理？', expected: [{ quote: '立即危险\t可逆行动并事后复核', pages: [3, 4] }] },
  { id: 'S11', question: '只有时间紧张时，核验表允许什么？', expected: [{ quote: '时间紧张\t继续核对，不启用例外', pages: [3, 4] }] },
  { id: 'S12', question: '跨页核验表中资料冲突要怎么处理？', expected: [{ quote: '资料冲突\t分别核查两个来源', pages: [3, 4] }] },
  { id: 'S13', question: '核验表表注中的“可逆”指什么？', expected: [{ quote: '表注：可逆指行动可以撤回，不代表证据可以省略。', pages: [4] }] },
  { id: 'S14', question: '核验表标题是什么？', expected: [{ quote: '表一：核验情境与处理规则。', pages: [3] }] },
  { id: 'S15', question: '风险阈值的原始公式及适用条件？', expected: [{ quote: '风险阈值 T = E / C，仅在 C > 0 时适用。', pages: [5] }] },
  { id: 'S16', question: '风险阈值公式不能用于哪种情形？', expected: [{ quote: '当 C = 0 时，风险阈值公式不适用，不得填入默认数值。', pages: [5] }] },
  { id: 'S17', question: '复核清单的三步顺序是什么？', expected: [{ quote: '复核清单：先核对事实，再核对前提，最后记录例外。', pages: [6] }] },
  { id: 'S18', question: 'Unicode 记录保留哪些符号？', expected: [{ quote: 'Unicode 记录保留 😀、𠮷 和 é，不按 UTF-16 单元移动位置。', pages: [6] }] },
  { id: 'S19', question: '共同验证前提与临时行动例外有什么区别？', expected: [{ quote: '共同验证仅在资料独立且记录可追溯时成立。', pages: [1] }, { quote: '临时行动只限立即危险、无法等待、措施可逆，并须事后复核。', pages: [2] }] },
  { id: 'S20', question: '先核对事实后使用风险阈值是否仍须检查 C？', expected: [{ quote: '复核清单：先核对事实，再核对前提，最后记录例外。', pages: [6] }, { quote: '风险阈值 T = E / C，仅在 C > 0 时适用。', pages: [5] }] },
  { id: 'S21', question: '重复核验记录在两个不同页有什么内容？', expected: [{ quote: '重复核验记录必须保留原始位置，即使文字完全相同也不能合并删除。', pages: [1] }, { quote: '重复核验记录必须保留原始位置，即使文字完全相同也不能合并删除。', pages: [6] }] },
  { id: 'S22', question: '2024 年实验成功率是多少？', expected: [], absent: '实验成功率为' },
  { id: 'S23', question: '作者的联系电话是什么？', expected: [], absent: '联系电话为' },
  { id: 'S24', question: '核验表是否说明每一行的准确页码？', expected: [{ quote: '资料冲突\t分别核查两个来源', pages: [3, 4] }] }
]

export function structureDoclingFixture() {
  const prov = (page: number, top = 100) => [{ page_no: page, bbox: { l: 40, t: top, r: 900, b: top + 40, coord_origin: 'TOPLEFT' }, charspan: [0, 0] }]
  const texts: Record<string, unknown>[] = []
  const body: { $ref: string }[] = []
  const pageLines = new Map<number, number>()
  const add = (content: string, page: number, label = 'text', level?: number): string => {
    const ref = '#/texts/' + texts.length
    const line = pageLines.get(page) ?? 0
    pageLines.set(page, line + 1)
    texts.push({ text: content, label, prov: prov(page, 100 + line * 60), ...(level ? { level } : {}) })
    body.push({ $ref: ref }); return ref
  }
  add('第一卷 分证判断', 1, 'section_header', 1)
  add('定义与条件', 1, 'section_header', 2)
  for (const question of structureQuestions.slice(0, 4)) add(question.expected[0].quote, 1)
  add(structureQuestions[20].expected[0].quote, 1)
  add('例外与脚注', 2, 'section_header', 2)
  add(structureQuestions[4].expected[0].quote, 2)
  add(structureQuestions[5].expected[0].quote, 2)
  const reference = add(structureQuestions[6].expected[0].quote, 2)
  const footnote = add(structureQuestions[6].expected[1].quote, 2, 'footnote')
  texts[Number(reference.split('/').at(-1))].references = [{ $ref: footnote }]
  add(structureQuestions[7].expected[0].quote, 2, 'footnote')
  add('核验表', 3, 'section_header', 2)
  body.push({ $ref: '#/tables/0' })
  const caption = add(structureQuestions[13].expected[0].quote, 3, 'caption')
  const tableNote = add(structureQuestions[12].expected[0].quote, 4, 'footnote')
  texts[Number(tableNote.split('/').at(-1))].prov = prov(4, 320)
  add('推导公式', 5, 'section_header', 2)
  add(structureQuestions[14].expected[0].quote, 5, 'formula')
  add(structureQuestions[15].expected[0].quote, 5)
  add('复核清单', 6, 'section_header', 2)
  add(structureQuestions[16].expected[0].quote, 6, 'list_item')
  add(structureQuestions[17].expected[0].quote, 6)
  add(structureQuestions[20].expected[1].quote, 6)
  const header = '#/texts/' + texts.length
  texts.push({ text: '页眉机密控制词：页眉不参与检索。', label: 'page_header', content_layer: 'furniture', prov: prov(1, 10) })
  const data = [['情境', '处理规则'], ['立即危险', '可逆行动并事后复核'], ['时间紧张', '继续核对，不启用例外'], ['资料冲突', '分别核查两个来源']]
  const cells = data.flatMap((row, r) => row.map((content, c) => ({ text: content, start_row_offset_idx: r, end_row_offset_idx: r + 1,
    start_col_offset_idx: c, end_col_offset_idx: c + 1, row_span: 1, col_span: 1, column_header: r === 0 })))
  return { pages: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index + 1), { size: { width: 1000, height: 1000 } }])),
    body: { children: body }, furniture: { children: [{ $ref: header }] }, texts, groups: [], pictures: [],
    tables: [{ label: 'table', prov: [...prov(3, 400), ...prov(4, 100)], data: { num_rows: 4, num_cols: 2, table_cells: cells },
      captions: [{ $ref: caption }], footnotes: [{ $ref: tableNote }] }] }
}
