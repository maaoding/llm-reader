const IPC_WRAPPER_PATTERN = /^Error invoking remote method '[^']*':\s*(?:Error:\s*|Error\s+)?/
const ERROR_CODE_PATTERN = /^\[[A-Z0-9_-]+\]\s*/

export function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const message = error.message.replace(IPC_WRAPPER_PATTERN, '').replace(ERROR_CODE_PATTERN, '').trim()
  return message || fallback
}
