import { useEffect, useRef, useState, type ReactNode } from 'react'
import { browserStorage, initialLang, readSavedLang, saveLang, type Lang } from './lang'
import { fetchTraceCountry, LanguageContext, type CountryDetector } from './LanguageContext'

const TRACE_TIMEOUT_MS = 1500

export function LanguageProvider({
  children,
  detectCountry = fetchTraceCountry,
}: {
  children: ReactNode
  detectCountry?: CountryDetector
}) {
  const [lang, setLangState] = useState<Lang>(() => initialLang(readSavedLang(browserStorage()), null))
  // A pick made while the trace is in flight wins over the trace, even when storage is blocked.
  const picked = useRef(false)

  useEffect(() => {
    if (readSavedLang(browserStorage()) !== null) {
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS)
    detectCountry(controller.signal).then(country => {
      // No country (aborted, no Cloudflare, not a trace) keeps the English the page started in.
      if (country === null) {
        return
      }
      if (picked.current || readSavedLang(browserStorage()) !== null) {
        return
      }
      // The guess is not saved: a later visit from abroad gets English again.
      setLangState(initialLang(null, country))
    })
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [detectCountry])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  function setLang(next: Lang) {
    picked.current = true
    saveLang(browserStorage(), next)
    setLangState(next)
  }

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>
}
