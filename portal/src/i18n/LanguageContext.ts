import { createContext, useContext } from 'react'
import { countryFromTrace, type Lang } from './lang'
import { en, type Messages } from './en'
import { vi } from './vi'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatRate,
  formatShortDate,
  formatSignedMoney,
} from '@/lib/money'

interface LanguageState {
  lang: Lang
  setLang: (lang: Lang) => void
}

// Without a provider (most component tests) the portal is English and the switch does nothing.
export const LanguageContext = createContext<LanguageState>({ lang: 'en', setLang: () => {} })

// Same-origin Cloudflare trace (docs/features/customer-portal/design.md#portal-language). Anything but a
// trace with a loc= line — no Cloudflare in front, the SPA fallback page, a timeout — means no country.
export type CountryDetector = (signal: AbortSignal) => Promise<string | null>

export async function fetchTraceCountry(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch('/cdn-cgi/trace', { signal })
    if (!response.ok) {
      return null
    }
    return countryFromTrace(await response.text())
  } catch {
    return null
  }
}

export function useLang(): LanguageState {
  return useContext(LanguageContext)
}

export function messagesFor(lang: Lang): Messages {
  if (lang === 'vi') {
    return vi
  }
  return en
}

export function useT(): Messages {
  return messagesFor(useContext(LanguageContext).lang)
}

export interface Format {
  money: (amount: number, currency?: string) => string
  signedMoney: (amount: number, currency?: string) => string
  rate: (rate: number, currency?: string) => string
  date: (iso: string) => string
  shortDate: (iso: string) => string
  month: (year: number, month: number) => string
  dateTime: (iso: string) => string
}

export function formatFor(lang: Lang): Format {
  return {
    money: (amount, currency) => formatMoney(amount, lang, currency),
    signedMoney: (amount, currency) => formatSignedMoney(amount, lang, currency),
    rate: (rate, currency) => formatRate(rate, lang, currency),
    date: iso => formatDate(iso, lang),
    shortDate: iso => formatShortDate(iso, lang),
    month: (year, month) => formatMonth(year, month, lang),
    dateTime: iso => formatDateTime(iso, lang),
  }
}

export function useFormat(): Format {
  return formatFor(useContext(LanguageContext).lang)
}
