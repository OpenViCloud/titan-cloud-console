// Which language the portal shows (docs/features/cloud-console/design.md#portal-language): English unless the
// user picked Vietnamese in the account menu; with nothing picked, a first visit from Vietnam starts in
// Vietnamese. The pick is per browser (same rule as the public site, docs/features/public-site/design.md#site-language).
export type Lang = 'en' | 'vi'

export const LANG_STORAGE_KEY = 'ovc-lang'

export function readSavedLang(storage: Storage | null): Lang | null {
  if (storage === null) {
    return null
  }
  let value: string | null = null
  try {
    value = storage.getItem(LANG_STORAGE_KEY)
  } catch {
    return null
  }
  if (value === 'en' || value === 'vi') {
    return value
  }
  return null
}

// Reading window.localStorage itself throws when site data is blocked.
export function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// Keycloak's login page in the language the user picked; with no pick it follows the browser, since the portal's
// guess by country is not known yet when an unsigned visitor is sent to Keycloak
// (docs/features/cloud-console/design.md#login-page).
export function signinArgs(storage: Storage | null): { ui_locales?: Lang } {
  const saved = readSavedLang(storage)
  if (saved === null) {
    return {}
  }
  return { ui_locales: saved }
}

export function saveLang(storage: Storage | null, lang: Lang): void {
  if (storage === null) {
    return
  }
  try {
    storage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // Storage blocked: the choice applies to this page, it is just not remembered.
  }
}

export function countryFromTrace(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.startsWith('loc=')) {
      const country = line.slice('loc='.length).trim()
      if (/^[A-Z]{2}$/.test(country)) {
        return country
      }
      return null
    }
  }
  return null
}

// A saved choice wins; the country only decides when nothing is saved, and the guess is not saved.
export function initialLang(saved: Lang | null, country: string | null): Lang {
  if (saved !== null) {
    return saved
  }
  if (country === 'VN') {
    return 'vi'
  }
  return 'en'
}
