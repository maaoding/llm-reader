import { describe, expect, it } from 'vitest'
import { parseInstalledFontOutput } from '../../src/main/fonts'

describe('installed font output parsing', () => {
  it('trims lines, drops blanks, dedupes and keeps a stable localized order', () => {
    const output = '微软雅黑\r\n宋体\n\r\n微软雅黑\n  KaiTi  \nArial\n'
    const result = parseInstalledFontOutput(output)

    expect(result).toHaveLength(4)
    expect(new Set(result)).toEqual(new Set(['微软雅黑', '宋体', 'KaiTi', 'Arial']))
    expect(result).toEqual([...result].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')))
  })

  it('returns an empty list for empty or blank output', () => {
    expect(parseInstalledFontOutput('')).toEqual([])
    expect(parseInstalledFontOutput('\r\n \n\t')).toEqual([])
  })
})
