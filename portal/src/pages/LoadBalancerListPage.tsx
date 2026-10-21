import { useState } from 'react'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { Plus, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { LoadBalancerFormModal } from '@/components/LoadBalancerFormModal'
import { useLoadBalancers, useDeleteLoadBalancer, type LoadBalancer } from '@/hooks/useLoadBalancers'
import { useNetworks } from '@/hooks/useNetworks'
import {
  canDeleteLoadBalancer, canEditLoadBalancer, listenerLabel, loadBalancerLabel,
} from '@/lib/loadBalancerState'
import { useT, useFormat } from '@/i18n/LanguageContext'

// Keys are what loadBalancerLabel() returns.
const statusVariant: Record<string, BadgeProps['variant']> = {
  Active:      'success',
  Creating:    'blue',
  Updating:    'blue',
  Deleting:    'warning',
  'Not found': 'destructive',
  Failed:      'destructive',
}

export function LoadBalancerListPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LoadBalancer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LoadBalancer | null>(null)
  const { data: loadBalancers = [], isLoading, isError } = useLoadBalancers()
  const { data: networks = [] } = useNetworks()
  const deleteLb = useDeleteLoadBalancer()
  const t = useT()
  const f = useFormat()
  const networkNames = new Map(networks.map(n => [n.id, n.name]))

  function doneToast(kind: 'created' | 'updated') {
    toast.success(kind === 'created' ? t.loadBalancers.created : t.loadBalancers.updated)
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteLb.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      toast.success(t.loadBalancers.deleted)
    } catch (err) {
      const res = (err as AxiosError<{ code?: string }>).response
      if (res?.status === 422 && res.data?.code === 'LOAD_BALANCER_INVALID_STATE') {
        toast.error(t.loadBalancers.deleteInvalidState)
      } else {
        toast.error(t.loadBalancers.deleteFailed)
      }
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.loadBalancers.title}</h1>
          <p className="mt-1 text-[13px] text-faint">
            {isLoading
              ? t.common.loading
              : loadBalancers.length === 0 ? t.loadBalancers.noneYet : t.loadBalancers.count(loadBalancers.length)}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-[13px]" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          {t.loadBalancers.create}
        </Button>
      </div>

      {isError && (
        <p className="mb-4 rounded-lg border border-bad-border bg-bad-soft px-4 py-3 text-sm text-bad">
          {t.loadBalancers.loadFailed}
        </p>
      )}

      {!isError && <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loadBalancers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-border text-faint">
              <Waypoints className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </div>
            <p className="text-[13px] font-medium text-muted-foreground">{t.loadBalancers.empty}</p>
            <p className="text-xs text-faint">{t.loadBalancers.emptyHint}</p>
          </div>
        ) : (
          <ul aria-label={t.loadBalancers.listLabel} className="divide-y divide-border">
            {loadBalancers.map(lb => (
              <li key={lb.id}>
                <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[40px_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_auto]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                    <Waypoints className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{lb.name}</span>
                      <Badge variant={statusVariant[loadBalancerLabel(lb)] ?? 'default'}>{loadBalancerLabel(lb)}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-faint">
                      {networkNames.get(lb.networkId) ?? lb.networkId} · {t.networks.createdOn(f.date(lb.createdAt))}
                    </p>
                  </div>
                  <div className="col-start-2 min-w-0 md:col-start-auto">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-all font-mono text-[12.5px] text-soft-foreground">{lb.vip}</span>
                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-faint">{t.loadBalancers.ipv6Only}</span>
                    </div>
                  </div>
                  <div className="col-start-2 min-w-0 md:col-start-auto">
                    <p className="text-[11.5px] text-faint">{t.loadBalancers.listeners}</p>
                    <p className="text-[12.5px] text-soft-foreground">{lb.listeners.map(listenerLabel).join(' · ')}</p>
                    <p className="text-[12px] text-faint">{t.loadBalancers.backends(lb.backends.length)}</p>
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-1.5 md:col-start-auto md:justify-end">
                    <Button
                      variant="ghost" size="sm" className="text-xs text-faint hover:text-soft-foreground"
                      disabled={!canEditLoadBalancer(lb)} onClick={() => setEditTarget(lb)}
                    >
                      {t.loadBalancers.edit}
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="text-xs text-faint hover:text-bad"
                      disabled={!canDeleteLoadBalancer(lb)} onClick={() => setDeleteTarget(lb)}
                    >
                      {t.common.delete}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>}

      <LoadBalancerFormModal open={createOpen} onOpenChange={setCreateOpen} onDone={doneToast} />

      <LoadBalancerFormModal
        key={editTarget?.id ?? 'none'}
        open={editTarget !== null}
        onOpenChange={open => { if (!open) setEditTarget(null) }}
        loadBalancer={editTarget}
        onDone={doneToast}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        name={deleteTarget?.name ?? ''}
        onConfirm={handleConfirmDelete}
        loading={deleteLb.isPending}
      />
    </div>
  )
}
