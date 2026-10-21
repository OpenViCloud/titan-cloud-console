// Refresh a list while any row is still moving, then stop.
//
// Nothing pushes status to the browser: the worker carries out each command and reports to the API, so a
// list rendered once shows whatever was true at page load.
//
// Every provisioned resource now polls while the server reports a `transition` (lib/vmState.ts, lib/networkState.ts,
// lib/storageState.ts, lib/templateState.ts); the per-resource settled-state sets that lived here are gone. What
// remains is the interval and the invoice predicate.

export const POLL_MS = 5000

/**
 * docs/architecture/money-and-wallet.md#single-writer-outbox S7 — refresh invoices while any payment is still being applied, then stop.
 *
 * Separate from the resources' transition polls because invoices are not decided by `status`: an invoice
 * being paid stays `status: New` and moves on `paymentState` instead. Shared by the tenant list, the
 * tenant detail page and the admin table so all three stop at the same moment — an admin watching a
 * payment they triggered and the customer watching the same payment should not disagree.
 *
 * `null`/absent is SETTLED here, not "in flight": it means nobody has paid this invoice, which is a
 * resting state. Polling it would refresh every invoice list in the product forever.
 */
export function pollWhilePaymentInFlight(
  rows: readonly { paymentState?: string | null }[] | undefined
): number | false {
  if (!rows?.length) return false
  return rows.some(r => isInFlight(r.paymentState)) ? POLL_MS : false
}

// Kept in step with isPaymentInFlight() in lib/invoice.ts: unknown counts as in flight, so a state
// the portal has not been taught keeps refreshing rather than freezing the row on screen.
function isInFlight(state: string | null | undefined): boolean {
  if (state === null || state === undefined) return false
  return state !== 'Settled' && state !== 'Failed'
}
