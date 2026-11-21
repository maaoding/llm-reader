// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import React from 'react'
import { BookAnalysisControls } from '../../src/renderer/src/BookAnalysisControls'
import type { BookAnalysisState, BookRecord, ProviderOverview } from '../../src/shared/contracts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('allows chapter notes with a saved custom authentication header and no API key', async () => {
  vi.stubGlobal('React', React)
  const book = { id: 'book', title: '样本', format: 'txt' } as BookRecord
  const state = { status: 'empty', document: { status: 'ready', total: 0, diagnostics: [] } } as unknown as BookAnalysisState
  const profiles = { activeProfileId: 'header-only', profiles: [{ id: 'header-only', name: 'Header auth', baseUrl: 'https://fixture.example', model: 'fixture', hasApiKey: false, hasCustomHeaders: true }] } as ProviderOverview
  const start = vi.fn(async () => undefined)
  render(<BookAnalysisControls book={book} state={state} profiles={profiles} onStart={start} onCancel={vi.fn()} onPrepare={vi.fn()} onCancelPreparation={vi.fn()} onConfigure={vi.fn()} />)
  expect((screen.getByTestId('analysis-profile').querySelector('option[value="header-only"]') as HTMLOptionElement).disabled).toBe(false)
  const button = screen.getByTestId('analysis-start') as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  expect(start).toHaveBeenCalledWith('header-only', false)
})
