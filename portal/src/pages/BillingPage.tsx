import { useState } from 'react'
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useBillingSummary } from '@/hooks/useBilling'
import { useT, useFormat } from '@/i18n/LanguageContext'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthParts(month: string): { year: number; month: number } {
  const [y, m] = month.split('-').map(Number)
  return { year: y, month: m }
}

export function BillingPage() {
  const t = useT()
  const f = useFormat()
  const [month, setMonth] = useState(currentMonth)
  const today = currentMonth()
  const isCurrentMonth = month === today

  const { data, isLoading, isError } = useBillingSummary(month)

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.usage.title}</h1>
          <p className="text-[13px] text-faint mt-1">{t.usage.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t.usage.previousMonth}
            onClick={() => setMonth(prevMonth)}
            className="text-muted-foreground hover:text-foreground px-2"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-[13px] text-foreground font-medium w-20 text-center">
            {f.month(monthParts(month).year, monthParts(month).month)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t.usage.nextMonth}
            onClick={() => setMonth(nextMonth)}
            disabled={isCurrentMonth}
            className="text-muted-foreground hover:text-foreground px-2"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.usage.loadFailed}
        </p>
      )}

      {!isError && (
        <>
          <div className="rounded-xl border border-border bg-card p-5 mb-4">
            {isLoading ? (
              <div className="animate-pulse">
                <div className="h-3 w-24 bg-muted rounded mb-3" />
                <div className="h-8 w-28 bg-muted rounded" />
              </div>
            ) : (
              <div>
                <p className="text-[13px] text-muted-foreground font-medium mb-2">{t.usage.totalThisMonth}</p>
                <p className="text-3xl font-semibold text-foreground tracking-tight">
                  {f.money(data?.totalCost ?? 0, data?.currency ?? 'VND')}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.usage.virtualMachine}</TableHead>
                  <TableHead className="text-right">{t.usage.cost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="h-3 w-16 bg-muted rounded animate-pulse ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data?.perVm.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                          <ReceiptText className="w-5 h-5" strokeWidth={1.5} />
                        </div>
                        <p className="text-[13px] text-faint font-medium">{t.usage.empty}</p>
                        <p className="text-xs text-faint">{t.usage.emptyHint}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.perVm.map(vm => (
                    <TableRow key={vm.vmId}>
                      <TableCell className="font-medium text-foreground">{vm.vmName}</TableCell>
                      <TableCell className="text-right text-soft-foreground font-mono text-sm">
                        {f.money(vm.totalCost, data?.currency ?? 'VND')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
