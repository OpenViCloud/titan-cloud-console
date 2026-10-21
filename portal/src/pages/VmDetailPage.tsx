import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { VmActions, VmStatusBadge, VmStatusNote } from '@/components/vm/VmActions'
import { VmSnapshotPanel } from '@/components/vm/VmSnapshotPanel'
import { useVms } from '@/hooks/useVms'
import { useNetworks } from '@/hooks/useNetworks'
import { useZoneMap } from '@/hooks/useZones'
import { useTemplateMap } from '@/hooks/useTemplates'
import { useVmOfferings } from '@/hooks/useVmOfferings'
import { useBillingSummary } from '@/hooks/useBilling'
import { useFormat, useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'snapshots'

function tabs(t: Messages): { id: Tab; label: string }[] {
  return [
    { id: 'overview', label: t.vmDetail.tabOverview },
    { id: 'snapshots', label: t.vmDetail.tabSnapshots },
  ]
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 border-t border-border px-5 py-4">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className={cn('mt-0.5 break-words font-medium', mono === true && 'font-mono text-[13px]')}>{children}</dd>
    </div>
  )
}

export function VmDetailPage() {
  const t = useT()
  const f = useFormat()
  const { vmId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const { data: vms = [], isLoading } = useVms()
  const { data: networks = [] } = useNetworks()
  const { data: offerings = [] } = useVmOfferings()
  const zoneMap = useZoneMap()
  const templateMap = useTemplateMap()
  const { data: billing } = useBillingSummary(currentMonth())

  if (isLoading) {
    return <div className="h-40 max-w-6xl animate-pulse rounded-xl bg-muted" data-testid="vm-detail-skeleton" />
  }

  const vm = vms.find(v => v.id === vmId)
  if (vm === undefined) {
    return (
      <div className="max-w-xl rounded-xl border border-border bg-card px-6 py-10 text-center">
        <p className="font-semibold">{t.vmDetail.notFound}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{t.vmDetail.notFoundHint}</p>
        <Link to="/vms" className="mt-4 inline-block text-[13px] font-semibold text-primary-ink hover:underline">
          {t.vmDetail.backToList}
        </Link>
      </div>
    )
  }

  const offering = offerings.find(o => o.id === vm.vmOfferingId)
  let size = vm.vmOfferingId
  if (offering !== undefined) {
    size = `${offering.name} · ${offering.vcpu} vCPU · ${offering.memoryMb / 1024} GB RAM`
  }
  const network = networks.find(n => n.id === vm.networkId)
  // Public IPv6 belongs to the network: a VM on a network with a /64 gets an address once Incus reports one.
  const networkHasPublicIpv6 = network !== undefined && typeof network.publicIpv6Subnet === 'string'
  const cost = billing?.perVm.find(c => c.vmId === vm.id)
  const currency = billing?.currency ?? 'VND'

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{vm.name}</h1>
              <VmStatusBadge vm={vm} />
              <VmStatusNote vm={vm} />
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {size} · {templateMap.get(vm.templateId) ?? vm.templateId} · {zoneMap.get(vm.zoneId) ?? vm.zoneId}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <VmActions vm={vm} onDeleted={() => navigate('/vms')} />
          </div>
        </div>
        <div role="tablist" aria-label={t.vmDetail.sections} className="flex gap-1 border-t border-border px-4">
          {tabs(t).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'border-b-2 px-2.5 py-3 text-[13.5px] font-semibold',
                tab === id ? 'border-primary text-primary-ink' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label={t.vmDetail.details}>
            <h2 className="px-5 py-4 text-[15px] font-semibold">{t.vmDetail.details}</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2">
              <Fact label={t.vmDetail.privateIpv4} mono>{vm.ipAddress ?? '—'}</Fact>
              <Fact label={t.vmDetail.publicIpv6} mono={typeof vm.publicIpv6Address === 'string'}>
                {vm.publicIpv6Address ?? (networkHasPublicIpv6 ? '—' : t.vmDetail.notEnabled)}
              </Fact>
              <Fact label={t.vmDetail.network}>{network?.name ?? vm.networkId}</Fact>
              <Fact label={t.vmDetail.zone}>{zoneMap.get(vm.zoneId) ?? vm.zoneId}</Fact>
              <Fact label={t.vmDetail.template}>{templateMap.get(vm.templateId) ?? vm.templateId}</Fact>
              <Fact label={t.vmDetail.created}>
                {f.date(vm.createdAt)}
              </Fact>
            </dl>
          </section>
          <section className="rounded-xl border border-border bg-card px-5 py-4" aria-label={t.vmDetail.costThisMonth}>
            <h2 className="text-[15px] font-semibold">{t.vmDetail.costThisMonth}</h2>
            <p data-testid="vm-cost" className="mt-3 text-[28px] font-bold tracking-tight tabular-nums">
              {f.money(cost?.totalCost ?? 0, currency)}
            </p>
            <p className="mt-1 text-[12.5px] text-faint">{t.vmDetail.costHint}</p>
          </section>
        </div>
      )}

      {tab === 'snapshots' && (
        <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label={t.vmDetail.snapshots}>
          <VmSnapshotPanel vm={vm} />
        </section>
      )}
    </div>
  )
}
