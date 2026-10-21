import { describe, expect, it } from 'vitest'
import { isPayable, isPaymentInFlight } from './invoice'

// docs/architecture/money-and-wallet.md#single-writer-outbox S7 — the rule these tests own: an invoice whose payment is already being applied is NOT
// payable again. Before S5 that could not happen, because the money moved inside the request; the
// button was only ever offered on an invoice nobody had paid. Now `pay` returns 202 with the money
// still in flight, so `status` alone stops being enough to decide.
//
// AC-S7.1. Written against lib/invoice rather than a page because this is the layer that owns the
// rule: three tenant surfaces (list, detail, dialog) ask it, and a test at any one of them would
// leave the other two unmeasured.

describe('isPayable', () => {
  // The pre-S5 behaviour, unchanged — an invoice that is owed can be paid, late or not.
  it.each([
    ['New', null],
    ['Overdue', null],
  ] as const)('%s with no payment in flight is payable', (status, paymentState) => {
    expect(isPayable({ status, paymentState })).toBe(true)
  })

  it.each(['Paid', 'Settled'] as const)('%s is not payable', status => {
    expect(isPayable({ status, paymentState: null })).toBe(false)
  })

  // The S7 rule. Status is still New here — the invoice is genuinely unpaid — but a command is
  // already on its way to the wallet. Offering the button again spends the money twice.
  it('New with a payment already in flight is NOT payable', () => {
    expect(isPayable({ status: 'New', paymentState: 'Processing' })).toBe(false)
  })

  it('Overdue with a payment already in flight is NOT payable', () => {
    expect(isPayable({ status: 'Overdue', paymentState: 'Processing' })).toBe(false)
  })

  // The failed case has to come back, or a customer whose wallet ran short mid-apply (docs/architecture/money-and-wallet.md#single-writer-outbox)
  // could never retry: the invoice would sit unpaid with the button off forever.
  it('a failed payment leaves the invoice payable again', () => {
    expect(isPayable({ status: 'New', paymentState: 'Failed' })).toBe(true)
  })

  // Defence against a value the portal has not been taught. Treating an unknown state as "go ahead"
  // is the one reading that can spend money; refusing is recoverable by a reload.
  it('an unrecognised payment state is treated as in flight, not as clear', () => {
    expect(isPayable({ status: 'New', paymentState: 'SomethingNew' as never })).toBe(false)
  })

  // Absent field (older cached payload, admin DTO before it carried the column) must not read as
  // "in flight" — that would disable payment across the board on a stale cache.
  it('a missing payment state reads as no payment in flight', () => {
    expect(isPayable({ status: 'New' })).toBe(true)
  })
})

describe('isPaymentInFlight', () => {
  it('is true only while the payment is being applied', () => {
    expect(isPaymentInFlight('Processing')).toBe(true)
    expect(isPaymentInFlight('Settled')).toBe(false)
    expect(isPaymentInFlight('Failed')).toBe(false)
    expect(isPaymentInFlight(null)).toBe(false)
    expect(isPaymentInFlight(undefined)).toBe(false)
  })

  // Same reasoning as above, stated where the predicate lives: unknown means "do not offer to
  // spend", because the alternative failure is a double payment.
  it('treats an unknown state as in flight', () => {
    expect(isPaymentInFlight('Queued' as never)).toBe(true)
  })
})
