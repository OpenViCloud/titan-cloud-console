import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Wallet as WalletIcon, Plus, Loader2, CheckCircle2, AlertCircle, ArrowDownLeft, ArrowUpRight,
  Receipt as ReceiptIcon,
} from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useT, useFormat } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import { vietQrUrl, sepayBankInfo } from '@/lib/sepay'
import { parseWholeVnd } from '@/lib/money'
import {
  useWallet, useWalletStatement, useTopUps, useCreateTopUp,
  type StatementLine, type TopUp,
} from '@/hooks/useWallet'
import { useInvoices } from '@/hooks/useInvoices'

const QUICK_AMOUNTS = [100000, 500000, 1000000, 2000000]

interface OutstandingDebt {
  loaded: boolean
  outstanding: number
  overdueCount: number
  oldestOverdueDueAt: string | null
  currency: string
}

// What the customer owes, derived from their OWN invoices. This used to come from
// GET /v1/tenant/credit-terms, which also carried the account's debt ceiling and remaining room —
// internal numbers the customer is no longer shown (2026-09-04), so the endpoint is gone. Overdue
// arrives as a display status from the API (derived server-side from New + DueAt, never stored).
function useOutstandingDebt(): OutstandingDebt {
  const { data: invoices, isSuccess } = useInvoices()
  const owed = (invoices ?? []).filter(i => i.status === 'New' || i.status === 'Overdue')
  const overdue = owed.filter(i => i.status === 'Overdue')
  return {
    loaded: isSuccess,
    outstanding: owed.reduce((sum, i) => sum + i.total, 0),
    overdueCount: overdue.length,
    oldestOverdueDueAt: overdue.length
      ? overdue.reduce((oldest, i) => (i.dueAt < oldest ? i.dueAt : oldest), overdue[0].dueAt)
      : null,
    currency: invoices?.[0]?.currency ?? 'VND',
  }
}

export function WalletPage() {
  const t = useT()
  const f = useFormat()
  const { data: wallet } = useWallet()
  const debt = useOutstandingDebt()
  const currency = wallet?.currency ?? debt.currency
  const [buyOpen, setBuyOpen] = useState(false)

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.wallet.title}</h1>
          {/* Postpaid: the old copy said "prepaid", which is the one thing this page must not imply
              — a customer may owe money here. */}
          <p className="text-[13px] text-faint mt-1">
            {t.wallet.subtitle}
          </p>
        </div>
        <Button onClick={() => setBuyOpen(true)}>
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          {t.wallet.buyCredit}
        </Button>
      </div>

      <OverdueBanner debt={debt} currency={currency} />

      {/* Two numbers, deliberately separate: what you hold, and what you owe. There used to be a
          third ("Available to spend") built from the account's debt ceiling — removed 2026-09-04,
          because the ceiling is an internal number the admin reads at month-end, not something the
          customer is shown. Nothing gates on it, so there is no blocked state to explain here. */}
      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        <StatCard
          icon={<WalletIcon className="w-4 h-4" strokeWidth={1.5} />}
          label={t.wallet.balance}
          value={wallet ? f.money(wallet.balance, currency) : '—'}
        />
        <StatCard
          icon={<ReceiptIcon className="w-4 h-4" strokeWidth={1.5} />}
          label={t.wallet.outstanding}
          value={debt.loaded ? f.money(debt.outstanding, currency) : '—'}
          emphasis={debt.outstanding > 0}
        />
      </div>

      <StatementSection currency={currency} />
      <ReceiptsSection currency={currency} />

      <BuyCreditDialog open={buyOpen} onOpenChange={setBuyOpen} currency={currency} />
    </div>
  )
}

function StatCard({ icon, label, value, hint, emphasis, warn }: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  emphasis?: boolean
  warn?: boolean
}) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? 'border-warn-border bg-warn-soft' : 'border-border'}`}>
      <div className="flex items-center gap-2 text-faint mb-2">
        <span className={warn ? 'text-warn' : undefined}>{icon}</span>
        <p className="text-xs">{label}</p>
      </div>
      <p className={`text-2xl font-semibold font-mono ${emphasis ? 'text-warn' : 'text-foreground'}`}>{value}</p>
      {hint && <p className="text-xs text-faint mt-1.5">{hint}</p>}
    </div>
  )
}

// OD-9 (a) — overdue only REMINDS. Semantic warning, never error: the customer has not done anything
// wrong, nothing has been suspended, and nothing will be. Saying "action required" here would be a
// threat the system does not carry out.
//
// docs/architecture/money-and-wallet.md#human-confirmed-debit gave it the missing half: a way out. Topping up no longer settles anything by itself, so a
// banner with no link would tell the customer they owe money and then leave them standing there.
function OverdueBanner({ debt, currency }: { debt: OutstandingDebt; currency: string }) {
  const t = useT()
  const f = useFormat()
  if (debt.overdueCount === 0) return null

  const due = debt.oldestOverdueDueAt ? f.date(debt.oldestOverdueDueAt) : null
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-warn-border bg-warn-soft px-4 py-3 flex items-start gap-3"
    >
      <AlertCircle className="w-4 h-4 text-warn mt-0.5 flex-shrink-0" strokeWidth={1.75} />
      <div className="text-[13px]">
        <p className="text-warn font-medium">
          {t.wallet.overdueCount(debt.overdueCount)}
          {due ? t.wallet.oldestDue(due) : ''}
        </p>
        <p className="text-muted-foreground mt-0.5">
          {t.wallet.overdueOutstanding(f.money(debt.outstanding, currency))}{' '}
          <Link
            to="/billing/invoices"
            className="text-warn underline underline-offset-2 hover:text-warn focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warn rounded"
          >
            {t.wallet.payAnInvoice}
          </Link>
        </p>
      </div>
    </div>
  )
}

// docs/architecture/money-and-wallet.md#wallet-one-balance — promo credit has no page of its own: an admin grants it (US-PROMO-01) and it lands in
// this same wallet, appearing in the Statement below as a `Promo` line. The customer no longer requests
// credit, so there is no request form or request list here.
function typeBadge(t: Messages, type: StatementLine['type']) {
  if (type === 'Spend') return <Badge variant="secondary">{t.wallet.typeSpend}</Badge>
  if (type === 'Promo') return <Badge variant="secondary">{t.wallet.typePromo}</Badge>
  return <Badge variant="success">{t.wallet.typeTopUp}</Badge>
}

function StatementSection({ currency }: { currency: string }) {
  const t = useT()
  const f = useFormat()
  const { data: statement, isError } = useWalletStatement()
  const lines = statement?.lines ?? []

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-foreground mb-3">{t.wallet.statement}</h2>
      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.wallet.statementLoadFailed}
        </p>
      )}
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.wallet.date}</TableHead>
              <TableHead>{t.wallet.type}</TableHead>
              <TableHead className="text-right">{t.wallet.amount}</TableHead>
              <TableHead className="text-right">{t.wallet.runningBalance}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                      <WalletIcon className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                    <p className="text-[13px] text-faint font-medium">{t.wallet.statementEmpty}</p>
                    <p className="text-xs text-faint">{t.wallet.statementEmptyHint}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="text-muted-foreground text-xs">{f.date(l.at)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      {l.amount < 0
                        ? <ArrowDownLeft className="w-3.5 h-3.5 text-faint" />
                        : <ArrowUpRight className="w-3.5 h-3.5 text-ok" />}
                      {typeBadge(t, l.type)}
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm ${l.amount < 0 ? 'text-soft-foreground' : 'text-ok'}`}>
                    {f.signedMoney(l.amount, currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-soft-foreground">
                    {f.money(l.runningBalance, currency)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function ReceiptsSection({ currency }: { currency: string }) {
  const t = useT()
  const f = useFormat()
  // A receipt IS a top-up that has been paid for (RM-1) — there is no separate document any more.
  // The filter is load-bearing, not tidying: this list also carries top-ups still awaiting payment
  // and ones whose payment failed, neither of which this table has ever shown. Rendering those would
  // tell the customer they have a receipt for money they never paid.
  const { data: topups = [] } = useTopUps()
  const receipts = topups.filter(topUp => topUp.status === 'Confirmed')

  return (
    <section>
      <h2 className="text-sm font-medium text-foreground mb-1">{t.wallet.receipts}</h2>
      <p className="text-xs text-faint mb-3">
        {t.wallet.receiptsIntroBefore}
        <span className="text-muted-foreground">{t.wallet.receiptWord}</span>
        {t.wallet.receiptsIntroMiddle}
        <span className="text-muted-foreground">{t.wallet.invoiceWord}</span>
        {t.wallet.receiptsIntroAfter}
      </p>
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.wallet.issued}</TableHead>
              <TableHead>{t.wallet.reference}</TableHead>
              <TableHead className="text-right">{t.wallet.amount}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="py-12 text-center text-[13px] text-faint">
                  {t.wallet.receiptsEmpty}
                </TableCell>
              </TableRow>
            ) : (
              receipts.map((r: TopUp) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground text-xs">{f.date(r.confirmedAt!)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.paymentRef}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-soft-foreground">
                    {f.money(r.amount, currency)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

type BuyStep = 'amount' | 'pay'

function BuyCreditDialog({
  open, onOpenChange, currency,
}: { open: boolean; onOpenChange: (v: boolean) => void; currency: string }) {
  const t = useT()
  const f = useFormat()
  const qc = useQueryClient()
  const [step, setStep] = useState<BuyStep>('amount')
  const [amount, setAmount] = useState('')
  // docs/architecture/http-contract.md#create-returns-id: POST /topups answers with the id alone, so this holds the id and the top-up itself is
  // read back from the topups query below. The QR the customer scans carries `paymentRef`, which the
  // server mints and the portal cannot derive, so there is a beat between creating the top-up and
  // being able to draw the code — `live` is undefined until the query lands.
  const [activeId, setActiveId] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState(false)
  const create = useCreateTopUp()

  // Poll the top-ups while we wait for payment, then read this one's live status back. Confirmed is the end: nothing
  // after it changes what the dialog shows, so polling stops there rather than when the dialog closes.
  const [confirmed, setConfirmed] = useState(false)
  const waiting = step === 'pay' && !!activeId && !confirmed
  const topUpsQuery = useTopUps(waiting)
  const { data: topups = [] } = topUpsQuery
  const live: TopUp | undefined = activeId ? topups.find(topUp => topUp.id === activeId) : undefined
  const status = live?.status
  if (status === 'Confirmed' && !confirmed) {
    setConfirmed(true)
  }
  const checkFailed = step === 'pay' && topUpsQuery.isError

  // When the webhook confirms the payment, refresh the wallet + statement.
  useEffect(() => {
    if (status === 'Confirmed') {
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['wallet-statement'] })
      qc.invalidateQueries({ queryKey: ['topups'] })
    }
  }, [status, qc])

  function reset() {
    setStep('amount')
    setAmount('')
    setActiveId(null)
    setQrFailed(false)
    setConfirmed(false)
    create.reset()
  }

  function close(v: boolean) {
    if (!v) reset()
    onOpenChange(v)
  }

  function submit() {
    const value = parseWholeVnd(amount)
    if (value === null || value <= 0) {
      return
    }
    create.mutate(value, {
      onSuccess: result => { setActiveId(result.topUpId); setStep('pay') },
    })
  }

  const numeric = parseWholeVnd(amount)
  const validAmount = numeric !== null && numeric > 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {step === 'amount' && (
          <>
            <DialogHeader>
              <DialogTitle>{t.walletBuy.title}</DialogTitle>
              <DialogDescription>{t.walletBuy.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAmount(String(a))}
                    className={`px-3 py-1.5 rounded-md border text-[13px] transition-colors cursor-pointer ${
                      numeric === a ? 'border-border-strong bg-muted text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f.money(a, currency)}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <label htmlFor="topup-amount" className="text-xs text-muted-foreground">{t.walletBuy.amountLabel(currency)}</label>
                <Input
                  id="topup-amount"
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  placeholder={t.walletBuy.amountPlaceholder}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>
              {create.isError && (
                <p className="text-sm text-bad">{t.walletBuy.startFailed}</p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={!validAmount || create.isPending}>
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {t.walletBuy.continue}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'pay' && activeId && (
          <>
            <DialogHeader>
              <DialogTitle>
                {status === 'Confirmed' ? t.walletBuy.creditAdded : status === 'Failed' ? t.walletBuy.paymentFailed : t.walletBuy.scanToPay}
              </DialogTitle>
              <DialogDescription>
                {status === 'Confirmed'
                  ? t.walletBuy.toppedUp
                  : status === 'Failed'
                    ? t.walletBuy.notThrough
                    : live
                      ? t.walletBuy.transfer(f.money(live.amount, currency))
                      : t.walletBuy.preparing}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-3 py-2">
              {status === 'Confirmed' ? (
                <CheckCircle2 className="w-16 h-16 text-ok" strokeWidth={1.5} />
              ) : status === 'Failed' ? (
                <AlertCircle className="w-16 h-16 text-bad" strokeWidth={1.5} />
              ) : !live ? (
                // No QR until the top-up has been read back. A code drawn without paymentRef would
                // look scannable and send the customer's money somewhere SePay cannot match it to
                // this top-up — an empty memo is worse than a spinner.
                <div
                  className="w-[220px] h-[220px] rounded-lg bg-muted flex items-center justify-center"
                  aria-live="polite"
                >
                  <Loader2 className="w-6 h-6 animate-spin text-faint" />
                </div>
              ) : (
                <>
                  <div className="w-[220px] h-[220px] rounded-lg bg-qr p-2 flex items-center justify-center">
                    {qrFailed ? (
                      <div className="text-center text-[12px] text-qr-foreground px-2">
                        <p className="font-medium mb-1">{t.walletBuy.bankTransfer}</p>
                        <p>{sepayBankInfo().bank}</p>
                        <p className="font-mono">{sepayBankInfo().account}</p>
                        <p className="mt-1">{t.walletBuy.memo}<span className="font-mono">{live.paymentRef}</span></p>
                      </div>
                    ) : (
                      <img
                        src={vietQrUrl(live.amount, live.paymentRef)}
                        alt={t.walletBuy.qrAlt(f.money(live.amount, currency), live.paymentRef)}
                        className="w-full h-full object-contain"
                        onError={() => setQrFailed(true)}
                      />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-faint">{t.walletBuy.transferMemo}</p>
                    <p className="font-mono text-sm text-foreground">{live.paymentRef}</p>
                  </div>
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t.walletBuy.waiting}
                  </div>
                </>
              )}
            </div>

            {checkFailed && (
              <div className="flex items-center justify-center gap-2 text-sm text-bad" role="alert">
                {t.walletBuy.checkFailed}
                <Button variant="outline" size="sm" onClick={() => topUpsQuery.refetch()}>{t.walletBuy.tryAgain}</Button>
              </div>
            )}

            <DialogFooter>
              {status === 'Confirmed' ? (
                <Button onClick={() => close(false)}>{t.walletBuy.done}</Button>
              ) : status === 'Failed' ? (
                <Button onClick={reset}>{t.walletBuy.startOver}</Button>
              ) : (
                <Button variant="ghost" onClick={() => close(false)}>{t.common.close}</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
