/* Authored holdout: no user books, model answers, or earlier evaluation rules. */
export const schemaVersion = 1
export const fixtureTitle = 'Glasshouse seed archive and ridge nursery: independent reading sample'
export const sources = [
  { key: 'epub', title: 'Glasshouse Seed Archive Handbook', filename: 'glasshouse-seed-archive.epub', kind: 'epub', language: 'en' },
  { key: 'digital', title: 'Ridge Nursery Dispatch Addendum', filename: 'ridge-nursery-digital.pdf', kind: 'pdf', language: 'en' },
  { key: 'scanned', title: 'Ridge Nursery Dispatch Addendum (image-only twin)', filename: 'ridge-nursery-scanned.pdf', kind: 'pdf', language: 'en' }
]

const archiveEvidence = [
  ['E01', 1, 'The Glasshouse archive holds a newly received silver-plume seed lot for seven days before routine release to the internal research bench. This archive hold is not a courier transit limit.'],
  ['E02', 2, 'A silver-plume lot is ready for dry storage only when measured relative humidity is at most 18 percent and the reading has remained stable for twelve consecutive hours.'],
  ['E03', 3, 'A dormant wild-origin silver-plume lot must remain in its original ventilated envelope until the seasonal review, even if the normal humidity and stability checks have passed.'],
  ['E04', 4, 'An emergency hydration trial is allowed only when the seed coat is visibly cracked and the conservation lead has approved the trial in writing. A low germination estimate alone does not authorize hydration.'],
  ['E05', 5, 'The archive records the seven-day hold from the physical arrival of the sealed lot, not from the date when a clerk completes the accession form.'],
  ['E06', 6, 'Silver-plume reference envelopes contain twenty-four seeds. Removing seeds for a trial does not change the recorded original reference count.'],
  ['E07', 7, 'A transfer of the seed lot to another shelf must preserve the original accession identifier. A new shelf label is a location record, not a new accession.'],
  ['E08', 8, 'This handbook supplies procedural rules only. It reports no measured percentage improvement in germination and gives no annual survival-rate estimate.']
]

const chapterTitles = [
  'Arrival and accession', 'Humidity observations', 'Dormant collections', 'Hydration decisions',
  'Working calendars', 'Reference envelopes', 'Shelf transfers', 'Reading the limits'
]
const backgroundTopics = [
  ['ledger', 'receipt', 'tray'], ['probe', 'airflow', 'cabinet'], ['season', 'envelope', 'field notebook'],
  ['bench', 'coat', 'observation card'], ['calendar', 'arrival record', 'handover'],
  ['reference drawer', 'count sheet', 'sample bag'], ['shelf', 'locator', 'accession card'], ['index', 'margin note', 'reading desk']
]
export const chapters = chapterTitles.map((title, index) => {
  const [a, b, c] = backgroundTopics[index]
  const paragraphs = Array.from({ length: 32 }, (_, paragraph) =>
    `Practice observation ${index + 1}.${paragraph + 1}: the ${a} is described beside the ${b}, while the ${c} remains available for comparison. ` +
    'The recorder distinguishes an observation from an interpretation and keeps the original wording when making a second copy. ' +
    'A clean layout helps a reader locate a note, but the layout alone provides no biological evidence. ' +
    'Training examples describe imagined handling sessions and do not introduce a release deadline, an approval power, a storage threshold, or a biological performance claim. ' +
    `During this imagined session the recorder compares the left and right margins, checks the chapter heading, and writes a short description of the ${a}. ` +
    'Similar language elsewhere in the handbook is background explanation; operational decisions must use the explicit rule in the relevant chapter. ' +
    'The archive and the ridge nursery are separate working contexts, so readers should retain the name of the source whenever they compare a statement.'
  )
  paragraphs.splice(8 + index * 2, 0, archiveEvidence[index][2])
  return { number: index + 1, title, paragraphs }
})

export const pdfPages = [
  { number: 1, title: 'Dispatch scope and permissions', columns: [
    [
      'This is a fictional nursery dispatch addendum, not a biological recommendation. It governs courier transit after a parcel leaves Ridge Nursery.',
      'A silver-plume seed parcel has a normal courier transit limit of two days after dispatch. The archive seven-day internal hold must not be used as a courier limit.'
    ],
    [
      'A weather-delay extension requires the dispatch coordinator to record both the route closure and the revised receiving slot. Conservation-lead approval alone does not authorize a courier extension.',
      'The nursery uses sealed transit packs. This addendum does not change archive hydration permissions or accession identifiers.'
    ]
  ] },
  { number: 2, title: 'Table A: reserve packs and bench windows', table: {
    header: ['Cultivar', 'Reserve packs', 'Bench window (days)'],
    rows: [['Amber sedge', '16', '5']]
  }, paragraphs: [
    'Table A continues on the next page. Reserve packs are inventory quantities; bench windows describe elapsed time after the receiving bench signs for a parcel.',
    'A reserve pack contains four labelled envelopes. The reserve-pack count in the table is a count of packs, not of loose envelopes.'
  ] },
  { number: 3, title: 'Table A continued: read the footnote', table: {
    header: ['Cultivar', 'Reserve packs', 'Bench window (days)'],
    rows: [['Violet flax', '10', '9']]
  }, paragraphs: [
    'Footnote A: if the receiving bench is closed for instrument calibration, its bench-window clock pauses until that bench reopens. The courier transit clock continues to run.',
    'The calibration exception changes the bench-window clock only. It does not reduce or increase the reserve-pack quantities in Table A.'
  ] },
  { number: 4, title: 'Reconciliation and unknown outcomes', paragraphs: [
    'Before accepting a replacement delivery note, compare its accession identifiers with the original dispatch ledger, then reconcile the pack count, and only then mark the replacement note as accepted.',
    'A readable barcode alone is not sufficient for accepting a replacement delivery note.',
    'This addendum contains no observed germination improvement percentage, no measured loss rate for courier delays, and no instructions for a lunar-fern cultivar.'
  ] }
]

const digitalEvidence = [
  ['D01', 1, pdfPages[0].columns[0][1]],
  ['D02', 1, pdfPages[0].columns[1][0]],
  ['D03', 2, 'Amber sedge 16 5'],
  ['D04', 3, 'Violet flax 10 9'],
  ['D05', 3, pdfPages[2].paragraphs[0]],
  ['D06', 3, pdfPages[2].paragraphs[1]],
  ['D07', 4, pdfPages[3].paragraphs[0]],
  ['D08', 4, pdfPages[3].paragraphs[1]],
  ['D09', 4, pdfPages[3].paragraphs[2]],
  ['D10', 2, pdfPages[1].paragraphs[1]]
]
export const evidence = [
  ...archiveEvidence.map(([id, chapter, quote]) => ({ id, bookKey: 'epub', chapter, quote })),
  ...digitalEvidence.map(([id, page, quote]) => ({ id, bookKey: 'digital', page, quote })),
  ...digitalEvidence.map(([id, page, quote]) => ({ id: id.replace('D', 'S'), bookKey: 'scanned', page, quote }))
]

export const questions = [
  { id: 'I01', bookKeys: ['epub'], question: '银羽种子（silver-plume）普通批次达到干燥储存条件需要什么读数和持续时间？休眠野生来源批次能否仅凭这两项检查直接入库？', expectedEvidence: ['E02', 'E03'], expectedFacts: ['相对湿度不超过18%', '连续稳定12小时', '休眠野生批次仍须原通风信封留到季节审查'], answerable: true },
  { id: 'I02', bookKeys: ['epub'], question: '银羽种子（silver-plume）七天留置期从何时算起？档案员晚两天填完登记表，会改变起算点吗？', expectedEvidence: ['E01', 'E05'], expectedFacts: ['从密封批次实际到达起算', '登记完成日期不改变起算点'], answerable: true },
  { id: 'I03', bookKeys: ['epub'], question: '银羽种子（silver-plume）仅因为发芽率预估偏低，能否启动紧急补水试验（emergency hydration trial）？需要哪些条件？', expectedEvidence: ['E04'], expectedFacts: ['不能仅凭低发芽率预估', '种皮可见裂纹', '保育负责人书面批准'], answerable: true },
  { id: 'I04', bookKeys: ['epub'], question: '这本手册测得上述流程使发芽率提高了百分之多少？请给出测得数值。', expectedEvidence: ['E08'], expectedFacts: ['未报告测量的发芽率提升百分比', '不能编造具体数值'], answerable: false },
  { id: 'I05', bookKeys: ['digital'], question: '比较表A两页：琥珀莎草（Amber sedge）和紫罗兰亚麻（Violet flax）的储备包数及工作台窗口各是多少？哪个窗口长，长几天？', expectedEvidence: ['D03', 'D04'], expectedFacts: ['Amber sedge 16包5天', 'Violet flax 10包9天', '紫罗兰亚麻长4天'], answerable: true },
  { id: 'I06', bookKeys: ['digital'], question: '接收工作台因仪器校准关闭时，工作台窗口和快递运输两个计时是否都暂停？这会改变表A储备包数量吗？', expectedEvidence: ['D05', 'D06'], expectedFacts: ['仅工作台窗口暂停', '快递运输计时继续', '储备包数量不变'], answerable: true },
  { id: 'I07', bookKeys: ['digital'], question: '替换的配送单条码可读就可以接受吗？接受前的核对顺序是什么？', expectedEvidence: ['D07', 'D08'], expectedFacts: ['条码可读不充分', '先核对原始配送台账的登录标识', '再核对包数', '最后接受替换单'], answerable: true },
  { id: 'I08', bookKeys: ['scanned'], question: '扫描附录表A中，琥珀莎草（Amber sedge）的储备量折合多少个带标签信封？请区分包数和信封数。', expectedEvidence: ['S03', 'S10'], expectedFacts: ['16包', '每包4个信封', '合计64个信封'], answerable: true },
  { id: 'I09', bookKeys: ['scanned'], question: '扫描附录中，天气延误如何获准延长运输？只获保育负责人批准足够吗？', expectedEvidence: ['S02'], expectedFacts: ['配送协调员记录路线关闭', '记录修订接收时段', '仅保育负责人批准不够'], answerable: true },
  { id: 'I10', bookKeys: ['scanned'], question: '扫描附录测得快递延误的损耗率是多少？月蕨（lunar-fern）品种应留多少储备包？', expectedEvidence: ['S09'], expectedFacts: ['没有测得的延误损耗率', '没有月蕨品种规则', '不编造数值'], answerable: false },
  { id: 'I11', bookKeys: ['epub', 'digital'], question: '对照两本资料：银羽种子（silver-plume）的档案内部留置期和苗圃快递运输限时分别是多少、从何时起算？可以把七天用于快递运输吗？', expectedEvidence: ['E01', 'E05', 'D01'], expectedFacts: ['档案7天从密封批次实际到达起算', '快递2天从发运起算', '不能将档案7天混作快递限时'], answerable: true },
  { id: 'I12', bookKeys: ['epub', 'scanned'], question: '对照档案手册和扫描配送附录，紧急补水与天气延长运输分别由谁批准或记录、各需要什么条件？能互相替代吗？', expectedEvidence: ['E04', 'S02'], expectedFacts: ['补水须种皮裂纹和保育负责人书面批准', '延运须配送协调员记录路线关闭及新接收时段', '两类权限不能互相替代'], answerable: true }
]

/** Canonical fixture payload; hashes exclude generated filenames and timestamps. */
export const fixturePayload = { schemaVersion, fixtureTitle, sources, chapters, pdfPages, questions, evidence }
export const fixtureContract = { schemaVersion, fixtureTitle, sources, questions, evidence }
