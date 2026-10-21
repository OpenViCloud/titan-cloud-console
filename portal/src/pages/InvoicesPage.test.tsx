import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { InvoicesPage } from './InvoicesPage'

const invoice = (overrides = {}) => ({
  id: 'inv-1',
  periodYear: 2026,
  periodMonth: 8,
  status: 'New',
  issuedAt: '2026-08-01T00:00:00Z',
  dueAt: '2026-08-08T00:00:00Z',
  paidAt: null,
  total: 225000,
  currency: 'VND',
  ...overrides,
})

function renderPage(initialPath = '/billing/invoices') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/billing/invoices" element={<InvoicesPage />} />
        <Route path="/billing/invoices/:invoiceId" element={<div>Detail page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InvoicesPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders invoice rows with period, due date and total', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([invoice()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    expect(screen.getByText('225,000 ₫')).toBeInTheDocument()
  })

  it('shows empty state when no invoices', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([])))
    renderPage()
    await waitFor(() => expect(screen.getByText('No invoices yet')).toBeInTheDocument())
    expect(screen.getByText('Invoices are generated at month end')).toBeInTheDocument()
  })

  it('shows error banner when API returns 500', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json(null, { status: 500 })))
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load invoices/i)).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows New status badge', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([invoice({ status: 'New' })])))
    renderPage()
    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument())
  })

  it('shows Overdue status badge in red', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([invoice({ status: 'Overdue' })])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Overdue')).toBeInTheDocument())
    expect(screen.getByText('Overdue').className).toMatch(/\btext-bad\b/)
  })

  it('shows Paid status badge', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([invoice({ status: 'Paid' })])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Paid')).toBeInTheDocument())
    expect(screen.getByText('Paid').className).toMatch(/\btext-ok\b/)
  })

  it('navigates to detail page when row is clicked', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([invoice()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('link'))
    await waitFor(() => expect(screen.getByText('Detail page')).toBeInTheDocument())
  })

  it('navigates to detail page when row is focused and Enter is pressed', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([invoice()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    screen.getByRole('link').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByText('Detail page')).toBeInTheDocument())
  })
})

// ── docs/architecture/money-and-wallet.md#human-confirmed-debit PAY-4 — paying an invoice from the wallet ───────────────────────
//
// The wallet is debited only by a button press now, so these pin the button's PRECONDITIONS (is the
// invoice payable, does the wallet cover it) and the confirm step. Asserting real numbers, not just
// that a button exists: "Pay" with the wrong amount on it is worse than no button.
describe('InvoicesPage — pay from wallet', () => {
  beforeEach(() => vi.clearAllMocks())

  const vnd = (o = {}) => invoice({ total: 300000, currency: 'VND', ...o })

  function stubWallet(balance: number) {
    server.use(http.get('*/v1/tenant/wallet', () =>
      HttpResponse.json({ balance, currency: 'VND' })))
  }

  it('offers the button on an owed invoice and confirms with the exact amount and resulting balance', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([vnd()])))
    stubWallet(500000)
    let paidId: string | null = null
    server.use(http.post('*/v1/tenant/billing/invoices/:id/pay', ({ params }) => {
      paidId = params.id as string
      return new HttpResponse(null, { status: 202 }) // docs/architecture/http-contract.md#async-actions-return-202
    }))

    renderPage()
    const button = await screen.findByRole('button', { name: /pay from wallet/i })
    expect(button).toBeEnabled()
    await userEvent.click(button)

    // The dialog states what leaves the wallet and what is left — before anything is charged.
    expect(await screen.findByText('Amount due')).toBeInTheDocument()
    expect(screen.getByText('Wallet now')).toBeInTheDocument()
    expect(screen.getByText('After payment')).toBeInTheDocument()
    expect(screen.getByText('200,000 ₫')).toBeInTheDocument()   // 500.000 − 300.000
    // The primary button carries the real amount, not "Confirm".
    const confirm = screen.getByRole('button', { name: /^Pay 300/ })
    await userEvent.click(confirm)

    await waitFor(() => expect(paidId).toBe('inv-1'))
  })

  // AC-4.2 — D-3 is all-or-nothing, so a short wallet must be visible BEFORE the click.
  it('disables the button and names the shortfall when the wallet does not cover the invoice', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([vnd()])))
    stubWallet(100000)

    renderPage()
    const button = await screen.findByRole('button', { name: /pay from wallet/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('200,000 ₫'))
  })

  // AC-1.5 / OD-9 (a) — being late never blocks paying.
  it('offers the button on an OVERDUE invoice', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () =>
      HttpResponse.json([vnd({ status: 'Overdue' })])))
    stubWallet(500000)

    renderPage()
    expect(await screen.findByRole('button', { name: /pay from wallet/i })).toBeEnabled()
  })

  it('offers no button on an already-settled invoice', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () =>
      HttpResponse.json([vnd({ status: 'Settled' })])))
    stubWallet(500000)

    renderPage()
    await waitFor(() => expect(screen.getByText('Aug 2026')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /pay from wallet/i })).not.toBeInTheDocument()
  })

  // A 422 must leave the customer knowing nothing was charged — the wallet is their money.
  it('reports a rejected payment without claiming anything was charged', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([vnd()])))
    stubWallet(500000)
    server.use(http.post('*/v1/tenant/billing/invoices/:id/pay', () =>
      HttpResponse.json({ status: 422, title: 'short', code: 'INVOICE_WALLET_INSUFFICIENT' }, { status: 422 })))

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /pay from wallet/i }))
    await userEvent.click(screen.getByRole('button', { name: /^Pay 300/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer covers/i)
  })

  // A 409 is not proof that someone else paid: it also answers a payment that could not start. The
  // customer is told nothing was charged and where to look, not a story about a second payer.
  it('answers a 409 without claiming someone else paid', async () => {
    server.use(http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json([vnd()])))
    stubWallet(500000)
    server.use(http.post('*/v1/tenant/billing/invoices/:id/pay', () =>
      HttpResponse.json({ status: 409, title: 'conflict', code: 'INVOICE_PAYMENT_CONFLICT' }, { status: 409 })))

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /pay from wallet/i }))
    await userEvent.click(screen.getByRole('button', { name: /^Pay 300/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/nothing was charged/i)
    expect(alert).not.toHaveTextContent(/someone paid/i)
  })
})

// docs/architecture/money-and-wallet.md#single-writer-outbox S7 — AC-S7.1 / AC-S7.2 / AC-S7.3 at the surface the customer actually looks at. The unit
// tests in lib/invoice own the rule; these prove the page asks it, which is the part a refactor can
// silently drop.
describe('InvoicesPage — payment in flight (S7)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not offer to pay an invoice whose payment is already being applied', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: 'Processing' })]),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Processing')).toBeInTheDocument())
    // The pay button is the only route to spending money from this screen.
    expect(screen.queryByRole('button', { name: /^pay/i })).not.toBeInTheDocument()
  })

  it('shows a failed payment as failed, and offers the retry', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: 'Failed' })]),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Payment failed')).toBeInTheDocument())
    // AC-S7.3 — a wallet that ran short mid-apply must not leave the invoice unpayable forever.
    expect(screen.getByRole('button', { name: /^pay/i })).toBeInTheDocument()
  })

  it('still offers payment on an invoice nobody has paid', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: null })]),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /^pay/i })).toBeInTheDocument())
    expect(screen.getByText('New')).toBeInTheDocument()
  })
})

describe('InvoicesPage — Vietnamese', () => {
  it('shows the heading, headers, the row and the pay dialog in Vietnamese', async () => {
    server.use(
      http.get('*/v1/tenant/billing/invoices', () =>
        HttpResponse.json([invoice({ total: 300000, dueAt: '2026-08-08T12:00:00Z' })])),
      http.get('*/v1/tenant/wallet', () => HttpResponse.json({ balance: 500000, currency: 'VND' })),
    )
    renderWithProviders(
      <MemoryRouter initialEntries={['/billing/invoices']}>
        <Routes>
          <Route path="/billing/invoices" element={<InvoicesPage />} />
        </Routes>
      </MemoryRouter>,
      { lang: 'vi' },
    )
    expect(await screen.findByText('08/2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hoá đơn' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Hạn thanh toán' })).toBeInTheDocument()
    expect(screen.getByText('08/08/2026')).toBeInTheDocument()
    expect(screen.getByText('300.000 ₫')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Trả từ ví' }))
    expect(await screen.findByText('Số tiền phải trả')).toBeInTheDocument()
    expect(screen.getByText('200.000 ₫')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trả 300.000 ₫' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument()
  })
})
