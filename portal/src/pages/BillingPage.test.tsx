import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { BillingPage } from './BillingPage'

// Pin current month so tests are deterministic
vi.setSystemTime(new Date('2026-04-12T10:00:00Z'))

const summary = (overrides = {}) => ({
  month: '2026-04',
  totalCost: 66600,
  currency: 'VND',
  perVm: [
    { vmId: 'vm-db', vmName: 'db-01', totalCost: 45000 },
    { vmId: 'vm-web', vmName: 'web-01', totalCost: 21600 },
  ],
  ...overrides,
})

describe('BillingPage', () => {
  beforeEach(() => vi.clearAllMocks())

  // AT-UI-B01 — default month is current month
  it('fetches billing summary for current month by default', async () => {
    let capturedMonth = ''
    server.use(
      http.get('*/v1/tenant/billing/summary', ({ request }) => {
        capturedMonth = new URL(request.url).searchParams.get('month') ?? ''
        return HttpResponse.json(summary())
      }),
    )
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(capturedMonth).toBe('2026-04'))
  })

  // AT-UI-B02 — shows total cost
  it('shows total cost formatted in đồng', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(summary())))
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText('66,600 ₫')).toBeInTheDocument())
  })

  // AT-UI-B03 — shows per-VM rows sorted by cost DESC
  it('shows per-VM rows with vmName and cost', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(summary())))
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText('db-01')).toBeInTheDocument())
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('45,000 ₫')).toBeInTheDocument()
    expect(screen.getByText('21,600 ₫')).toBeInTheDocument()
    // Each cell carries its own ₫; the header names no currency
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument()
  })

  // AT-UI-B04 — empty state
  it('shows empty state when no usage', async () => {
    server.use(
      http.get('*/v1/tenant/billing/summary', () =>
        HttpResponse.json(summary({ totalCost: 0, perVm: [] })),
      ),
    )
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText('No usage this month')).toBeInTheDocument())
  })

  // AT-UI-B05 — month navigation previous month
  it('navigates to previous month when ← clicked', async () => {
    let calledMonth = ''
    server.use(
      http.get('*/v1/tenant/billing/summary', ({ request }) => {
        calledMonth = new URL(request.url).searchParams.get('month') ?? ''
        return HttpResponse.json(summary({ month: calledMonth }))
      }),
    )
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(calledMonth).toBe('2026-04'))
    await userEvent.click(screen.getByRole('button', { name: /previous month/i }))
    await waitFor(() => expect(calledMonth).toBe('2026-03'))
  })

  // AT-UI-B05b — next month button disabled at current month
  it('next month button is disabled when on current month', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(summary())))
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText('66,600 ₫')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /next month/i })).toBeDisabled()
  })

  // AT-UI-B05c — navigate forward after going back
  it('next month button enabled after navigating back, re-disables at current', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(summary())))
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText('66,600 ₫')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /previous month/i }))
    expect(screen.getByRole('button', { name: /next month/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /next month/i }))
    expect(screen.getByRole('button', { name: /next month/i })).toBeDisabled()
  })

  // AT-UI-B06 — error state
  it('shows error banner when API returns 500', async () => {
    server.use(
      http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(null, { status: 500 })),
    )
    renderWithProviders(<BillingPage />)
    await waitFor(() =>
      expect(screen.getByText(/failed to load billing data/i)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // AT-UI-B07 — vmName fallback when UUID-like name
  it('displays vmName as-is even if it looks like a UUID', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    server.use(
      http.get('*/v1/tenant/billing/summary', () =>
        HttpResponse.json(
          summary({ perVm: [{ vmId: uuid, vmName: uuid, totalCost: 1.0 }] }),
        ),
      ),
    )
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText(uuid)).toBeInTheDocument())
  })

  // AT-UI-B08 — month label displayed
  it('shows formatted month label', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(summary())))
    renderWithProviders(<BillingPage />)
    await waitFor(() => expect(screen.getByText('Apr 2026')).toBeInTheDocument())
  })
})

describe('BillingPage — Vietnamese', () => {
  it('shows the heading, the month, the column header and the amounts in Vietnamese', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(summary())))
    renderWithProviders(<BillingPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('66.600 ₫')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Thanh toán' })).toBeInTheDocument()
    expect(screen.getByText('04/2026')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Chi phí' })).toBeInTheDocument()
    expect(screen.getByText('45.000 ₫')).toBeInTheDocument()
  })
})
