import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { FixedLanguage } from '@/test/FixedLanguage'
import { LanguageProvider } from '@/i18n/LanguageProvider'
import { LANG_STORAGE_KEY } from '@/i18n/lang'
import { ConsentGatePage } from './ConsentGatePage'

const signoutRedirect = vi.fn()
vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(() => ({ signoutRedirect, signinRedirect: vi.fn() })),
}))

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>)
}

describe('ConsentGatePage', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  // AC2 — the checkbox is NOT pre-ticked and the confirm button is disabled until it is checked.
  it('starts with an unchecked box and a disabled confirm button', () => {
    const { getByTestId } = wrap(<ConsentGatePage />)

    expect((getByTestId('consent-checkbox') as HTMLInputElement).checked).toBe(false)
    expect((getByTestId('consent-accept') as HTMLButtonElement).disabled).toBe(true)
  })

  // AC2 — ticking the box enables the confirm button.
  it('enables the confirm button after the box is ticked', async () => {
    const user = userEvent.setup()
    const { getByTestId } = wrap(<ConsentGatePage />)

    await user.click(getByTestId('consent-checkbox'))

    expect((getByTestId('consent-accept') as HTMLButtonElement).disabled).toBe(false)
  })

  // AC3 — confirming records the acceptance (POST /v1/legal/acceptance).
  it('posts acceptance when the user confirms', async () => {
    let posted = false
    server.use(http.post('*/v1/legal/acceptance', () => {
      posted = true
      return new HttpResponse(null, { status: 204 })
    }))
    const user = userEvent.setup()
    const { getByTestId } = wrap(<ConsentGatePage />)

    await user.click(getByTestId('consent-checkbox'))
    await user.click(getByTestId('consent-accept'))

    await waitFor(() => expect(posted).toBe(true))
  })

  // AC4 — declining signs the user out; no acceptance is recorded.
  it('signs out when the user declines', async () => {
    const user = userEvent.setup()
    const { getByText } = wrap(<ConsentGatePage />)

    await user.click(getByText('Decline'))

    expect(signoutRedirect).toHaveBeenCalled()
  })

  // The terms link opens the public page in a new tab.
  it('links to the public terms page in a new tab', () => {
    const { getByRole } = wrap(<ConsentGatePage />)
    const link = getByRole('link', { name: 'Terms of Service' }) as HTMLAnchorElement

    expect(link.getAttribute('href')).toBe('/legal/terms')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('reads in Vietnamese when Vietnamese is picked', () => {
    const { getByRole, getByTestId } = wrap(<FixedLanguage lang="vi"><ConsentGatePage /></FixedLanguage>)

    expect(getByRole('heading', { level: 1 }).textContent).toBe('Điều khoản dịch vụ')
    expect(getByRole('link', { name: 'Điều khoản dịch vụ' }).getAttribute('href')).toBe('/legal/terms')
    expect(getByTestId('consent-accept').textContent).toBe('Đồng ý & tiếp tục')
    expect(getByRole('button', { name: 'Không đồng ý' })).toBeTruthy()
  })

  // A new user reads the terms before the app shell (and its account menu) exists, so the gate has its own switch.
  it('switches to Vietnamese from the gate itself and remembers it', async () => {
    const user = userEvent.setup()
    const { getByRole } = wrap(<LanguageProvider detectCountry={async () => null}><ConsentGatePage /></LanguageProvider>)
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Terms of Service')

    await user.click(getByRole('button', { name: 'Tiếng Việt' }))

    expect(getByRole('heading', { level: 1 }).textContent).toBe('Điều khoản dịch vụ')
    expect(getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('vi')
  })
})
