import type { ReactNode } from 'react'
import { LanguageContext } from '@/i18n/LanguageContext'
import type { Lang } from '@/i18n/lang'

// A fixed language for a test: the page reads it like the real provider's, without storage or the trace.
export function FixedLanguage({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LanguageContext.Provider value={{ lang, setLang: () => {} }}>{children}</LanguageContext.Provider>
}
