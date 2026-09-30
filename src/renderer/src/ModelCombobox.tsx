import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { copy } from '@shared/copy'

export function ModelCombobox({ value, options, disabled, onChange }: {
  value: string
  options: string[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const query = value.trim().toLocaleLowerCase()
  const suggestions = showAll ? options : options.filter((option) => option.toLocaleLowerCase().includes(query))
  const expanded = open && !disabled && suggestions.length > 0
  const activeOption = expanded && activeIndex >= 0 && activeIndex < suggestions.length ? activeIndex : -1
  const close = (): void => { setOpen(false); setActiveIndex(-1) }
  const choose = (option: string): void => { onChange(option); close(); inputRef.current?.focus({ preventScroll: true }) }

  useLayoutEffect(() => {
    const input = inputRef.current, list = listRef.current
    if (!input || !list) return
    if (!expanded) { list.hidePopover(); return }
    list.showPopover()
    const place = (): void => {
      const rect = input.getBoundingClientRect()
      const above = rect.top - 12, below = window.innerHeight - rect.bottom - 12
      const down = below >= Math.min(240, list.scrollHeight) || below >= above
      list.style.width = `${Math.min(rect.width, window.innerWidth - 24)}px`
      list.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - list.offsetWidth - 12))}px`
      list.style.maxHeight = `${Math.max(0, Math.min(360, (down ? below : above) - 4))}px`
      list.style.top = down ? `${rect.bottom + 4}px` : 'auto'
      list.style.bottom = down ? 'auto' : `${window.innerHeight - rect.top + 4}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(input)
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [expanded, suggestions.length])

  useLayoutEffect(() => {
    const list = listRef.current
    const option = activeOption >= 0 ? list?.children[activeOption] : null
    if (!list || !option) return
    // 只滚动候选列表，不牵动背后的设置页。
    const bounds = list.getBoundingClientRect(), item = option.getBoundingClientRect()
    if (item.top < bounds.top + 4) list.scrollTop -= bounds.top + 4 - item.top
    else if (item.bottom > bounds.bottom - 4) list.scrollTop += item.bottom - bounds.bottom + 4
  }, [activeOption])

  return <div className="model-combobox" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close()
  }}>
    <input id="provider-model" data-testid="provider-model" ref={inputRef} role="combobox" value={value}
      aria-autocomplete="list" aria-controls="provider-model-options" aria-expanded={expanded}
      aria-activedescendant={activeOption >= 0 ? `provider-model-option-${activeOption}` : undefined}
      onChange={(event) => { onChange(event.target.value); setShowAll(false); setActiveIndex(-1); setOpen(true) }}
      onClick={() => { setShowAll(false); setOpen(true) }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
          const direction = event.key === 'ArrowDown' ? 1 : -1
          setActiveIndex((index) => !expanded || index < 0 ? (direction > 0 ? 0 : suggestions.length - 1) : (index + direction + suggestions.length) % suggestions.length)
        } else if (event.key === 'Enter' && activeOption >= 0) {
          event.preventDefault()
          event.stopPropagation()
          choose(suggestions[activeOption])
        } else if (event.key === 'Escape' && expanded) {
          event.preventDefault()
          event.stopPropagation()
          close()
        } else if (event.key === 'Tab') close()
      }}
      disabled={disabled} placeholder={copy('settings.modelPlaceholder')} autoComplete="off" spellCheck={false} required />
    {options.length > 0 && <button type="button" className="model-combobox-toggle" data-testid="provider-model-options-toggle"
      aria-label={copy('settings.modelSuggestions')} aria-controls="provider-model-options" aria-expanded={expanded} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={() => {
        inputRef.current?.focus()
        if (expanded) close()
        else { setShowAll(true); setActiveIndex(-1); setOpen(true) }
      }}><ChevronDown size={15} aria-hidden="true" /></button>}
    <div id="provider-model-options" ref={listRef} popover="auto" role="listbox" className="ui-suggestion-list"
      aria-label={copy('settings.modelSuggestions')} onToggle={(event) => {
        if (event.newState === 'closed') close()
      }}>
      {suggestions.map((option, index) => <div key={option} id={`provider-model-option-${index}`} role="option"
        aria-selected={option === value} data-active={activeOption === index} className="ui-suggestion-option"
        onPointerMove={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
        <span>{option}</span><span className="ui-option-check" aria-hidden="true">✓</span>
      </div>)}
    </div>
  </div>
}
