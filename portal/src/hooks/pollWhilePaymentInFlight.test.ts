import { describe, expect, it } from 'vitest'
import { POLL_MS, pollWhilePaymentInFlight } from './pollUntilSettled'

// docs/architecture/money-and-wallet.md#single-writer-outbox S7 / AC-S7.5. The expensive mistake here is not failing to poll — it is polling forever.
// `paymentState: null` is the state almost every invoice in the product sits in permanently (nobody
// has ever paid it), so reading null as "still moving" would put every invoice list in the product
// on a 5-second refresh loop for the lifetime of the page.

describe('pollWhilePaymentInFlight', () => {
  it('does not poll when no payment has ever been made on any row', () => {
    expect(pollWhilePaymentInFlight([{ paymentState: null }, { paymentState: null }])).toBe(false)
  })

  it('does not poll when the field is absent entirely', () => {
    // An older cached payload, or the admin DTO before it carried the column.
    expect(pollWhilePaymentInFlight([{}, {}])).toBe(false)
  })

  it('does not poll once every payment has finished', () => {
    expect(
      pollWhilePaymentInFlight([{ paymentState: 'Settled' }, { paymentState: 'Failed' }])
    ).toBe(false)
  })

  it('polls while any single row is still being applied', () => {
    expect(
      pollWhilePaymentInFlight([
        { paymentState: 'Settled' },
        { paymentState: 'Processing' },
        { paymentState: null },
      ])
    ).toBe(POLL_MS)
  })

  it('keeps polling on a state the portal has not been taught', () => {
    // Mirrors isPaymentInFlight: unknown keeps the row moving rather than freezing it on screen.
    expect(pollWhilePaymentInFlight([{ paymentState: 'Queued' }])).toBe(POLL_MS)
  })

  it('does not poll an empty or missing list', () => {
    expect(pollWhilePaymentInFlight([])).toBe(false)
    expect(pollWhilePaymentInFlight(undefined)).toBe(false)
  })
})
