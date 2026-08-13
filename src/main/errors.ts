import { copy } from '@shared/copy'

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AppError'
  }
}

export function toPublicError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  return new AppError('INTERNAL_ERROR', copy('error.internal'))
}
