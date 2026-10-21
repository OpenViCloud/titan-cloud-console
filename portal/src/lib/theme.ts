// Light or dark follows the OS unless the user picks one in the account menu. The pick is per browser.
// index.html runs the same read before first paint, so keep the key and values in step.
export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ovc-theme'

export function readThemeChoice(storage: Storage): ThemeChoice {
  let stored: string | null = null
  try {
    stored = storage.getItem(THEME_STORAGE_KEY)
  } catch {
    return 'system'
  }
  if (stored === 'light' || stored === 'dark') {
    return stored
  }
  return 'system'
}

export function saveThemeChoice(storage: Storage, choice: ThemeChoice): void {
  try {
    if (choice === 'system') {
      storage.removeItem(THEME_STORAGE_KEY)
    } else {
      storage.setItem(THEME_STORAGE_KEY, choice)
    }
  } catch {
    // Storage blocked: the choice still applies to this page, it just is not remembered.
  }
}

export function applyThemeChoice(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
}
