import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { FixedLanguage } from '@/test/FixedLanguage'
import { LanguageProvider } from '@/i18n/LanguageProvider'
import { LegalTermsPage } from './LegalTermsPage'

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>)
}

describe('LegalTermsPage', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  // AC1/AC3 — the public document renders its title, version, effective date and body content.
  it('renders the document title, version and content', async () => {
    server.use(http.get('*/v1/legal/document', () =>
      HttpResponse.json({
        key: 'terms',
        version: 'v0-placeholder',
        title: 'Terms of Service',
        content: 'PLACEHOLDER — section 1, 2, 3, 4',
        effectiveAt: '2026-09-01T00:00:00Z',
        lang: 'en',
      })))

    const { getByTestId } = wrap(<LegalTermsPage />)

    await waitFor(() => expect(getByTestId('legal-terms')).toBeTruthy())
    expect(getByTestId('legal-terms').textContent).toContain('Terms of Service')
    expect(getByTestId('legal-version').textContent).toContain('v0-placeholder')
    expect(getByTestId('legal-terms').textContent).toContain('PLACEHOLDER — section 1, 2, 3, 4')
  })

  // The text comes in the reader's language; both carry the same version, so either one can be accepted.
  it.each([
    ['en', 'Terms of Service', 'Version v1 · Effective Sep 1, 2026'],
    ['vi', 'Điều khoản dịch vụ', 'Phiên bản v1 · Hiệu lực 01/09/2026'],
  ] as const)('asks for the %s text and labels it in that language', async (lang, title, versionLine) => {
    const asked: (string | null)[] = []
    server.use(http.get('*/v1/legal/document', ({ request }) => {
      const requested = new URL(request.url).searchParams.get('lang')
      asked.push(requested)
      return HttpResponse.json({
        key: 'terms', version: 'v1', title, content: 'body', effectiveAt: '2026-09-01T12:00:00Z', lang: requested,
      })
    }))

    const { getByTestId } = wrap(<FixedLanguage lang={lang}><LegalTermsPage /></FixedLanguage>)

    await waitFor(() => expect(getByTestId('legal-terms')).toBeTruthy())
    expect(asked).toEqual([lang])
    expect(getByTestId('legal-terms').querySelector('h1')?.textContent).toBe(title)
    expect(getByTestId('legal-version').textContent).toBe(versionLine)
  })

  // The query is keyed by language: switching while the page is open shows the other text, not the cached one.
  it('shows the other text when the reader switches language on the page', async () => {
    server.use(http.get('*/v1/legal/document', ({ request }) => {
      const requested = new URL(request.url).searchParams.get('lang')
      const title = requested === 'vi' ? 'Điều khoản dịch vụ' : 'Terms of Service'
      return HttpResponse.json({ key: 'terms', version: 'v1', title, content: 'body', effectiveAt: '2026-09-01T12:00:00Z', lang: requested })
    }))
    const { getByTestId, getByRole } = wrap(<LanguageProvider detectCountry={async () => null}><LegalTermsPage /></LanguageProvider>)
    await waitFor(() => expect(getByTestId('legal-terms').querySelector('h1')?.textContent).toBe('Terms of Service'))
    await act(async () => getByRole('button', { name: 'Tiếng Việt' }).click())
    await waitFor(() => expect(getByTestId('legal-terms').querySelector('h1')?.textContent).toBe('Điều khoản dịch vụ'))
  })
})
