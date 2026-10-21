import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'
import { pollWhilePaymentInFlight } from './pollUntilSettled'

// Settled = an invoice paid from the wallet (SettledByWallet, docs/architecture/money-and-wallet.md#human-confirmed-debit) — always the result of someone
// pressing "pay", never something Titan did on its own. The API sends the display status, so Overdue
// and Settled arrive here as-is.
export type InvoiceStatus = 'New' | 'Overdue' | 'Paid' | 'Settled'

// docs/architecture/money-and-wallet.md#single-writer-outbox S5 — where a payment from the wallet has got to, INDEPENDENT of `status`. Right after the
// customer presses pay the invoice is `status: New` AND `paymentState: Processing`: accepted, money
// not moved. `null` means nobody has ever paid this invoice — not that a payment finished.
export type PaymentState = 'Processing' | 'Settled' | 'Failed'

export interface Invoice {
  id: string
  periodYear: number
  periodMonth: number
  status: InvoiceStatus
  issuedAt: string
  dueAt: string
  paidAt?: string | null
  total: number
  currency: string
  paymentState?: PaymentState | null
}

export interface InvoiceItem {
  id: string
  resourceType: string
  resourceId: string
  resourceName: string
  amount: number
  currency: string
}

export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[]
}

export function useInvoices() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['invoices', tenantId],
    queryFn: () => api.get<Invoice[]>(`/v1/tenant/billing/invoices`).then(r => r.data),
    enabled: !!tenantId,
    // docs/architecture/money-and-wallet.md#single-writer-outbox S5 — nothing pushes the result of a payment to the browser: the wallet is debited by a
    // background consumer after the request returned 202. Without this the list shows the invoice
    // still unpaid until the customer reloads by hand.
    refetchInterval: q => pollWhilePaymentInFlight(q.state.data),
  })
}

export function useInvoice(invoiceId: string | undefined) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['invoice', tenantId, invoiceId],
    queryFn: () =>
      api.get<InvoiceDetail>(`/v1/tenant/billing/invoices/${invoiceId}`).then(r => r.data),
    enabled: !!tenantId && !!invoiceId,
    refetchInterval: q => pollWhilePaymentInFlight(q.state.data ? [q.state.data] : undefined),
  })
}

// docs/architecture/money-and-wallet.md#human-confirmed-debit PAY-1 — the tenant pays one invoice from its wallet. Invalidates everything the payment
// moves: the invoice itself, the list, and the wallet balance with its statement. The credit-terms
// query used to be in this list; it is gone (2026-09-04) along with the endpoint behind it.
export function usePayInvoiceFromWallet() {
  const qc = useQueryClient()
  const { tenantId } = useTenant()
  return useMutation({
    mutationFn: (invoiceId: string) =>
      // docs/architecture/http-contract.md#async-actions-return-202: 202 with no body — the invoice is re-read (and polled) to see the payment land.
      api.post(`/v1/tenant/billing/invoices/${invoiceId}/pay`),
    onSuccess: () => {
      for (const key of ['invoices', 'invoice', 'wallet', 'wallet-statement'])
        qc.invalidateQueries({ queryKey: [key, tenantId] })
    },
  })
}
