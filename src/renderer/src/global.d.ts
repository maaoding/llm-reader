import type { ReaderApi } from '@shared/contracts'

declare global {
  interface Window {
    readerApi: ReaderApi
  }
}

export {}
