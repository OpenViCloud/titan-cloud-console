// What the server accepts and what a VM gets when none is set (titan-ops features/vm/design.md#vm-stop-timeout).
export const STOP_TIMEOUT_DEFAULT = 120
export const STOP_TIMEOUT_MIN = 30
export const STOP_TIMEOUT_MAX = 1800

// The typed text as whole seconds, or null when it is not a whole number in the accepted range.
export function parseStopTimeout(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const seconds = Number(trimmed)
  if (seconds < STOP_TIMEOUT_MIN || seconds > STOP_TIMEOUT_MAX) {
    return null
  }
  return seconds
}
