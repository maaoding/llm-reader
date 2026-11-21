import type { DocumentSection } from '../src/shared/contracts'

/** Authored, non-personal material. Ground truth names exact blocks, never keyword-score guesses. */
export const fixtureVersion = 1
const chapterData = [
  { title: '概念', evidence: [
    ['definition', '分证判断把个人立场和可核查材料分开，结论必须指出可追溯记录，赞同人数本身不构成事实依据。'],
    ['alias', '拆开查证是分证判断的日常说法。遇到大家一窝蜂赞同，先找到记录再独立核对，而不是照着多数意见下结论。'],
    ['temporary', '临时判断是尚待复核的假设。它可以指引可逆的避险行动，但不得写成已证实结论。'],
    ['trace', '可追溯记录必须标明时间、来源和采集方法，读者应能按这些线索找到原始观察。']
  ] },
  { title: '证据门槛', evidence: [
    ['threshold', '双证门槛要求一条可追溯记录和一次独立复核同时成立，两者缺一不可。复核必须重新检查记录所指的事实。'],
    ['independent', '多篇文章若都转述同一条记录，仍然只算一个来源，不能用转载数量冒充独立复核。'],
    ['negative', '未观察到异常不等于证明异常不存在；没有覆盖关键时段的记录，不能支持全时段安全的结论。'],
    ['revision', '新记录与原结论冲突时应重新核对，不以多数票压下反证；未核清之前把结论退回待验证状态。']
  ] },
  { title: '成立条件', evidence: [
    ['scope', '现场比较只有在采集方法相同、观察时间相近、样本来源相当时才可合并；不满足条件时应分别陈述。'],
    ['correlation', '两项变化同时出现，只能报告相关，若缺乏排除共同原因的材料就不能声称一项导致另一项。'],
    ['absence', '本书没有开展对照实验，也没有报告错误率改善的百分比、最佳样本人数或成本收益。'],
    ['expiry', '许可的有效期由观察条件决定；场地或采集方法变化后，原结论不能直接延用到新条件。']
  ] },
  { title: '成立条件', evidence: [
    ['emergency', '只有需要立即避险且来不及等待复核时，才可先采取可逆措施，并明确标注临时判断。险情解除后必须补齐复核。'],
    ['irreversible', '紧急例外不适用于不可逆的处罚或永久性改变，也不能把临时判断升级为已经证实的事实。'],
    ['table', '措施类型\t是否允许先行动\t后续要求\n可逆避险\t立即危险且不能等待时允许\t险情解除后补齐复核\n永久处罚\t不允许\t先完成双证门槛'],
    ['expired-emergency', '险情已经解除时，不能继续用紧急例外拖延复核；未经复核的结论必须保留待验证标签。']
  ] },
  { title: '概念比较', evidence: [
    ['vote', '投票决定先讨论什么问题，汇总参与者的偏好；分证判断检验材料是否支持事实结论。两者可以配合但不能互相替代。'],
    ['majority', '社会从众是受到群体压力后改变判断。独立判断指自主检验依据，并不意味着永远反对多数人。'],
    ['audit', '复核检查记录是否支持结论；审计检查记录和复核流程是否留下完整痕迹。流程完整仍不能保证每一结论正确。'],
    ['repeat', '这句话在不同章节重复出现，必须保留各自位置。']
  ] },
  { title: '执行步骤', evidence: [
    ['procedure', '日常顺序是记录来源、检查独立性、对照反证、作出判断，最后归档。遇到紧急避险，行动可以前置，复核步骤仍要补齐。'],
    ['archive', '归档需保存原记录、复核过程和结论变更原因。重新判断后保留旧版本，使后来的读者能看出修改缘由。'],
    ['repeat2', '这句话在不同章节重复出现，必须保留各自位置。'],
    ['outside', '对于书中没有提供的事实，应明确说明依据不足，不根据术语相似就补造数字、机构或人物。']
  ] }
]
export interface EvaluationCase { id: string; category: string; question: string; expected: string[]; chapters: string[] }
const rows: Array<[string, string, string, string[]]> = [
  ['q01', '定义', '本书的分证判断是什么意思？', ['definition']],
  ['q02', '定义', '双证门槛需要同时具备什么？', ['threshold']],
  ['q03', '定义', '怎样才算可追溯记录？', ['trace']],
  ['q04', '定义', '临时判断能否当成已经证实的事实？', ['temporary']],
  ['q05', '隐含同义', '大家一窝蜂叫好时，如何判断一个说法靠不靠谱？', ['alias', 'definition']],
  ['q06', '隐含同义', '十家媒体搬运同一消息算不算十次独立核验？', ['independent']],
  ['q07', '隐含同义', '没有发现坏情况，就能断言一直都安全吗？', ['negative']],
  ['q08', '隐含同义', '与大多数人意见相同就一定丧失自主性了吗？', ['majority']],
  ['q09', '条件与例外', '哪些采集条件满足后，现场比较才可以合并？', ['scope']],
  ['q10', '条件与例外', '紧急情况下何时可以先行动，事后需要做什么？', ['emergency']],
  ['q11', '条件与例外', '紧急例外允许不可逆处罚吗？', ['irreversible']],
  ['q12', '条件与例外', '危险已经过去，能继续推迟核验吗？', ['expired-emergency']],
  ['q13', '相近概念', '一起变化与因果关系有什么区别？', ['correlation']],
  ['q14', '相近概念', '复核和审计的目的分别是什么？', ['audit']],
  ['q15', '相近概念', '投票决定与事实判断能否互相替代？', ['vote', 'definition']],
  ['q16', '相近概念', '记录还是独立复核，双证门槛只满足一项可以吗？', ['threshold', 'independent']],
  ['q17', '跨章比较', '比较通常的双证门槛和紧急时先行动的条件。', ['threshold', 'emergency', 'irreversible']],
  ['q18', '跨章比较', '从分证判断到日常执行步骤，本书如何落实事实核验？', ['definition', 'procedure']],
  ['q19', '跨章比较', '出现反证后怎样改判断，归档要保留什么？', ['revision', 'archive']],
  ['q20', '跨章比较与表格', '根据措施表和双证门槛，比较可逆避险与永久处罚的行动顺序。', ['table', 'threshold']],
  ['q21', '书中无答案', '双证门槛将错误率降低了百分之多少？', []],
  ['q22', '书中无答案', '本书实验确定的最佳样本人数是多少？', []],
  ['q23', '书中无答案', '分证判断在哪一年由哪所大学首次提出？', []],
  ['q24', '书中无答案', '本书记录的月度成本收益有多少元？', []]
]
export const evidenceChapter = Object.fromEntries(chapterData.flatMap((chapter, i) => chapter.evidence.map(([id]) => [id, `c${i}`])))
export const evaluationCases: EvaluationCase[] = rows.map(([id, category, question, expected]) => ({ id, category, question, expected, chapters: [...new Set(expected.map((id) => evidenceChapter[id]))] }))
export function createRerankFixture(): DocumentSection[] {
  let position = 0
  const sections: DocumentSection[] = []
  chapterData.forEach((chapter, chapterIndex) => {
    const blocks = Array.from({ length: 32 }, (_, index) => {
      const original = index >= 24 && index < 28 ? chapter.evidence[index - 24] : null
      const id = original?.[0] ?? `filler-${chapterIndex}-${index}`
      const text = original?.[1] ?? `整理记录 ${chapterIndex + 1}-${index + 1}。本页讨论判断、记录、证据、条件、复核和例外的阅读安排，保存抄录页码与待讨论事项。` + '这一段仅为整理工作记录，没有给出术语定义、成立条件、数字或实验结论。'.repeat(12)
      const start = position; position += text.length + 2
      return { id, kind: 'paragraph' as const, text, anchor: `txt:${start}:${position - 2}` }
    })
    for (let i = 0; i < blocks.length; i += 8) sections.push({ id: `c${chapterIndex}-s${i / 8}`, chapterId: `c${chapterIndex}`, chapterTitle: chapter.title, order: sections.length, blocks: blocks.slice(i, i + 8) })
  })
  return sections
}
