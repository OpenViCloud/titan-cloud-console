import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReceiptText } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { InvoiceStatusBadge } from '@/components/InvoiceStatusBadge'
import { PayInvoiceDialog } from '@/components/PayInvoiceDialog'
import { isPayable } from '@/lib/invoice'
import { useInvoices, type Invoice } from '@/hooks/useInvoices'
import { useWallet } from '@/hooks/useWallet'
import { useT, useFormat } from '@/i18n/LanguageContext'

function InvoiceRow({ invoice, balance, onPay }: {
  invoice: Invoice
  balance: number
  onPay: (invoice: Invoice) => void
}) {
  const t = useT()
  const f = useFormat()
  const navigate = useNavigate()
  const payable = isPayable(invoice)
  // D-3 — the wallet either covers the invoice in full or pays nothing, so say so BEFORE the click
  // rather than letting the customer find out from an error (AC-4.2).
  const shortfall = invoice.total - balance

  function open() {
    navigate(`/billing/invoices/${invoice.id}`)
  }

  return (
    <TableRow
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={e => {
        if (e.key === 'Enter') open()
      }}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <TableCell className="font-medium text-foreground">{f.month(invoice.periodYear, invoice.periodMonth)}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{f.date(invoice.issuedAt)}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{f.date(invoice.dueAt)}</TableCell>
      <TableCell className="text-right text-soft-foreground font-mono text-sm">
        {f.money(invoice.total, invoice.currency)}
      </TableCell>
      <TableCell>
        <InvoiceStatusBadge status={invoice.status} paymentState={invoice.paymentState} />
      </TableCell>
      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
        {payable && (
          <Button
            size="sm"
            variant="outline"
            disabled={shortfall > 0}
            title={
              shortfall > 0
                ? t.invoices.notEnoughCredit(f.money(shortfall, invoice.currency))
                : undefined
            }
            onClick={() => onPay(invoice)}
          >
            {t.invoices.payFromWallet}
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

export function InvoicesPage() {
  const t = useT()
  const { data: invoices = [], isLoading, isError } = useInvoices()
  const { data: wallet } = useWallet()
  const [paying, setPaying] = useState<Invoice | null>(null)

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.invoices.title}</h1>
          <p className="text-[13px] text-faint mt-1">{t.invoices.subtitle}</p>
        </div>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.invoices.loadFailed}
        </p>
      )}

      {!isError && (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.invoices.period}</TableHead>
                <TableHead>{t.invoices.issued}</TableHead>
                <TableHead>{t.invoices.due}</TableHead>
                <TableHead className="text-right">{t.invoices.total}</TableHead>
                <TableHead>{t.invoices.status}</TableHead>
                <TableHead className="text-right">{t.invoices.action}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <div className="h-3 w-full bg-muted rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : invoices.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                        <ReceiptText className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <p className="text-[13px] text-faint font-medium">{t.invoices.empty}</p>
                      <p className="text-xs text-faint">{t.invoices.emptyHint}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map(invoice => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    balance={wallet?.balance ?? 0}
                    onPay={setPaying}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <PayInvoiceDialog invoice={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
