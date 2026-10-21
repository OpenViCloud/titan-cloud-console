import { render, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { defaultTenant, server } from '@/test/server'
import { TenantProvider, useTenant } from './TenantContext'

vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, isLoading: false, signinRedirect: vi.fn() })),
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}><TenantProvider>{children}</TenantProvider></QueryClientProvider>
}

describe('TenantContext', () => {
  it('fetches /v1/tenant after authenticated and provides tenantId', async () => {
    const { result } = renderHook(() => useTenant(), { wrapper })
    await waitFor(() => expect(result.current.tenantId).toBe(defaultTenant.id))
    expect(result.current.tenantName).toBe(defaultTenant.name)
    expect(result.current.status).toBe(defaultTenant.status)
  })

  it('redirects to Keycloak in the language the user saved', async () => {
    window.localStorage.setItem('ovc-lang', 'vi')
    const { useAuth } = await import('react-oidc-context')
    const signinRedirect = vi.fn()
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      isLoading: false,
      signinRedirect,
    } as never)
    renderHook(() => null, { wrapper })
    await waitFor(() => expect(signinRedirect).toHaveBeenCalledWith({ ui_locales: 'vi' }))
    window.localStorage.clear()
  })

  it('redirects to Keycloak without a language when none is saved', async () => {
    window.localStorage.clear()
    const { useAuth } = await import('react-oidc-context')
    const signinRedirect = vi.fn()
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      isLoading: false,
      signinRedirect,
    } as never)
    renderHook(() => null, { wrapper })
    await waitFor(() => expect(signinRedirect).toHaveBeenCalledWith({}))
  })

  it('redirects to Keycloak when not authenticated', async () => {
    const { useAuth } = await import('react-oidc-context')
    const signinRedirect = vi.fn()
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      isLoading: false,
      signinRedirect,
    } as never)
    renderHook(() => null, { wrapper })
    await waitFor(() => expect(signinRedirect).toHaveBeenCalled())
  })

  it('shows loading while auth is resolving', async () => {
    const { useAuth } = await import('react-oidc-context')
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      isLoading: true,
      signinRedirect: vi.fn(),
    } as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { render } = await import('@testing-library/react')
    const { getByTestId } = render(
      <QueryClientProvider client={qc}><TenantProvider><div /></TenantProvider></QueryClientProvider>
    )
    expect(getByTestId('auth-loading')).toBeTruthy()
  })

  // AC9 — a PendingApproval tenant must be gated to the waiting screen, not the app,
  // where every write op would silently 403.
  it('renders the pending-approval screen when tenant is PendingApproval', async () => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json({ ...defaultTenant, status: 'PendingApproval' })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByTestId, queryByTestId } = render(
      <QueryClientProvider client={qc}><TenantProvider><div data-testid="app-child" /></TenantProvider></QueryClientProvider>
    )
    await waitFor(() => expect(getByTestId('pending-approval')).toBeTruthy())
    expect(queryByTestId('app-child')).toBeNull()
  })

  // AC10 — Active and Suspended must not be gated (Suspended is read-only, enforced by the API).
  it.each(['Active', 'Suspended'])('renders children when tenant is %s', async status => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json({ ...defaultTenant, status })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByTestId, queryByTestId } = render(
      <QueryClientProvider client={qc}><TenantProvider><div data-testid="app-child" /></TenantProvider></QueryClientProvider>
    )
    await waitFor(() => expect(getByTestId('app-child')).toBeTruthy())
    expect(queryByTestId('pending-approval')).toBeNull()
  })

  it('throws if useTenant used outside TenantProvider', () => {
    const qc = new QueryClient()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      renderHook(() => useTenant(), {
        wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
      })
    ).toThrow('useTenant must be used inside TenantProvider')
    consoleError.mockRestore()
  })
})
