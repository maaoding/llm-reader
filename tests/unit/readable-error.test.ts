import { describe, expect, it } from 'vitest'
import { readableError } from '../../src/renderer/src/readable-error'

describe('readableError strips Electron IPC wrappers', () => {
  it('unwraps invoke errors down to the friendly message', () => {
    const error = new Error(
      "Error invoking remote method 'provider:models': Error: [PROVIDER_PROFILE_KEY_REQUIRED] 请先输入或保存这套配置的 API 密钥。"
    )
    expect(readableError(error, '操作失败')).toBe('请先输入或保存这套配置的 API 密钥。')
  })

  it('handles the wrapper without a colon after Error', () => {
    const error = new Error(
      "Error invoking remote method 'library:deleteBook': Error [PARSE_FAILED] 无法解析这本书。"
    )
    expect(readableError(error, '操作失败')).toBe('无法解析这本书。')
  })

  it('keeps plain renderer errors untouched', () => {
    expect(readableError(new Error('EPUB 渲染失败'), '操作失败')).toBe('EPUB 渲染失败')
  })

  it('falls back for non-errors and blank messages', () => {
    expect(readableError('boom', '操作失败')).toBe('操作失败')
    expect(readableError(new Error('   '), '操作失败')).toBe('操作失败')
  })
})
