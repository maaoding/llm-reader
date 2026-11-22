import { Fragment } from 'react'
import { LoaderCircle, Search, SearchX } from 'lucide-react'
import type { SemanticSearchFallbackReason } from '@shared/contracts'
import { copy, type CopyKey, type UiLanguage } from '@shared/copy'
import { READER_SEARCH_QUERY_MAX_LENGTH, READER_SEARCH_RESULT_LIMIT, splitSearchExcerpt } from '@shared/reader-search'
import { EmptyState } from './EmptyState'
import { readerTitle, type ReaderSearchResult } from './readers/types'
import type { ReaderSearchController } from './use-reader-search'

const fallbackCopy = {
  disabled: 'reader.semanticDisabled',
  'document-not-ready': 'reader.semanticDocumentUnavailable',
  'index-not-ready': 'reader.semanticIndexUnavailable',
  changed: 'reader.semanticChanged',
  dimension: 'reader.semanticDimensions',
  timeout: 'reader.semanticTimeout',
  'service-error': 'reader.semanticUnavailable'
} as const satisfies Record<SemanticSearchFallbackReason, CopyKey>

export function ReaderSearchPanel({ search, onNavigate, uiLanguage }: {
  search: ReaderSearchController
  onNavigate: (result: ReaderSearchResult) => void
  uiLanguage: UiLanguage
}) {
  const {
    searchQuery, searchInputRef, searchMode, resultMode, fallbackReason, searchNotice, searchState, searchError,
    searchResults, executedSearchQuery, setSearchMode, setSearchQuery, submitSearch, cancelSearch
  } = search
  return <div className="reader-search" data-testid="reader-search" aria-label={copy('reader.searchTitle')}>
    <div className="reader-search-heading"><h2>{copy('reader.searchTitle')}</h2></div>
    <div className="reader-search-modes" role="group" aria-label={copy('reader.searchModeAria')}>
      <button type="button" data-testid="reader-search-text-mode" aria-pressed={searchMode === 'text'}
        onClick={() => setSearchMode('text')}>{copy('reader.searchTextMode')}</button>
      <button type="button" data-testid="reader-search-semantic-mode" aria-pressed={searchMode === 'semantic'}
        onClick={() => setSearchMode('semantic')}>{copy('reader.searchSemanticMode')}</button>
    </div>
    <form className="reader-search-form" onSubmit={submitSearch}>
      <input ref={searchInputRef} data-testid="reader-search-input" value={searchQuery}
        aria-label={copy('reader.searchInputAria')}
        aria-describedby={searchMode === 'semantic' ? 'reader-semantic-disclosure' : undefined}
        placeholder={copy(searchMode === 'semantic' ? 'reader.semanticPlaceholder' : 'reader.searchPlaceholder')}
        onChange={(event) => setSearchQuery(Array.from(event.target.value).slice(0, READER_SEARCH_QUERY_MAX_LENGTH).join(''))} />
      <button data-testid="reader-search-submit" type="submit" disabled={searchState === 'searching'}
        aria-label={copy('reader.searchSubmit')} title={copy('reader.searchSubmit')}><Search size={15} /></button>
    </form>
    {searchMode === 'semantic' && <p className="reader-semantic-hint" id="reader-semantic-disclosure">{copy('reader.semanticDisclosure')}</p>}
    <div className="reader-search-status" aria-live="polite">
      {fallbackReason && <p className="reader-search-fallback" data-testid="reader-search-fallback">
        {copy(fallbackCopy[fallbackReason])} {copy('reader.semanticFallback')}
      </p>}
      {searchNotice && <span>{copy(searchNotice === 'changed' ? 'reader.semanticRetry' : 'reader.searchCanceled')}</span>}
      {searchState === 'searching' && <div className="reader-search-progress">
        <LoaderCircle className="spin" size={15} />{copy(resultMode === 'semantic' ? 'reader.semanticLoading' : 'reader.searchLoading')}
        <button type="button" className="text-button" data-testid="reader-search-cancel" onClick={cancelSearch}>{copy('reader.searchCancel')}</button>
      </div>}
      {searchState === 'error' && <span role="alert">{searchError}</span>}
      {searchState === 'ready' && resultMode === 'semantic' && <span data-testid="reader-semantic-result-mode">{copy('reader.semanticResultCount', { count: searchResults.length })}</span>}
      {searchState === 'ready' && resultMode === 'text' && searchResults.length > 0 && <span>{copy(
        searchResults.length >= READER_SEARCH_RESULT_LIMIT ? 'reader.searchResultLimit' : 'reader.searchResultCount',
        { count: searchResults.length }
      )}</span>}
    </div>
    {searchState === 'ready' && searchResults.length === 0 && <EmptyState icon={<SearchX size={20} />}
      title={copy('reader.searchNoResultsTitle')} detail={copy(resultMode === 'semantic' ? 'reader.semanticEmptyDetail' : 'reader.searchNoResultsDetail')} />}
    <div className="reader-search-results" data-testid="reader-search-results">
      {searchResults.map((result, index) => {
        const location = readerTitle(result.chapterTitleCopy ?? result.chapterTitle, uiLanguage)
        const label = resultMode === 'semantic' && result.chapterTitle && result.chapterTitle !== location
          ? `${location} · ${result.chapterTitle}` : location || copy('common.currentChapter')
        return <button className="reader-search-result" data-testid="reader-search-result" type="button"
          key={`${result.anchor}-${index}`} onClick={() => onNavigate(result)}>
          <span title={label}>{label}</span>
          <p title={resultMode === 'semantic' ? result.excerpt : undefined}>
            {splitSearchExcerpt(result.excerpt, executedSearchQuery).map((segment, segmentIndex) => (
              segment.hit ? <mark key={segmentIndex}>{segment.text}</mark> : <Fragment key={segmentIndex}>{segment.text}</Fragment>
            ))}
          </p>
        </button>
      })}
    </div>
  </div>
}
