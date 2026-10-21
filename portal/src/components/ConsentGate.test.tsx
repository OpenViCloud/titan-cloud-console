import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { ConsentGate } from './ConsentGate'

// ConsentGatePage (rendered when gated) uses useAuth for the decline button.
vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(() => ({ signoutRedirect: vi.fn(), signinRedirect: vi.fn() })),
}))

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ConsentGate>{children}</ConsentGate>
    </QueryClientProvider>,
  )
}

describe('ConsentGate', () => {
  // AC1 — a caller who must accept is gated; the app is not reachable.
  it('shows the consent gate and hides the app when mustAcceptTerms is true', async () => {
    server.use(http.get('*/v1/legal/consent-status', () =>
      HttpResponse.json({ mustAcceptTerms: true, documentKey: 'terms', documentVersion: 'v0-placeholder' })))

    const { getByTestId, queryByTestId } = wrap(<div data-testid="app-child" />)

    await waitFor(() => expect(getByTestId('consent-gate')).toBeTruthy())
    expect(queryByTestId('app-child')).toBeNull()
  })

  // AC5 — a caller who has already accepted the current version reaches the app, no gate.
  it('renders the app when mustAcceptTerms is false', async () => {
    server.use(http.get('*/v1/legal/consent-status', () =>
      HttpResponse.json({ mustAcceptTerms: false, documentKey: 'terms', documentVersion: 'v0-placeholder' })))

    const { getByTestId, queryByTestId } = wrap(<div data-testid="app-child" />)

    await waitFor(() => expect(getByTestId('app-child')).toBeTruthy())
    expect(queryByTestId('consent-gate')).toBeNull()
  })
})
