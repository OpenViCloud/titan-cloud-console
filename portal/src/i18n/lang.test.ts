import { describe, expect, it } from 'vitest'
import { countryFromTrace, initialLang, LANG_STORAGE_KEY, readSavedLang, saveLang, signinArgs } from './lang'

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

describe('language choice', () => {
  it('reads a saved en or vi and nothing else', () => {
    expect(readSavedLang(memoryStorage({ [LANG_STORAGE_KEY]: 'vi' }))).toBe('vi')
    expect(readSavedLang(memoryStorage({ [LANG_STORAGE_KEY]: 'en' }))).toBe('en')
    expect(readSavedLang(memoryStorage({ [LANG_STORAGE_KEY]: 'fr' }))).toBeNull()
    expect(readSavedLang(memoryStorage())).toBeNull()
  })

  it('treats blocked storage as nothing saved, and saving into it does not throw', () => {
    expect(readSavedLang(throwingStorage)).toBeNull()
    expect(readSavedLang(null)).toBeNull()
    expect(() => saveLang(throwingStorage, 'vi')).not.toThrow()
    expect(() => saveLang(null, 'vi')).not.toThrow()
  })

  it('saves under the key the next visit reads', () => {
    const storage = memoryStorage()
    saveLang(storage, 'vi')
    expect(storage.getItem(LANG_STORAGE_KEY)).toBe('vi')
    expect(readSavedLang(storage)).toBe('vi')
  })

  it('reads the country from the loc line of the trace', () => {
    expect(countryFromTrace('fl=1\nip=1.2.3.4\nloc=VN\ncolo=SIN\n')).toBe('VN')
    expect(countryFromTrace('loc=US')).toBe('US')
    expect(countryFromTrace('<html>404</html>')).toBeNull()
    expect(countryFromTrace('')).toBeNull()
  })

  it.each([
    [null, 'VN', 'vi'],
    [null, 'US', 'en'],
    [null, null, 'en'],
    ['en', 'VN', 'en'],
    ['vi', 'US', 'vi'],
  ] as const)('saved=%s country=%s starts in %s', (saved, country, expected) => {
    expect(initialLang(saved, country)).toBe(expected)
  })
})

describe('signinArgs', () => {
  it('passes the saved language to Keycloak', () => {
    expect(signinArgs(memoryStorage({ [LANG_STORAGE_KEY]: 'vi' }))).toEqual({ ui_locales: 'vi' })
    expect(signinArgs(memoryStorage({ [LANG_STORAGE_KEY]: 'en' }))).toEqual({ ui_locales: 'en' })
  })

  it('sends no language when nothing is saved, so Keycloak follows the browser', () => {
    expect(signinArgs(memoryStorage())).toEqual({})
    expect(signinArgs(memoryStorage({ [LANG_STORAGE_KEY]: 'fr' }))).toEqual({})
    expect(signinArgs(null)).toEqual({})
    expect(signinArgs(throwingStorage as unknown as Storage)).toEqual({})
  })
})
