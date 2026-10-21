import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { InvoiceDetailPage } from './InvoiceDetailPage'

const invoiceDetail = (overrides = {}) => ({
  id: 'inv-1',
  periodYear: 2026,
  periodMonth: 8,
  status: 'New',
  issuedAt: '2026-08-01T00:00:00Z',
  dueAt: '2026-08-08T00:00:00Z',
  paidAt: null,
  total: 225000,
  currency: 'VND',
  items: [
    { id: 'item-1', resourceType: 'compute', resourceId: 'vm-1', resourceName: 'web-01', amount: 144000, currency: 'VND' },
    { id: 'item-2', resourceType: 'disk', resourceId: 'vol-1', resourceName: 'data-vol', amount: 81000, currency: 'VND' },
  ],
  ...overrides,
})

function renderPage(initialPath = '/billing/invoices/inv-1') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/billing/invoices" element={<div>Invoices list</div>} />
        <Route path="/billing/invoices/:invoiceId" element={<InvoiceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InvoiceDetailPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders header and line items', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(invoiceDetail())))
    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    expect(screen.getByText('225,000 ₫')).toBeInTheDocument()
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('data-vol')).toBeInTheDocument()
    expect(screen.getByText('144,000 ₫')).toBeInTheDocument()
    expect(screen.getByText('81,000 ₫')).toBeInTheDocument()
  })

  it('shows resource type pill', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(invoiceDetail())))
    renderPage()
    await waitFor(() => expect(screen.getByText('COMPUTE')).toBeInTheDocument())
    expect(screen.getByText('DISK')).toBeInTheDocument()
  })

  // Invoices are all-usage now; a negative line can only be one issued before that, and it must still read cleanly.
  it('renders a negative line with the minus before the amount, and the total reduced', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices/inv-1', () =>
        HttpResponse.json(
          invoiceDetail({
            total: 135000, // 144.000 + 81.000 usage - 90.000 credit
            items: [
              { id: 'item-1', resourceType: 'compute', resourceId: 'vm-1', resourceName: 'web-01', amount: 144000, currency: 'VND' },
              { id: 'item-2', resourceType: 'disk', resourceId: 'vol-1', resourceName: 'data-vol', amount: 81000, currency: 'VND' },
              { id: 'item-3', resourceType: 'Credit', resourceId: '00000000-0000-0000-0000-000000000000', resourceName: 'Free credit', amount: -90000, currency: 'VND' },
            ],
          }),
        ),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Free credit')).toBeInTheDocument())
    expect(screen.getByText('CREDIT')).toBeInTheDocument()
    expect(screen.getByText('−90,000 ₫')).toBeInTheDocument() // minus before the amount, not "-90,000 ₫" from the number itself
    expect(screen.getByText('135,000 ₫')).toBeInTheDocument() // header total = usage minus credit
  })

  it('shows "No line items" when items is empty', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(invoiceDetail({ items: [] }))),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('No line items')).toBeInTheDocument())
  })

  it('shows error banner when API fails', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(null, { status: 500 })))
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load invoice/i)).toBeInTheDocument())
  })

  it('shows "Invoice not found" on 404 (not a refresh prompt) — S4', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices/inv-1', () =>
        HttpResponse.json({ status: 404, title: 'Not found', code: 'INVOICE_NOT_FOUND' }, { status: 404 }),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice not found.')).toBeInTheDocument())
    expect(screen.queryByText(/please refresh/i)).not.toBeInTheDocument()
  })

  it('navigates back to invoices list when back link is clicked', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(invoiceDetail())))
    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /invoices/i }))
    await waitFor(() => expect(screen.getByText('Invoices list')).toBeInTheDocument())
  })
})

// ── docs/architecture/money-and-wallet.md#human-confirmed-debit PAY-4 — pay from wallet, detail view ───────────────────────────
describe('InvoiceDetailPage — pay from wallet', () => {
  beforeEach(() => vi.clearAllMocks())

  const owed = (o = {}) =>
    invoiceDetail({
      status: 'New',
      total: 300000,
      currency: 'VND',
      items: [{ id: 'item-1', resourceType: 'compute', resourceId: 'vm-1', resourceName: 'web-01', amount: 300000, currency: 'VND' }],
      ...o,
    })

  function stubWallet(balance: number) {
    server.use(http.get('*/v1/tenant/wallet', () =>
      HttpResponse.json({ balance, currency: 'VND' })))
  }

  it('pays the invoice and posts to the tenant pay route', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(owed())))
    stubWallet(500000)
    let paid = false
    server.use(http.post('*/v1/tenant/billing/invoices/inv-1/pay', () => {
      paid = true
      return new HttpResponse(null, { status: 202 }) // docs/architecture/http-contract.md#async-actions-return-202
    }))

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /pay from wallet/i }))
    await userEvent.click(screen.getByRole('button', { name: /^Pay 300/ }))

    await waitFor(() => expect(paid).toBe(true))
  })

  // AC-4.2 — the shortfall is on screen, not hidden behind a click.
  it('states how much more is needed and disables the button', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () => HttpResponse.json(owed())))
    stubWallet(120000)

    renderPage()
    expect(await screen.findByText(/need 180,000 ₫ more/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pay from wallet/i })).toBeDisabled()
  })

  it('offers no payment button on a settled invoice', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices/inv-1', () =>
      HttpResponse.json(owed({ status: 'Settled' }))))
    stubWallet(500000)

    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /pay from wallet/i })).not.toBeInTheDocument()
  })
})

// docs/architecture/money-and-wallet.md#single-writer-outbox S7 — the detail page is the third surface that offers payment, and it holds the invoice
// in local state while the dialog is open. These prove the page reads paymentState rather than
// relying on the snapshot it captured at click time.
describe('InvoiceDetailPage — payment in flight (S7)', () => {
  it('does not offer to pay while a payment is being applied', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices/inv-1', () =>
        HttpResponse.json(invoiceDetail({ status: 'New', paymentState: 'Processing' })),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Processing')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /pay from wallet/i })).not.toBeInTheDocument()
  })

  it('offers payment again after a failure', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices/inv-1', () =>
        HttpResponse.json(invoiceDetail({ status: 'New', paymentState: 'Failed' })),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Payment failed')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /pay from wallet/i })).toBeInTheDocument()
  })
})

describe('InvoiceDetailPage — Vietnamese', () => {
  it('shows the period, headers, the shortfall and the pay button in Vietnamese', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices/inv-1', () =>
        HttpResponse.json(invoiceDetail({ dueAt: '2026-08-08T12:00:00Z' }))),
      http.get('*/v1/tenant/wallet', () => HttpResponse.json({ balance: 100000, currency: 'VND' })),
    )
    renderWithProviders(
      <MemoryRouter initialEntries={['/billing/invoices/inv-1']}>
        <Routes>
          <Route path="/billing/invoices/:invoiceId" element={<InvoiceDetailPage />} />
        </Routes>
      </MemoryRouter>,
      { lang: 'vi' },
    )
    expect(await screen.findByRole('heading', { name: '08/2026' })).toBeInTheDocument()
    expect(screen.getByText('225.000 ₫')).toBeInTheDocument()
    expect(screen.getByText('Hạn thanh toán 08/08/2026')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Tài nguyên' })).toBeInTheDocument()
    expect(await screen.findByText('Cần thêm 125.000 ₫')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trả từ ví' })).toBeDisabled()
  })
})
