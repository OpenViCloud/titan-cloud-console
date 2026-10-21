import { Server, Network, HardDrive, ReceiptText, TrendingUp, Activity } from 'lucide-react'
import { useVms } from '@/hooks/useVms'
import { runsAGuest } from '@/lib/vmState'
import { useNetworks } from '@/hooks/useNetworks'
import { useVolumes } from '@/hooks/useVolumes'
import { useBillingSummary } from '@/hooks/useBilling'
import { useActivity, formatActivityAction, relativeTime } from '@/hooks/useActivity'
import { useT, useFormat } from '@/i18n/LanguageContext'
import { QuotaCard } from '@/components/QuotaCard'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthParts(month: string): { year: number; month: number } {
  const [y, m] = month.split('-').map(Number)
  return { year: y, month: m }
}

function StatSkeleton() {
  return (
    <div data-testid="stat-skeleton" className="rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="h-3 w-24 bg-muted rounded mb-4" />
      <div className="h-8 w-12 bg-muted rounded" />
    </div>
  )
}

function StatCard({ title, value, icon: Icon, description, testId }: {
  title: string
  value: number | string
  icon: React.ElementType
  description?: string
  testId?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 hover:bg-muted transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground font-medium">{title}</p>
          <p data-testid={testId} className="text-3xl font-semibold text-foreground mt-2 tracking-tight">{value}</p>
          {description && (
            <p className="text-xs text-faint mt-1.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {description}
            </p>
          )}
        </div>
        <div className="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-faint">
          <Icon className="w-4 h-4" strokeWidth={1.5} />
        </div>
      </div>
    </div>
  )
}

function RecentActivity() {
  const t = useT()
  const { data: events, isLoading } = useActivity()

  return (
    <section>
      <h2 className="text-[11px] font-medium text-faint uppercase tracking-widest mb-3">{t.dashboard.recentActivity}</h2>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div data-testid="activity-skeleton" className="p-5 animate-pulse space-y-3">
            <div className="h-3 w-2/3 bg-muted rounded" />
            <div className="h-3 w-1/2 bg-muted rounded" />
          </div>
        ) : !events || events.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-faint">
            <Activity className="w-4 h-4" strokeWidth={1.5} />
            {t.dashboard.noRecentActivity}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map(e => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-foreground shrink-0">{formatActivityAction(e.action, t)}</span>
                  <span className="text-faint truncate">{e.resourceName}</span>
                </div>
                <span className="text-faint shrink-0 tabular-nums">{relativeTime(e.createdAt, new Date(), t)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export function DashboardPage() {
  const t = useT()
  const f = useFormat()
  const { data: vms, isLoading: vmsLoading } = useVms()
  const runningCount = (vms ?? []).filter(runsAGuest).length
  const { data: networks, isLoading: netsLoading } = useNetworks()
  const { data: volumes, isLoading: volsLoading } = useVolumes()
  const month = currentMonth()
  const { data: billing, isLoading: billingLoading } = useBillingSummary(month)

  const loading = vmsLoading || netsLoading || volsLoading || billingLoading

  const totalGb = volumes?.reduce((sum, v) => sum + (v.sizeGb ?? 0), 0) ?? 0
  const currency = billing?.currency ?? 'VND'

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.dashboard.title}</h1>
        <p className="text-[13px] text-faint mt-1">{t.dashboard.subtitle}</p>
      </div>

      <section className="mb-8">
        <h2 className="text-[11px] font-medium text-faint uppercase tracking-widest mb-3">{t.dashboard.resources}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {loading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <StatCard
                title={t.dashboard.virtualMachines}
                testId="vm-count"
                value={vms?.length ?? 0}
                icon={Server}
                description={runningCount > 0 ? t.dashboard.machinesRunning(runningCount) : t.dashboard.noMachinesRunning}
              />
              <StatCard
                title={t.dashboard.networks}
                testId="network-count"
                value={networks?.length ?? 0}
                icon={Network}
                description={networks?.length ? t.dashboard.networksConfigured(networks.length) : t.dashboard.noNetworksConfigured}
              />
              <StatCard
                title={t.dashboard.dataVolumes}
                testId="volume-count"
                value={volumes?.length ?? 0}
                icon={HardDrive}
                description={volumes?.length ? t.dashboard.gbAllocated(totalGb) : t.dashboard.noVolumesAllocated}
              />
              <StatCard
                title={t.dashboard.thisMonth}
                testId="month-cost"
                value={f.money(billing?.totalCost ?? 0, currency)}
                icon={ReceiptText}
                description={f.month(monthParts(month).year, monthParts(month).month)}
              />
            </>
          )}
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <RecentActivity />
        <QuotaCard />
      </div>
    </div>
  )
}
