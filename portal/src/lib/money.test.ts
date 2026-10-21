import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatMoney, formatMonth, formatRate, formatShortDate, formatSignedMoney, parseRate, parseWholeVnd, rateInputValue } from './money'

describe('money follows the language', () => {
  it('uses English separators in English and Vietnamese ones in Vietnamese', () => {
    expect(formatMoney(900000, 'en')).toBe('900,000 ₫')
    expect(formatMoney(900000, 'vi')).toBe('900.000 ₫')
  })

  it('rounds to whole đồng in both languages', () => {
    expect(formatMoney(1234.6, 'en')).toBe('1,235 ₫')
    expect(formatMoney(1234.6, 'vi')).toBe('1.235 ₫')
  })

  it('keeps the sign on statement lines', () => {
    expect(formatSignedMoney(-5000, 'en')).toBe('-5,000 ₫')
    expect(formatSignedMoney(5000, 'vi')).toBe('+5.000 ₫')
  })

  it('keeps the decimals of a rate', () => {
    expect(formatRate(1.57914, 'en')).toBe('1.57914 ₫')
    expect(formatRate(1.57914, 'vi')).toBe('1,57914 ₫')
  })

  it('falls back to a prefixed amount for a currency that is not VND', () => {
    expect(formatMoney(12.5, 'en', 'USD')).toBe('USD $12.50')
  })
})

describe('dates follow the language', () => {
  // Noon UTC is the same calendar day in every time zone from UTC-11 to UTC+11.
  const day = '2026-01-05T12:00:00Z'

  it('writes a day as Jan 5, 2026 in English and 05/01/2026 in Vietnamese', () => {
    expect(formatDate(day, 'en')).toBe('Jan 5, 2026')
    expect(formatDate(day, 'vi')).toBe('05/01/2026')
  })

  it('writes a day without the year', () => {
    expect(formatShortDate(day, 'en')).toBe('Jan 5')
    expect(formatShortDate(day, 'vi')).toBe('05/01')
  })

  it('writes a billing month as Sep 2026 in English and 09/2026 in Vietnamese', () => {
    expect(formatMonth(2026, 9, 'en')).toBe('Sep 2026')
    expect(formatMonth(2026, 9, 'vi')).toBe('09/2026')
  })

  it('writes a timestamp with hours and minutes', () => {
    expect(formatDateTime(day, 'en')).toMatch(/^Jan 5, 2026, \d\d:\d\d (AM|PM)$/)
    expect(formatDateTime(day, 'vi')).toMatch(/^05\/01\/2026 \d\d:\d\d$/)
  })
})

// docs/features/cloud-console/design.md#portal-language: the page shows 500.000 ₫ in Vietnamese, so a reader types
// it that way. Number('500.000') is 500 — the old reading — and these pin the new one.
describe('typed money follows the way the page shows it', () => {
  it('reads a whole-đồng amount with either grouping mark', () => {
    expect(parseWholeVnd('500.000')).toBe(500000)
    expect(parseWholeVnd('500,000')).toBe(500000)
    expect(parseWholeVnd('500000')).toBe(500000)
    expect(parseWholeVnd(' 1.250.000 ')).toBe(1250000)
    expect(parseWholeVnd('0')).toBe(0)
  })

  it('refuses what is not a whole-đồng amount', () => {
    expect(parseWholeVnd('')).toBeNull()
    expect(parseWholeVnd('5a0')).toBeNull()
    expect(parseWholeVnd('-5')).toBeNull()
    // VND has no decimals: a mark not followed by exactly three digits is not grouping.
    expect(parseWholeVnd('1.5')).toBeNull()
    expect(parseWholeVnd('1,50')).toBeNull()
    expect(parseWholeVnd('1..000')).toBeNull()
  })

  it('reads a rate with the decimal mark of the language', () => {
    expect(parseRate('161,388', 'vi')).toBe(161.388)
    expect(parseRate('1.234,5', 'vi')).toBe(1234.5)
    expect(parseRate('161.388', 'en')).toBe(161.388)
    expect(parseRate('1,234.5', 'en')).toBe(1234.5)
    expect(parseRate('2', 'vi')).toBe(2)
  })

  it('refuses a rate that is not a number', () => {
    expect(parseRate('', 'en')).toBeNull()
    expect(parseRate('abc', 'vi')).toBeNull()
    expect(parseRate('1,2,3', 'vi')).toBeNull()
    expect(parseRate('-1', 'en')).toBeNull()
  })

  it('seeds a rate field the way the language types it, and reads it back unchanged', () => {
    expect(rateInputValue(1.57914, 'vi')).toBe('1,57914')
    expect(rateInputValue(1.57914, 'en')).toBe('1.57914')
    expect(rateInputValue(1234.5, 'vi')).toBe('1234,5')
    expect(parseRate(rateInputValue(1.57914, 'vi'), 'vi')).toBe(1.57914)
    expect(parseRate(rateInputValue(1234.5, 'en'), 'en')).toBe(1234.5)
  })
})
