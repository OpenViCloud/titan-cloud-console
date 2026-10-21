import { useVms } from '@/hooks/useVms'
import { useNetworks } from '@/hooks/useNetworks'
import { useVolumes } from '@/hooks/useVolumes'
import { useTenantProfile } from '@/hooks/useTenantProfile'
import { occupiesQuota } from '@/lib/quota'
import { useT } from '@/i18n/LanguageContext'

function QuotaRow({ label, used, cap }: { label: string; used: number; cap: number | undefined }) {
  const t = useT()
  let percent = 0
  if (cap !== undefined && cap > 0) {
    percent = Math.min(100, Math.round((used / cap) * 100))
  }
  return (
    <div data-quota-row className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[13px]">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{cap === undefined ? t.quota.used(used) : `${used} / ${cap}`}</span>
      </div>
      {cap !== undefined && (
        <div
          role="progressbar"
          aria-label={t.quota.usedLabel(label)}
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={cap}
          className="h-1.5 overflow-hidden rounded-full border border-border bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}

/** How much of each per-tenant cap is used, counted the way the server counts it (lib/quota.ts). */
export function QuotaCard() {
  const t = useT()
  const { data: tenant } = useTenantProfile()
  const { data: vms = [] } = useVms()
  const { data: networks = [] } = useNetworks()
  const { data: volumes = [] } = useVolumes()

  const liveVms = vms.filter(occupiesQuota)
  // MaxPublicIpv6 counts networks holding a /64, the same way MaxNetworks counts networks. A control plane too old to
  // send publicIpv6Subnet leaves it undefined, which must not count.
  const liveNetworks = networks.filter(occupiesQuota)

  return (
    <section className="rounded-xl border border-border bg-card" aria-label={t.quota.title}>
      <div className="flex items-baseline justify-between border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-semibold">{t.quota.title}</h2>
        <span className="text-[12px] text-faint">{t.quota.setBy}</span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <QuotaRow label={t.quota.vms} used={liveVms.length} cap={tenant?.maxVms} />
        <QuotaRow label={t.quota.networks} used={liveNetworks.length} cap={tenant?.maxNetworks} />
        <QuotaRow label={t.quota.volumes} used={volumes.filter(occupiesQuota).length} cap={tenant?.maxVolumes} />
        <QuotaRow label={t.quota.publicIpv6} used={liveNetworks.filter(n => typeof n.publicIpv6Subnet === 'string').length} cap={tenant?.maxPublicIpv6} />
      </div>
    </section>
  )
}
