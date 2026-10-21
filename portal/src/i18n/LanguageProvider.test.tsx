import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLang, useT, type CountryDetector } from './LanguageContext'
import { LanguageProvider } from './LanguageProvider'
import { LANG_STORAGE_KEY } from './lang'

function Probe() {
  const t = useT()
  const { setLang } = useLang()
  return (
    <div>
      <p data-testid="nav">{t.nav.overview}</p>
      <button type="button" onClick={() => setLang('vi')}>vi</button>
    </div>
  )
}

// A detector the test answers by hand, to put a pick before or after the trace.
function deferredCountry(): { detect: CountryDetector; answer: (country: string | null) => Promise<void> } {
  let resolve: (country: string | null) => void = () => {}
  const promise = new Promise<string | null>(r => { resolve = r })
  return {
    detect: () => promise,
    answer: async country => {
      await act(async () => {
        resolve(country)
        await promise
      })
    },
  }
}

describe('LanguageProvider', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('starts in English with nothing saved and no country', async () => {
    const trace = deferredCountry()
    render(<LanguageProvider detectCountry={trace.detect}><Probe /></LanguageProvider>)
    await trace.answer(null)
    expect(screen.getByTestId('nav').textContent).toBe('Overview')
    expect(document.documentElement.lang).toBe('en')
  })

  it('switches a first visit from Vietnam to Vietnamese without saving the guess', async () => {
    const trace = deferredCountry()
    render(<LanguageProvider detectCountry={trace.detect}><Probe /></LanguageProvider>)
    await trace.answer('VN')
    expect(screen.getByTestId('nav').textContent).toBe('Tổng quan')
    expect(document.documentElement.lang).toBe('vi')
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBeNull()
  })

  it('keeps a saved choice and does not ask for the country', () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'vi')
    let asked = false
    const detect: CountryDetector = async () => {
      asked = true
      return 'US'
    }
    render(<LanguageProvider detectCountry={detect}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('nav').textContent).toBe('Tổng quan')
    expect(asked).toBe(false)
  })

  it('lets a pick made while the trace is in flight win over the trace', async () => {
    const trace = deferredCountry()
    render(<LanguageProvider detectCountry={trace.detect}><Probe /></LanguageProvider>)
    await act(async () => {
      screen.getByRole('button', { name: 'vi' }).click()
    })
    await trace.answer('US')
    expect(screen.getByTestId('nav').textContent).toBe('Tổng quan')
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('vi')
  })
})
