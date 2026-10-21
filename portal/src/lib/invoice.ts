import type { Invoice, PaymentState } from '@/hooks/useInvoices'

/// docs/architecture/money-and-wallet.md#single-writer-outbox S5 — a payment that has been accepted but not yet applied. The API returns 202 and the
/// wallet is debited by the consumer moments later, so between those two points the invoice is
/// unpaid AND must not be offered for payment again.
///
/// Unknown values count as in flight on purpose. The two ways to be wrong are not symmetric: reading
/// an unfamiliar state as "clear" offers a second payment on money already moving, while reading it
/// as "in flight" only hides a button until the next poll. One costs money, the other costs a click.
export function isPaymentInFlight(state: PaymentState | null | undefined): boolean {
  if (state === null || state === undefined) return false
  return state !== 'Settled' && state !== 'Failed'
}

/// docs/architecture/money-and-wallet.md#human-confirmed-debit — an invoice is payable while it is still owed, OVERDUE INCLUDED: being late never blocks
/// paying (OD-9 (a) reminds, it does not enforce). Lives here rather than next to the dialog so the
/// rule is shared by every surface that offers the button, and stated exactly once.
///
/// docs/architecture/money-and-wallet.md#single-writer-outbox S7 — `status` alone stopped being enough. An invoice keeps `status: New` while its payment
/// is being applied, so a check on status alone re-offers the button on money already in flight.
/// `Failed` deliberately becomes payable again: a wallet that ran short mid-apply (D-6) must leave
/// the customer a way to top up and retry, not an invoice frozen with its button off.
export function isPayable(invoice: Pick<Invoice, 'status'> & { paymentState?: PaymentState | null }): boolean {
  if (isPaymentInFlight(invoice.paymentState)) return false
  return invoice.status === 'New' || invoice.status === 'Overdue'
}
