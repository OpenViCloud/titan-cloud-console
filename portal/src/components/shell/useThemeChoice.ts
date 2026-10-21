import { useState } from 'react'
import { applyThemeChoice, readThemeChoice, saveThemeChoice, type ThemeChoice } from '@/lib/theme'

// Reading window.localStorage itself throws when site data is blocked.
function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const storage = browserStorage()
    if (storage === null) {
      return 'system'
    }
    return readThemeChoice(storage)
  })

  function choose(next: ThemeChoice) {
    const storage = browserStorage()
    if (storage !== null) {
      saveThemeChoice(storage, next)
    }
    applyThemeChoice(document.documentElement, next)
    setChoice(next)
  }

  return [choice, choose]
}
