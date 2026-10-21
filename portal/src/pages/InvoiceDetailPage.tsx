import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { InvoiceStatusBadge } from '@/components/InvoiceStatusBadge'
import { PayInvoiceDialog } from '@/components/PayInvoiceDialog'
import { isPayable } from '@/lib/invoice'
import { useInvoice, type Invoice } from '@/hooks/useInvoices'
import { useWallet } from '@/hooks/useWallet'
import { useT, useFormat, type Format } from '@/i18n/LanguageContext'

// Render a minus before the amount (−900.000 ₫, not "-900.000 ₫") so a negative reads
// cleanly rather than as a typo. Invoices issued after docs/architecture/money-and-wallet.md#human-confirmed-debit are all-usage and never negative; this
// stays because the formatter must not produce nonsense for anything that predates that.
function formatLineAmount(f: Format, currency: string, amount: number): string {
  if (currency === 'VND') {
    const sign = amount < 0 ? '−' : ''
    return `${sign}${f.money(Math.abs(amount), 'VND')}`
  }
  const sign = amount < 0 ? '−' : ''
  return `${currency} ${sign}$${Math.abs(amount).toFixed(2)}`
}

export function InvoiceDetailPage() {
  const t = useT()
  const f = useFormat()
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const navigate = useNavigate()
  const { data: invoice, isLoading, isError, error } = useInvoice(invoiceId)
  const { data: wallet } = useWallet()
  const [paying, setPaying] = useState<Invoice | null>(null)

  // A 404 means the invoice does not exist (or belongs to another tenant) — a distinct, terminal
  // condition, not a transient load failure. Telling the user to "refresh" there is misleading (S4).
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  const notFound = isError && status === 404
  const errorMessage = notFound ? t.invoiceDetail.notFound : t.invoiceDetail.loadFailed

  return (
    <div className="max-w-5xl">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-foreground px-2 mb-4 -ml-2"
        onClick={() => navigate('/billing/invoices')}
      >
        <ChevronLeft className="w-4 h-4" />
        {t.invoiceDetail.back}
      </Button>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {errorMessage}
        </p>
      )}

      {!isError && isLoading && (
        <div className="rounded-xl border border-border bg-card p-5 mb-4 animate-pulse">
          <div className="h-3 w-24 bg-muted rounded mb-3" />
          <div className="h-8 w-28 bg-muted rounded" />
        </div>
      )}

      {!isError && !isLoading && invoice && (
        <>
          <div className="rounded-xl border border-border bg-card p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {f.month(invoice.periodYear, invoice.periodMonth)}
              </h1>
              <InvoiceStatusBadge status={invoice.status} paymentState={invoice.paymentState} />
            </div>
            <p className="text-3xl font-semibold text-foreground tracking-tight mb-4">
              {f.money(invoice.total, invoice.currency)}
            </p>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-6 text-[13px] text-faint">
                <span>{t.invoiceDetail.issued(f.date(invoice.issuedAt))}</span>
                <span>{t.invoiceDetail.due(f.date(invoice.dueAt))}</span>
              </div>
              {isPayable(invoice) && (
                <div className="flex items-center gap-3">
                  {invoice.total - (wallet?.balance ?? 0) > 0 && (
                    <span className="text-[13px] text-warn">
                      {t.invoiceDetail.needMore(f.money(invoice.total - (wallet?.balance ?? 0), invoice.currency))}
                    </span>
                  )}
                  <Button
                    size="sm"
                    disabled={invoice.total - (wallet?.balance ?? 0) > 0}
                    onClick={() => setPaying(invoice)}
                  >
                    {t.invoiceDetail.payFromWallet}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.invoiceDetail.resource}</TableHead>
                  <TableHead>{t.invoiceDetail.type}</TableHead>
                  <TableHead className="text-right">{t.invoiceDetail.amount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.items.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="py-16 text-center">
                      <p className="text-[13px] text-faint font-medium">{t.invoiceDetail.noLineItems}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  invoice.items.map(item => {
                    const isCredit = item.amount < 0
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium text-foreground">{item.resourceName}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.resourceType.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-sm ${isCredit ? 'text-ok' : 'text-soft-foreground'}`}
                        >
                          {formatLineAmount(f, item.currency, item.amount)}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <PayInvoiceDialog invoice={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
