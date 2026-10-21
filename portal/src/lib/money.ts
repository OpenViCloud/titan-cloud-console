import type { Lang } from '@/i18n/lang'

// Money and dates follow the language the reader picked (docs/features/cloud-console/design.md#portal-language):
// 900,000 ₫ in English, 900.000 ₫ in Vietnamese. Titan bills in VND (docs/architecture/money-and-wallet.md#money-is-long-vnd)
// — VND has no minor unit, so totals show no decimals and a "₫" suffix. A legacy/other currency falls back
// to the old prefix style so nothing renders as raw numbers if the backend ever returns non-VND.
const NUMBER_LOCALE: Record<Lang, string> = { en: 'en-US', vi: 'vi-VN' }

export function formatMoney(amount: number, lang: Lang, currency = 'VND'): string {
  if (currency === 'VND') {
    return `${Math.round(amount).toLocaleString(NUMBER_LOCALE[lang])} ₫`
  }
  return `${currency} $${amount.toFixed(2)}`
}

// Signed variant for statement/credit lines: keeps the leading sign for negative (spend) amounts.
export function formatSignedMoney(amount: number, lang: Lang, currency = 'VND'): string {
  const sign = amount < 0 ? '-' : '+'
  return `${sign}${formatMoney(Math.abs(amount), lang, currency)}`
}

// Hourly rates live below one đồng (a volume tier is 1.57914 ₫/GB/h), so formatMoney — which rounds
// VND to whole đồng — would render every storage rate as "2 ₫" and every price change as a no-op.
// Rates keep their decimals; totals keep whole đồng.
export function formatRate(rate: number, lang: Lang, currency = 'VND'): string {
  if (currency === 'VND') {
    return `${rate.toLocaleString(NUMBER_LOCALE[lang], { maximumFractionDigits: 6 })} ₫`
  }
  return `${currency} ${rate.toFixed(6)}`
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

// Vietnamese dates are built by hand: Intl's vi-VN short forms ("thg 9 2026", "05-01") are not what an
// invoice in Vietnam shows; 05/01/2026 and 09/2026 are.
export function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso)
  if (lang === 'vi') {
    return `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}/${date.getFullYear()}`
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatShortDate(iso: string, lang: Lang): string {
  const date = new Date(iso)
  if (lang === 'vi') {
    return `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}`
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// A billing period: month is 1-12.
export function formatMonth(year: number, month: number, lang: Lang): string {
  if (lang === 'vi') {
    return `${twoDigits(month)}/${year}`
  }
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string, lang: Lang): string {
  const date = new Date(iso)
  if (lang === 'vi') {
    return `${formatDate(iso, 'vi')} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  }
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Typed money is read the way the page shows it (900.000 ₫ in Vietnamese, 900,000 ₫ in English). Number() reads
// '500.000' as 500, so a top-up typed the Vietnamese way would ask for five hundred đồng.

// Plain digits, or groups of three after a first group of one to three, all split by the same mark.
const WHOLE_VND_GROUPED_BY_DOT = /^\d{1,3}(\.\d{3})+$/
const WHOLE_VND_GROUPED_BY_COMMA = /^\d{1,3}(,\d{3})+$/
const PLAIN_DIGITS = /^\d+$/

/** A whole-đồng amount with either grouping mark ('500.000', '500,000', '500000'); null when it is not one. */
export function parseWholeVnd(text: string): number | null {
  const trimmed = text.trim()
  const isPlain = PLAIN_DIGITS.test(trimmed)
  const isGrouped = WHOLE_VND_GROUPED_BY_DOT.test(trimmed) || WHOLE_VND_GROUPED_BY_COMMA.test(trimmed)
  if (!isPlain && !isGrouped) {
    return null
  }
  return Number(trimmed.replace(/[.,]/g, ''))
}

// A rate keeps decimals (1,57914 ₫ in Vietnamese), so only the language says which mark is the decimal one.
const RATE_PATTERN: Record<Lang, RegExp> = {
  vi: /^(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/,
  en: /^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/,
}

/** A non-negative rate typed with the decimal mark of the language; null when it is not one. */
export function parseRate(text: string, lang: Lang): number | null {
  const trimmed = text.trim()
  if (!RATE_PATTERN[lang].test(trimmed)) {
    return null
  }
  if (lang === 'vi') {
    return Number(trimmed.replace(/\./g, '').replace(',', '.'))
  }
  return Number(trimmed.replace(/,/g, ''))
}

/** The text a rate field starts with: no grouping, the decimal mark of the language, read back by parseRate. */
export function rateInputValue(rate: number, lang: Lang): string {
  const plain = String(rate)
  if (lang === 'vi') {
    return plain.replace('.', ',')
  }
  return plain
}
