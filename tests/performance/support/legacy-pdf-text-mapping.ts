interface PdfTextRun {
  rawStart: number
  rawEnd: number
  readableStart: number
  readableEnd: number
  separator: boolean
}

// Original linear mapping from d446f01, retained only for differential checks and benchmarks.
export function previousPdfTextOffset(runs: ReadonlyArray<PdfTextRun>, offset: number, source: 'raw' | 'readable', bias: 'start' | 'end'): number {
  const rawLength = runs.at(-1)?.rawEnd ?? 0
  const readableLength = runs.at(-1)?.readableEnd ?? 0
  const maximum = source === 'raw' ? rawLength : readableLength
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maximum) return bias === 'start' ? source === 'raw' ? readableLength : rawLength : 0
  const candidates: number[] = []
  if (source === 'raw') {
    for (const run of runs) {
      if (offset < run.rawStart) break
      if (offset > run.rawEnd) continue
      if (run.separator) candidates.push(run.readableStart, run.readableEnd)
      else candidates.push(run.readableStart + offset - run.rawStart)
    }
  } else {
    for (const run of runs) {
      if (offset < run.readableStart) break
      if (offset > run.readableEnd) continue
      if (run.separator) candidates.push(run.rawStart)
      else candidates.push(run.rawStart + offset - run.readableStart)
    }
  }
  if (candidates.length === 0) return offset === 0 ? 0 : source === 'raw' ? readableLength : rawLength
  return bias === 'start' ? Math.max(...candidates) : Math.min(...candidates)
}

export function syntheticPdfTextRuns(count: number): PdfTextRun[] {
  const runs: PdfTextRun[] = []
  for (let index = 0; index < count; index++) {
    runs.push({ rawStart: index * 3, rawEnd: index * 3 + 3, readableStart: index * 4, readableEnd: index * 4 + 3, separator: false })
    if (index + 1 < count) runs.push({ rawStart: index * 3 + 3, rawEnd: index * 3 + 3, readableStart: index * 4 + 3, readableEnd: index * 4 + 4, separator: true })
  }
  return runs
}
