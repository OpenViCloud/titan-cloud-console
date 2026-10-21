import { afterEach, describe, expect, it } from 'vitest'
import { applyThemeChoice, readThemeChoice, saveThemeChoice, THEME_STORAGE_KEY } from './theme'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k) },
    setItem: (k: string, v: string) => { data.set(k, v) },
  }
}

// Safari private mode and blocked site data throw on every access.
const throwingStorage = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('denied') },
  removeItem: () => { throw new Error('denied') },
} as unknown as Storage

describe('theme choice', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'))

  it('defaults to system when nothing is stored', () => {
    expect(readThemeChoice(memoryStorage())).toBe('system')
  })

  it('reads a stored light or dark choice', () => {
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light')
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('treats an unknown stored value as system', () => {
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('system')
  })

  it('falls back to system when storage throws, without crashing', () => {
    expect(readThemeChoice(throwingStorage)).toBe('system')
    expect(() => saveThemeChoice(throwingStorage, 'dark')).not.toThrow()
  })

  it('saves a choice and forgets it again for system', () => {
    const storage = memoryStorage()
    saveThemeChoice(storage, 'dark')
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    saveThemeChoice(storage, 'system')
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('sets data-theme for light and dark, and removes it for system so the OS decides', () => {
    const root = document.documentElement
    applyThemeChoice(root, 'dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    applyThemeChoice(root, 'light')
    expect(root.getAttribute('data-theme')).toBe('light')
    applyThemeChoice(root, 'system')
    expect(root.hasAttribute('data-theme')).toBe(false)
  })
})
