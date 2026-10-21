import { cn } from '@/lib/utils'
import type { InvoiceStatus, PaymentState } from '@/hooks/useInvoices'
import { isPaymentInFlight } from '@/lib/invoice'

const statusClasses: Record<InvoiceStatus, string> = {
  New: 'bg-muted text-soft-foreground',
  Overdue: 'bg-bad-soft text-bad border border-bad-border',
  Paid: 'bg-ok-soft text-ok',
  // Settled = paid from the prepaid wallet — calm/positive, deliberately NOT the red Overdue look.
  Settled: 'bg-ok-soft text-ok border border-ok-border',
}

// docs/architecture/money-and-wallet.md#single-writer-outbox S7 — a payment being applied is its own visual state, not a variant of New. Amber rather
// than red: nothing is wrong, the money is simply on its way. A failed payment IS a problem the
// customer has to act on (top up, retry), so it takes the red the eye already reads as "your turn".
const paymentClasses = {
  inFlight: 'bg-warn-soft text-warn border border-warn-border',
  failed: 'bg-bad-soft text-bad border border-bad-border',
} as const

/// The payment state OVERRIDES the status while money is moving. The two disagree on purpose in that
/// window: the invoice is genuinely still `New` (unpaid) while `paymentState` is `Processing`, and
/// showing "New" there is what made the screen look like the button did nothing.
///
/// An unrecognised payment state renders as in flight rather than falling through to the status —
/// same reasoning as isPayable: while we are unsure, say "working on it" instead of inviting a
/// second payment. The old `statusClasses[status]` lookup returned `undefined` for anything outside
/// the four known values, which rendered an unstyled badge; nothing here can do that any more.
export function InvoiceStatusBadge({
  status,
  paymentState,
}: {
  status: InvoiceStatus
  paymentState?: PaymentState | null
}) {
  const failed = paymentState === 'Failed'
  const inFlight = isPaymentInFlight(paymentState)

  const label = failed ? 'Payment failed' : inFlight ? 'Processing' : status
  const className = failed
    ? paymentClasses.failed
    : inFlight
      ? paymentClasses.inFlight
      : (statusClasses[status] ?? statusClasses.New)

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        className
      )}
      // Announce the change when a payment resolves while the customer is looking at the row.
      role={inFlight || failed ? 'status' : undefined}
    >
      {label}
    </span>
  )
}
