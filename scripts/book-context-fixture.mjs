export const fixtureVersion = 1
export const evidence = {
  definition: '本书把将个人立场与可核查事实分开处理的做法称为“分证判断”。“拆开查证”是它在本书中的别称。分证判断要求说明结论来自什么材料，而不是依靠赞同的人数。',
  threshold: '双证门槛要求一项结论同时具备一条可追溯的记录和一次独立复核。两份出自同一来源的转述不算满足门槛；独立复核必须重新检查记录所指的事实。',
  comparison: '投票可以决定先讨论哪个问题，却不能证明某项事实为真。分证判断检验结论的材料，投票汇总参与者的偏好；两者可以配合，但不能彼此替代。',
  exception: '在需要立即避险且无法等待复核时，可以先采取可逆措施，并明确标注临时判断。险情解除后必须补齐复核。这是行动时机的例外，不是把临时判断升级为已证实结论。'
}
export const selectionQuote = '因此，在做出结论之前，应先问这是不是分证判断，再检查它有没有越过双证门槛。'
const filler = '这一页记录读书小组整理材料的过程：先标注页码，再核对抄录，随后把没有查清的事项放回待讨论列表。这段记录不提供新的判断规则，也不报告实验或测量数据。'
export const fixtureText = [
  '第一章 概念与门槛', evidence.definition, evidence.threshold,
  '第二章 判断与投票', evidence.comparison,
  ...Array.from({ length: 105 }, (_, index) => `整理记录${index + 1}。${filler}`),
  '第三章 临时行动', evidence.exception, selectionQuote
].join('\n\n')

export const evaluationCases = [
  { id: 'definition', category: '跨章定义', scope: 'selection', question: '结合本书，分证判断的定义是什么？它要求什么？', expected: ['definition'] },
  { id: 'alias', category: '同义问法', scope: 'selection', question: '书中说的“拆开查证”具体是什么意思？', expected: ['definition'] },
  { id: 'comparison', category: '章节比较', scope: 'selection', question: '比较第一章的双证门槛和第二章的投票：它们分别能做什么，为什么不能替代？', expected: ['threshold', 'comparison'] },
  { id: 'argument', category: '全书论证', scope: 'book', question: '全书如何从分证判断推到双证门槛，又为什么允许临时行动？请梳理论证及例外。', expected: ['definition', 'threshold', 'exception'] },
  { id: 'absent', category: '书中无答案', scope: 'book', question: '本书报告双证门槛将错误率降低了百分之多少？请给出具体数值与实验依据。', expected: [], absent: true },
  { id: 'implicit', category: '隐含同义表达', scope: 'selection', question: '遇到大家一窝蜂赞成某个说法时，作者用什么办法判断它靠不靠谱？', expected: ['definition', 'threshold', 'comparison'] }
]

export function measureAnswer(result, item) {
  const passages = result.context?.passages ?? []
  const requestedIds = [...new Set(Array.from(result.answer.matchAll(/\[(P\d+)\]/gu), (match) => match[1]))]
  const known = new Map(passages.map((passage) => [passage.id, passage]))
  const found = (id, candidates) => candidates.some((passage) => passage.text.includes(evidence[id]))
  return {
    expectedEvidence: item.expected,
    retrievedEvidence: item.expected.filter((id) => found(id, passages)),
    citedEvidence: item.expected.filter((id) => found(id, requestedIds.flatMap((sourceId) => known.has(sourceId) ? [known.get(sourceId)] : []))),
    validCitations: requestedIds.filter((id) => known.has(id)),
    unknownCitations: requestedIds.filter((id) => !known.has(id)),
    insufficientEvidencePhrase: /依据不足|材料不足|没有提供|未提供|未给出|未报告|未记载|无法确定|无法给出|不能确定|没有报告|并未报告|没有.*实验/u.test(result.answer),
    manualReviewRequired: true
  }
}
