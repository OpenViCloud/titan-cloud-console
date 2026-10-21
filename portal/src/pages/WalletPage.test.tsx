import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { MemoryRouter } from 'react-router-dom'
import { renderWithProviders } from '@/test/renderWithProviders'
import { WalletPage } from './WalletPage'

// docs/architecture/money-and-wallet.md#human-confirmed-debit — the overdue banner now links to the invoice list (topping up no longer settles anything
// by itself), so the page needs a router in scope like every other route-aware page here.
function renderPage() {
  return renderWithProviders(
    <MemoryRouter>
      <WalletPage />
    </MemoryRouter>,
  )
}

const wallet = (o = {}) => ({ balance: 900000, currency: 'VND', ...o })

const statement = (lines: unknown[] = []) => ({
  openingBalance: 0, closingBalance: 900000, currency: 'VND', lines,
})

const topUp = (o = {}) => ({
  id: 'tu-1', tenantId: 'tenant-1', amount: 500000, currency: 'VND', status: 'Pending',
  paymentRef: 'TITAN-7F3KQ9A2', source: null, createdAt: '2026-08-27T00:00:00Z', confirmedAt: null, ...o,
})

// What the customer owes now comes from their own invoice list — GET /v1/tenant/credit-terms is gone
// (2026-09-04), because it also carried the account's debt ceiling and remaining room, which the
// customer is not shown. "Overdue" arrives as a display status derived server-side.
const invoice = (o = {}) => ({
  id: 'inv-1', periodYear: 2026, periodMonth: 8, status: 'New', issuedAt: '2026-09-01T00:00:00Z',
  dueAt: '2026-09-15T00:00:00Z', paidAt: null, total: 320000, currency: 'VND', ...o,
})

function stub(opts: {
  w?: ReturnType<typeof wallet>
  st?: ReturnType<typeof statement>
  topups?: unknown[]
  invoices?: unknown[]
} = {}) {
  server.use(
    http.get('*/v1/tenant/wallet', () => HttpResponse.json(opts.w ?? wallet())),
    http.get('*/v1/tenant/wallet/statement', () => HttpResponse.json(opts.st ?? statement())),
    http.get('*/v1/tenant/topups', () => HttpResponse.json(opts.topups ?? [])),
    http.get('*/v1/tenant/billing/invoices', () => HttpResponse.json(opts.invoices ?? [])),
    // docs/architecture/http-contract.md#create-returns-id: a create answers with the id alone. The page then reads the top-up back from the
    // topups query above — which is where paymentRef, the memo SePay matches the transfer by,
    // actually comes from.
    http.post('*/v1/tenant/topups', () => HttpResponse.json({ topUpId: 'tu-1' }, { status: 202 })),
  )
}

describe('WalletPage', () => {
  beforeEach(() => vi.clearAllMocks())

  // AC-P1.1 — real content: the balance value and a statement row, not just the heading.
  it('shows the balance and statement rows', async () => {
    stub({
      st: statement([
        { at: '2026-08-20T00:00:00Z', type: 'TopUp', amount: 900000, runningBalance: 900000 },
        { at: '2026-08-25T00:00:00Z', type: 'Spend', amount: -40000, runningBalance: 860000 },
      ]),
    })
    renderPage()

    await waitFor(() => expect(screen.getAllByText(/900[.,]000\s*₫/).length).toBeGreaterThan(0))
    expect(screen.getByText(/-40[.,]000\s*₫/)).toBeInTheDocument()   // spend line, signed
    expect(screen.getByText(/860[.,]000\s*₫/)).toBeInTheDocument()   // running balance
  })

  // AC-P1.2 — empty wallet is a zero + empty state, not an error.
  it('shows zero and an empty state for a new wallet', async () => {
    stub({ w: wallet({ balance: 0 }), st: statement([]) })
    renderPage()

    await waitFor(() => expect(screen.getByText(/no wallet activity yet/i)).toBeInTheDocument())
    expect(await screen.findAllByText(/0\s*₫/)).not.toHaveLength(0)
  })

  // AC-P2.1 — starting a top-up renders a VietQR carrying the amount and the PaymentRef memo.
  it('renders a VietQR with the amount and payment ref when buying credit', async () => {
    stub({ topups: [topUp({ status: 'Pending' })] })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /buy credit/i }))
    await user.type(screen.getByLabelText(/amount/i), '500000')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    const img = await screen.findByRole('img')
    expect(img).toHaveAttribute('src', expect.stringContaining('amount=500000'))
    expect(img).toHaveAttribute('src', expect.stringContaining('des=TITAN-7F3KQ9A2'))
    // the memo is shown as text too (for a manual transfer)
    expect(screen.getAllByText(/TITAN-7F3KQ9A2/).length).toBeGreaterThan(0)
  })

  // docs/architecture/http-contract.md#create-returns-id — the QR carries `des=<paymentRef>`, which SePay matches an incoming transfer by. The
  // portal knows the amount it just typed but CANNOT know paymentRef, so between creating the
  // top-up and reading it back there must be NO code on screen: one drawn with an empty memo looks
  // scannable and sends real money somewhere it cannot be matched to this top-up.
  //
  // The list stays empty here on purpose — that is the window this test exists to cover. Stubbing a
  // populated list (as the tests above do) never enters this branch at all.
  it('shows no QR until the top-up has been read back', async () => {
    stub({ topups: [] })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /buy credit/i }))
    await user.type(screen.getByLabelText(/amount/i), '500000')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByText(/preparing your transfer details/i)).toBeInTheDocument())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(/TITAN-/)).not.toBeInTheDocument()
  })

  // AC-P2.2 — when the webhook confirms the top-up, the polling UI flips to success.
  it('shows a success state once the top-up is confirmed', async () => {
    stub({ topups: [topUp({ status: 'Confirmed', confirmedAt: '2026-08-27T09:00:00Z' })] })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /buy credit/i }))
    await user.type(screen.getByLabelText(/amount/i), '500000')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByText(/credit added/i)).toBeInTheDocument())
  })

  // docs/features/customer-portal/design.md#portal-language — the page shows 500.000 ₫ in Vietnamese, so a customer types
  // it that way; it must ask for five hundred thousand đồng, not five hundred.
  it('asks for the amount typed with the grouping mark the page shows', async () => {
    stub({ topups: [topUp({ status: 'Pending' })] })
    let requested: unknown = null
    server.use(http.post('*/v1/tenant/topups', async ({ request }) => {
      requested = await request.json()
      return HttpResponse.json({ topUpId: 'tu-1' }, { status: 202 })
    }))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /buy credit/i }))
    await user.type(screen.getByLabelText(/amount/i), '500.000')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(requested).toEqual({ amount: 500000 }))
  })

  it('does not start a top-up for text that is not an amount', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /buy credit/i }))
    await user.type(screen.getByLabelText(/amount/i), '5a0')

    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
  })

  // docs/features/billing/topup/design.md — once the top-up is Confirmed there is nothing left to wait for.
  it('stops asking for the top-up once it is confirmed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let reads = 0
      stub()
      server.use(http.get('*/v1/tenant/topups', () => {
        reads += 1
        return HttpResponse.json([topUp({ status: 'Confirmed', confirmedAt: '2026-08-27T09:00:00Z' })])
      }))
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderPage()

      await user.click(await screen.findByRole('button', { name: /buy credit/i }))
      await user.type(screen.getByLabelText(/amount/i), '500000')
      await user.click(screen.getByRole('button', { name: /continue/i }))
      await waitFor(() => expect(screen.getByText(/credit added/i)).toBeInTheDocument())
      const readsWhenConfirmed = reads

      await vi.advanceTimersByTimeAsync(16_000)

      expect(reads).toBe(readsWhenConfirmed)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so and offers a retry when checking the payment fails', async () => {
    stub()
    server.use(http.get('*/v1/tenant/topups', () => HttpResponse.error()))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /buy credit/i }))
    await user.type(screen.getByLabelText(/amount/i), '500000')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByText(/could not check the payment/i)).toBeInTheDocument())
    server.use(http.get('*/v1/tenant/topups', () => HttpResponse.json([topUp({ status: 'Pending' })])))
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('img')).toHaveAttribute('src', expect.stringContaining('des=TITAN-7F3KQ9A2'))
  })

  // AC-P3.1/P3.2 — receipts are listed and clearly distinct from invoices.
  // ── debt ceiling is INTERNAL ────────────────────────────────────────────

  // Two numbers, not three. The third card ("Available to spend") was built from the account's debt
  // ceiling; Tôn Chủ removed it 2026-09-04 — the ceiling is an admin number read at month-end close,
  // and nothing gates on it, so there is no blocked state left for the customer to understand.
  it('shows balance and outstanding debt, and never shows a limit or remaining room', async () => {
    stub({
      w: wallet({ balance: 200000 }),
      invoices: [invoice({ total: 320000 })],
    })
    renderPage()

    await waitFor(() => expect(screen.getByText(/^200[.,]000\s*₫$/)).toBeInTheDocument()) // balance
    expect(screen.getByText(/^320[.,]000\s*₫$/)).toBeInTheDocument()                      // outstanding

    // The negative half, and the one that can actually fail: no ceiling, no allowance, no third card.
    expect(screen.queryByText(/available to spend/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/credit remaining/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/credit limit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/debt ceiling/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/spending (limit|room)/i)).not.toBeInTheDocument()
  })

  // Outstanding sums the invoices the customer still owes — and only those. A Paid invoice sitting in
  // the same list must not inflate the number.
  it('counts only unpaid invoices as outstanding', async () => {
    stub({
      invoices: [
        invoice({ id: 'a', total: 300000, status: 'New' }),
        invoice({ id: 'b', total: 50000, status: 'Overdue' }),
        invoice({ id: 'c', total: 999000, status: 'Paid' }),
        invoice({ id: 'd', total: 111000, status: 'Settled' }),
      ],
    })
    renderPage()

    await waitFor(() => expect(screen.getByText(/^350[.,]000\s*₫$/)).toBeInTheDocument())
    expect(screen.queryByText(/999[.,]000/)).not.toBeInTheDocument()
  })

  // OD-9 — overdue REMINDS, it does not enforce. The copy must not threaten a consequence the
  // system deliberately does not carry out.
  it('warns about overdue invoices without claiming anything was suspended', async () => {
    stub({
      invoices: [
        invoice({ id: 'a', total: 220000, status: 'Overdue', dueAt: '2026-08-10T00:00:00Z' }),
        invoice({ id: 'b', total: 100000, status: 'Overdue', dueAt: '2026-08-22T00:00:00Z' }),
      ],
    })
    renderPage()

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(/2 invoices are past their due date/i)
    expect(banner).toHaveTextContent(/oldest due Aug 10, 2026/i)
    expect(banner).toHaveTextContent(/running resources are not affected/i)
    expect(banner).not.toHaveTextContent(/suspend/i)
  })

  it('shows no overdue banner when nothing is past due', async () => {
    stub()
    renderPage()

    await waitFor(() => expect(screen.getByText(/statement/i)).toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // US-PROMO-01 — the tenant no longer requests free credit (it is an admin grant now), so this page
  // has no request form or request list. Promo credit still appears in the Statement as a Promo line.
  it('does not offer a free-credit request form', async () => {
    stub()
    renderPage()

    await waitFor(() => expect(screen.getByText(/statement/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /request free credit/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/free credit/i)).not.toBeInTheDocument()
  })

  it('shows an admin-granted promo credit as a Promo line in the statement', async () => {
    stub({
      st: statement([
        { at: '2026-08-26T00:00:00Z', type: 'Promo', amount: 500000, runningBalance: 500000 },
      ]),
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('Promo')).toBeInTheDocument())
  })

  // AC-RM4.1 — a receipt is a top-up that has been paid for (RM-1); there is no separate document.
  it('lists paid top-ups as receipts and distinguishes them from invoices', async () => {
    stub({ topups: [topUp({ status: 'Confirmed', confirmedAt: '2026-08-27T00:00:00Z', source: 'SePay' })] })
    renderPage()

    expect(screen.getByRole('heading', { name: /^receipts$/i })).toBeInTheDocument()
    expect(screen.getByText(/credit you bought/i)).toBeInTheDocument()   // Receipt vs Invoice distinction
    // the receipt row loads and shows its reference
    expect(await screen.findAllByText(/TITAN-7F3KQ9A2/)).not.toHaveLength(0)
  })

  // AC-RM4.2 — the source now also carries top-ups awaiting payment and failed ones, which this table
  // has never shown. Without the filter the customer reads a receipt for money they never paid.
  it('shows only paid top-ups as receipts — never pending or failed ones', async () => {
    stub({
      topups: [
        topUp({ id: 'tu-paid', paymentRef: 'TITAN-PAID0001', status: 'Confirmed',
                confirmedAt: '2026-08-27T00:00:00Z', source: 'SePay' }),
        topUp({ id: 'tu-wait', paymentRef: 'TITAN-WAIT0001', status: 'Pending' }),
        topUp({ id: 'tu-fail', paymentRef: 'TITAN-FAIL0001', status: 'Failed' }),
      ],
    })
    renderPage()

    // The paid one is there — a non-empty oracle, so an empty table cannot pass this test.
    expect(await screen.findAllByText(/TITAN-PAID0001/)).not.toHaveLength(0)
    expect(screen.queryByText(/TITAN-WAIT0001/)).not.toBeInTheDocument()
    expect(screen.queryByText(/TITAN-FAIL0001/)).not.toBeInTheDocument()
  })

  // AC-RM4.3
  it('renders the empty receipts state when nothing has been bought', async () => {
    stub({ topups: [] })
    renderPage()

    expect(await screen.findByText(/no receipts yet/i)).toBeInTheDocument()
  })
})

// docs/architecture/money-and-wallet.md#human-confirmed-debit — the overdue reminder must offer a way out. Topping up no longer settles anything by
// itself, so a banner with no link would be a dead end: "you owe money", and nothing to do about it.
describe('WalletPage — overdue banner offers a way to pay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('links to the invoice list and still never threatens suspension', async () => {
    stub({
      invoices: [
        invoice({ id: 'a', total: 200000, status: 'Overdue', dueAt: '2026-08-08T00:00:00Z' }),
        invoice({ id: 'b', total: 100000, status: 'Overdue', dueAt: '2026-08-20T00:00:00Z' }),
      ],
    })
    renderPage()

    const banner = await screen.findByRole('status')
    const link = within(banner).getByRole('link', { name: /pay an invoice from your wallet/i })
    expect(link).toHaveAttribute('href', '/billing/invoices')
    expect(banner).not.toHaveTextContent(/suspend/i)
  })
})

describe('WalletPage — Vietnamese', () => {
  it('shows the heading, the statement and the overdue banner in Vietnamese', async () => {
    stub({
      st: statement([
        { at: '2026-08-25T12:00:00Z', type: 'Spend', amount: -40000, runningBalance: 860000 },
      ]),
      invoices: [invoice({ total: 200000, status: 'Overdue', dueAt: '2026-08-08T12:00:00Z' })],
    })
    renderWithProviders(
      <MemoryRouter>
        <WalletPage />
      </MemoryRouter>,
      { lang: 'vi' },
    )
    expect(await screen.findByText('-40.000 ₫')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ví' })).toBeInTheDocument()
    expect(screen.getByText('25/08/2026')).toBeInTheDocument()
    expect(screen.getByText('Chi tiêu')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader', { name: 'Số tiền' }).length).toBe(2)
    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent('1 hoá đơn đã quá hạn thanh toán (hạn sớm nhất 08/08/2026)')
    expect(banner).toHaveTextContent('Còn nợ 200.000 ₫.')
    expect(within(banner).getByRole('link', { name: 'Trả hoá đơn từ ví' })).toBeInTheDocument()
  })
})
