import type { Passage } from '@shared/contracts'

export function EvidenceSources({ passages, onNavigate }: { passages: Passage[]; onNavigate: (anchor: string, title?: string) => void }) {
  return passages.map((passage) => {
    const pages = [...new Map(passage.sources?.filter((source) => source.page).map((source) => [source.page!, source]) ?? []).values()]
    const wholeTable = passage.sources?.some((source) => source.precision === 'table')
    return <div key={passage.id} className="answer-source-item">
      <button type="button" onClick={() => onNavigate(passage.anchor, passage.chapterTitle)}>{passage.headingPath?.length ? `${passage.headingPath.join(' / ')}：` : passage.chapterTitle ? `${passage.chapterTitle}：` : ''}{Array.from(passage.text).slice(0, 60).join('')}</button>
      {pages.length > 0 && <div className="answer-source-pages">
        {wholeTable && <small>整表页范围，未确定行级页码。</small>}
        {pages.map((source) => <button key={source.page} type="button" onClick={() => onNavigate(source.anchor, passage.chapterTitle)}>第 {source.page} 页</button>)}
      </div>}
    </div>
  })
}
