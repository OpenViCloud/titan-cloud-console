import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VmCreateModal } from '@/components/VmCreateModal'
import { VmActions, VmStatusBadge, VmStatusNote } from '@/components/vm/VmActions'
import { useVms, type Vm } from '@/hooks/useVms'
import { useZoneMap } from '@/hooks/useZones'
import { useTemplateMap } from '@/hooks/useTemplates'
import { useVmOfferings, type VmOfferingInfo } from '@/hooks/useVmOfferings'
import { useT } from '@/i18n/LanguageContext'

function sizeLabel(vm: Vm, offerings: VmOfferingInfo[]): string {
  const offering = offerings.find(o => o.id === vm.vmOfferingId)
  if (offering === undefined) {
    return vm.vmOfferingId
  }
  return `${offering.name} · ${offering.vcpu} vCPU · ${offering.memoryMb / 1024} GB`
}

function VmRow({ vm, offerings, templateName, zoneName }: {
  vm: Vm
  offerings: VmOfferingInfo[]
  templateName: string
  zoneName: string
}) {
  const t = useT()
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Server className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/vms/${vm.id}`} className="font-semibold text-foreground hover:text-primary-ink hover:underline">
            {vm.name}
          </Link>
          <VmStatusBadge vm={vm} />
          <VmStatusNote vm={vm} />
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-faint">
          {sizeLabel(vm, offerings)} · {templateName} · {zoneName}
        </p>
      </div>
      <div className="col-start-2 min-w-0 md:col-start-auto">
        <p className="text-[11.5px] text-faint">{t.vms.privateIpv4}</p>
        <p className="truncate font-mono text-[12.5px] text-soft-foreground">{vm.ipAddress ?? '—'}</p>
      </div>
      <div className="col-start-2 min-w-0 md:col-start-auto">
        <p className="text-[11.5px] text-faint">{t.vms.publicIpv6}</p>
        <p className="truncate font-mono text-[12.5px] text-soft-foreground">{vm.publicIpv6Address ?? '—'}</p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-1.5 md:col-start-auto md:justify-end">
        <VmActions vm={vm} />
        <Button asChild size="sm" className="text-xs">
          <Link to={`/vms/${vm.id}`}>{t.vms.manage}</Link>
        </Button>
      </div>
    </li>
  )
}

export function VmListPage() {
  const t = useT()
  const [createOpen, setCreateOpen] = useState(false)
  const { data: vms = [], isLoading, isError } = useVms()
  const { data: offerings = [] } = useVmOfferings()
  const zoneMap = useZoneMap()
  const templateMap = useTemplateMap()

  let subtitle = t.vms.machineCount(vms.length)
  if (isLoading) {
    subtitle = t.common.loading
  } else if (vms.length === 0) {
    subtitle = t.vms.noMachinesYet
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.vms.title}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
        </div>
        <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          {t.vms.create}
        </Button>
      </div>

      {isError && (
        <p className="mb-4 rounded-lg border border-bad-border bg-bad-soft px-4 py-3 text-sm text-bad">
          {t.vms.loadFailed}
        </p>
      )}

      {!isError && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {vms.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-border text-faint">
                <Server className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
              <p className="text-[13px] font-medium text-muted-foreground">{t.vms.empty}</p>
              <p className="text-xs text-faint">{t.vms.emptyHint}</p>
            </div>
          ) : (
            <ul aria-label={t.vms.listLabel} className="divide-y divide-border">
              {vms.map(vm => (
                <VmRow
                  key={vm.id}
                  vm={vm}
                  offerings={offerings}
                  templateName={templateMap.get(vm.templateId) ?? vm.templateId}
                  zoneName={zoneMap.get(vm.zoneId) ?? vm.zoneId}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <VmCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => toast.success(t.vms.created)}
      />
    </div>
  )
}
