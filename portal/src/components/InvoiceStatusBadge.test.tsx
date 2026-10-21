import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

// US-PW-P4 / AC-P4.1 — a wallet-settled invoice gets a distinct, calm "Settled" badge — never the red
// Overdue treatment (that would read as "you owe money" for an invoice already paid from credit).
describe('InvoiceStatusBadge', () => {
  it('renders the Settled label', () => {
    render(<InvoiceStatusBadge status="Settled" />)
    expect(screen.getByText('Settled')).toBeInTheDocument()
  })

  it('styles Settled distinctly from Overdue (not red)', () => {
    const { rerender } = render(<InvoiceStatusBadge status="Settled" />)
    const settled = screen.getByText('Settled').className
    rerender(<InvoiceStatusBadge status="Overdue" />)
    const overdue = screen.getByText('Overdue').className

    expect(settled).not.toEqual(overdue)
    expect(settled).not.toMatch(/\btext-bad\b/)      // calm/positive, not an alarm
    expect(overdue).toMatch(/\btext-bad\b/)
  })
})
