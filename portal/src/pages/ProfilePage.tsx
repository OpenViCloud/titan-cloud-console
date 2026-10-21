import { useTenantProfile } from '@/hooks/useTenantProfile'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n/LanguageContext'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-border last:border-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[13px] text-foreground font-medium">{value}</span>
    </div>
  )
}

export function ProfilePage() {
  const { data, isLoading, isError } = useTenantProfile()
  const t = useT()

  if (isLoading) {
    return (
      <div className="max-w-xl animate-pulse space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3 max-w-xl">
        {t.profile.loadFailed}
      </p>
    )
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.profile.title}</h1>
        <p className="text-[13px] text-faint mt-1">{t.profile.subtitle}</p>
      </div>

      <div className="rounded-xl border border-border bg-card px-5 mb-4">
        <Row label={t.profile.tenantName} value={data.name} />
        <Row label={t.profile.tenantId} value={
          <span className="font-mono text-xs text-muted-foreground">{data.id}</span>
        } />
        <Row label={t.profile.status} value={
          <Badge variant={data.status === 'Active' ? 'success' : 'warning'}>{data.status}</Badge>
        } />
      </div>

      <div className="rounded-xl border border-border bg-card px-5">
        <div className="py-3 border-b border-border">
          <p className="text-[11px] font-medium text-faint uppercase tracking-widest">{t.profile.quota}</p>
        </div>
        <Row label={t.profile.vmLimit} value={t.profile.vmLimitValue(data.maxVms)} />
        <Row label={t.profile.networkLimit} value={t.profile.networkLimitValue(data.maxNetworks)} />
      </div>
    </div>
  )
}
