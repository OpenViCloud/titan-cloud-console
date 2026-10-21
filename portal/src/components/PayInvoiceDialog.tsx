import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { usePayInvoiceFromWallet, type Invoice } from '@/hooks/useInvoices'
import { useWallet } from '@/hooks/useWallet'
import { useT, useFormat } from '@/i18n/LanguageContext'

// docs/architecture/money-and-wallet.md#human-confirmed-debit — money leaves the wallet only when a person presses this button. Titan used to do it by
// itself (on top-up, and again when an invoice was generated); it no longer does, so this dialog is
// the customer's whole payment flow and has to be unambiguous about what is about to happen.
//
// Design rules it enforces (Persephone): the primary button carries the ACTUAL amount rather than a
// generic "Confirm", the balance after payment is shown before the click, and nothing is auto-focused
// — spending money must not be reachable by one stray Enter.

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? 'text-muted-foreground font-mono' : 'text-foreground font-mono'}>{value}</span>
    </div>
  )
}

export function PayInvoiceDialog({
  invoice,
  onClose,
}: {
  invoice: Invoice | null
  onClose: () => void
}) {
  const t = useT()
  const f = useFormat()
  const { data: wallet } = useWallet()
  const pay = usePayInvoiceFromWallet()
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  const balance = wallet?.balance ?? 0
  const total = invoice?.total ?? 0
  const shortfall = total - balance
  // D-3 — all or nothing: a wallet that cannot cover the invoice in full pays none of it, so the
  // button is disabled rather than letting the customer discover that from a 422.
  const covered = shortfall <= 0

  function submit() {
    if (!invoice) return
    setError(null)
    pay.mutate(invoice.id, {
      // docs/architecture/money-and-wallet.md#single-writer-outbox S5 — 202: accepted, money NOT moved yet. Closing here (what this did before) left
      // the customer looking at a row that still said unpaid, with no way to tell whether the click
      // had registered. Hold the dialog on an explicit "accepted" state instead; the list behind it
      // polls and the badge turns Processing → Settled on its own.
      onSuccess: () => setAccepted(true),
      onError: err => {
        const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
        setError(
          code === 'INVOICE_WALLET_INSUFFICIENT'
            ? t.payInvoice.walletInsufficient
            : code === 'INVOICE_INVALID_STATE'
              ? t.payInvoice.alreadySettled
              : code === 'INVOICE_PAYMENT_CONFLICT'
                ? t.payInvoice.conflict
                : t.payInvoice.failed,
        )
      },
    })
  }

  return (
    <Dialog
      open={!!invoice}
      onOpenChange={v => {
        if (!v) {
          setError(null)
          setAccepted(false)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.payInvoice.title}</DialogTitle>
          <DialogDescription>
            {!invoice
              ? ''
              : accepted
                ? t.payInvoice.acceptedDescription(f.month(invoice.periodYear, invoice.periodMonth))
                : t.payInvoice.description(f.month(invoice.periodYear, invoice.periodMonth))}
          </DialogDescription>
        </DialogHeader>

        {invoice && accepted && (
          <div
            className="rounded-lg border border-warn-border bg-warn-soft px-4 py-3"
            role="status"
          >
            <p className="text-sm text-warn">{t.payInvoice.accepted}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.payInvoice.acceptedHint}
            </p>
          </div>
        )}

        {invoice && !accepted && (
          <div className="space-y-2 rounded-lg border border-border px-4 py-3">
            <Row label={t.payInvoice.invoice} value={f.month(invoice.periodYear, invoice.periodMonth)} muted />
            <Row label={t.payInvoice.amountDue} value={f.money(invoice.total, invoice.currency)} />
            <div className="h-px bg-muted my-1" />
            <Row label={t.payInvoice.walletNow} value={f.money(balance, invoice.currency)} muted />
            <Row
              label={t.payInvoice.afterPayment}
              value={covered ? f.money(balance - total, invoice.currency) : '—'}
            />
          </div>
        )}

        {invoice && !accepted && !covered && (
          <p className="text-sm text-warn" role="status">
            {t.payInvoice.notEnoughCredit(f.money(shortfall, invoice.currency))}
          </p>
        )}

        {error && (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          {accepted ? (
            <Button onClick={onClose}>{t.payInvoice.done}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {t.common.cancel}
              </Button>
              <Button onClick={submit} disabled={!covered || pay.isPending}>
                {pay.isPending
                  ? t.payInvoice.paying
                  : invoice
                    ? t.payInvoice.payAmount(f.money(invoice.total, invoice.currency))
                    : t.payInvoice.pay}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
