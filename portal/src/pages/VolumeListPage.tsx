import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, ChevronDown, ChevronRight, HardDrive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { VolumeCreateModal } from '@/components/VolumeCreateModal'
import { useVolumes, useDeleteVolume, useDetachVolume, useAttachVolume, type Volume } from '@/hooks/useVolumes'
import { useVms } from '@/hooks/useVms'
import {
  useVolumeSnapshots,
  useCreateVolumeSnapshot,
  useDeleteVolumeSnapshot,
  useRestoreVolumeSnapshot,
  type VolumeSnapshot,
} from '@/hooks/useVolumeSnapshots'
import { useVolumeOfferingMap } from '@/hooks/useVolumeOfferings'
import { useZoneMap } from '@/hooks/useZones'
import type { BadgeProps } from '@/components/ui/badge'
import {
  volumeLabel,
  snapshotLabel,
  canAttachStoredVolume,
  canDetachStoredVolume,
  canDeleteStoredVolume,
  canSnapshotStoredVolume,
  canUseStoredSnapshot,
  canDeleteStoredSnapshot,
} from '@/lib/storageState'
import { canAttachVolume, vmLabel } from '@/lib/vmState'
import { useT, useFormat } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

// Keys are what volumeLabel() and snapshotLabel() return: the move a waiting request makes, else whether Incus
// holds it and who uses it (lib/storageState.ts).
const volumeStateVariant: Record<string, BadgeProps['variant']> = {
  Available:                'success',
  Attached:                 'blue',
  'Attached outside OpenViCloud': 'warning',
  Creating:                 'blue',
  Attaching:                'blue',
  Detaching:                'warning',
  Deleting:                 'warning',
  'Not found':              'destructive',
  Failed:                   'destructive',
}

const snapshotStateVariant: Record<string, BadgeProps['variant']> = {
  Available:   'success',
  Creating:    'blue',
  Deleting:    'warning',
  'Not found': 'destructive',
  Failed:      'destructive',
}

// Nothing waits, yet the attachment Incus shows is not the one asked for: attached or detached outside Titan. The
// badge shows the truth; the row adds what was requested.
function attachmentDrift(volume: Volume, vmNameMap: Map<string, string>, t: Messages): string | null {
  const nothingWaits = volume.transition === null
  const differs = volume.currentAttachedVmId !== volume.desiredAttachedVmId
  if (!nothingWaits || !differs) {
    return null
  }
  if (volume.desiredAttachedVmId === null) {
    return t.volumes.requestedNotAttached
  }
  return t.volumes.requestedAttachedTo(vmNameMap.get(volume.desiredAttachedVmId) ?? volume.desiredAttachedVmId)
}

function attachedToLabel(volume: Volume, vmNameMap: Map<string, string>, t: Messages): string {
  if (volume.currentAttachedVmId !== null) {
    return vmNameMap.get(volume.currentAttachedVmId) ?? volume.currentAttachedVmId
  }
  if (volume.currentAttachedElsewhere) {
    return t.volumes.outsideOpenViCloud
  }
  return '—'
}

// ── Snapshot panel ────────────────────────────────────────────────────────────

function SnapshotCreateForm({
  volumeId,
  onDone,
}: {
  volumeId: string
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const create = useCreateVolumeSnapshot(volumeId)
  const t = useT()

  async function handleCreate() {
    if (!name.trim()) return
    setError('')
    try {
      await create.mutateAsync(name.trim())
      toast.success(t.volumeSnapshots.created)
      setName('')
      onDone()
    } catch (e: unknown) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'VOLUME_SNAPSHOT_QUOTA_EXCEEDED') {
        setError(t.volumeSnapshots.quotaExceeded)
      } else {
        setError(t.volumeSnapshots.createFailed)
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      <div className="flex gap-2">
        <Input
          placeholder={t.volumeSnapshots.namePlaceholder}
          value={name}
          onChange={e => setName(e.target.value)}
          className="h-7 text-xs max-w-[220px]"
          onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
        />
        <Button size="sm" className="h-7 text-xs px-3" onClick={handleCreate} disabled={create.isPending || !name.trim()}>
          {t.volumeSnapshots.create}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs px-3 text-faint" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
}

function RestoreSnapshotDialog({
  open,
  snapshot,
  volumeId,
  onOpenChange,
}: {
  open: boolean
  snapshot: VolumeSnapshot | null
  volumeId: string
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const restore = useRestoreVolumeSnapshot(volumeId)
  const t = useT()

  async function handleRestore() {
    if (!snapshot || !name.trim()) return
    try {
      const result = await restore.mutateAsync({ snapshotId: snapshot.id, name: name.trim() })
      toast.success(t.volumeSnapshots.restoreStarted(result.newVolumeId))
      setName('')
      onOpenChange(false)
    } catch {
      toast.error(t.volumeSnapshots.restoreFailed)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.volumeSnapshots.restoreTitle}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-soft-foreground mb-3">
            {t.volumeSnapshots.restoreBefore}<span className="text-foreground font-medium">{snapshot?.name}</span>{t.volumeSnapshots.restoreAfter}
          </p>
          <Input
            placeholder={t.volumeSnapshots.newVolumeName}
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-sm"
            onKeyDown={e => { if (e.key === 'Enter') handleRestore() }}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">{t.common.cancel}</Button>
          </DialogClose>
          <Button onClick={handleRestore} disabled={restore.isPending || !name.trim()}>
            {t.volumeSnapshots.restore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SnapshotPanel({ volume }: { volume: Volume }) {
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<VolumeSnapshot | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<VolumeSnapshot | null>(null)

  const { data: snapshots = [], isLoading } = useVolumeSnapshots(volume.id)
  const deleteSnap = useDeleteVolumeSnapshot(volume.id)
  const t = useT()
  const f = useFormat()

  const canSnapshot = canSnapshotStoredVolume(volume)

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    try {
      await deleteSnap.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      toast.success(t.volumeSnapshots.deleted)
    } catch (err) {
      const res = (err as import('axios').AxiosError<{ code?: string }>).response
      if (res?.status === 422 && res.data?.code === 'VOLUME_SNAPSHOT_INVALID_STATE') {
        toast.error(t.volumeSnapshots.deleteNotYet)
      } else {
        toast.error(t.volumeSnapshots.deleteFailed)
      }
    }
  }

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-faint font-medium uppercase tracking-wide">{t.volumeSnapshots.title}</span>
        {canSnapshot && !showForm && (
          <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => setShowForm(true)}>
            <Plus className="w-3 h-3" />
            {t.volumeSnapshots.newSnapshot}
          </Button>
        )}
      </div>

      {isLoading && <p className="text-xs text-faint py-2">{t.common.loading}</p>}

      {!isLoading && snapshots.length === 0 && !showForm && (
        <p className="text-xs text-faint py-2">{t.volumeSnapshots.empty}</p>
      )}

      {!isLoading && snapshots.length > 0 && (
        <div className="space-y-1">
          {snapshots.map(snap => (
            <div key={snap.id} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-card">
              <span className="text-xs text-soft-foreground flex-1 truncate">{snap.name}</span>
              <Badge variant={snapshotStateVariant[snapshotLabel(snap)] ?? 'default'} className="text-[10px]">
                {snapshotLabel(snap)}
              </Badge>
              <span className="text-[10px] text-faint">
                {f.shortDate(snap.createdAt)}
              </span>
              {canUseStoredSnapshot(snap) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 text-[10px] px-2 text-faint hover:text-info"
                  onClick={() => setRestoreTarget(snap)}
                  aria-label={t.volumeSnapshots.restore}
                >
                  {t.volumeSnapshots.restore}
                </Button>
              )}
              {/* Delete follows Incus: a snapshot Incus no longer has, or whose create failed, is deletable too. */}
              {canDeleteStoredSnapshot(snap) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 text-[10px] px-2 text-faint hover:text-bad"
                  onClick={() => setDeleteTarget(snap)}
                  aria-label={t.volumeSnapshots.deleteSnapshot}
                >
                  {t.common.delete}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && <SnapshotCreateForm volumeId={volume.id} onDone={() => setShowForm(false)} />}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        name={deleteTarget?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        loading={deleteSnap.isPending}
      />

      <RestoreSnapshotDialog
        open={!!restoreTarget}
        snapshot={restoreTarget}
        volumeId={volume.id}
        onOpenChange={open => { if (!open) setRestoreTarget(null) }}
      />
    </div>
  )
}

// ── AttachVolumeDialog ────────────────────────────────────────────────────────

function AttachVolumeDialog({
  open,
  volume,
  onOpenChange,
}: {
  open: boolean
  volume: Volume | null
  onOpenChange: (open: boolean) => void
}) {
  const [vmId, setVmId] = useState('')
  const attach = useAttachVolume()
  const { data: vms = [] } = useVms()
  const t = useT()

  const eligibleVms = vms.filter(
    vm => canAttachVolume(vm) && vm.zoneId === volume?.zoneId
  )

  async function handleAttach() {
    if (!volume || !vmId) return
    try {
      await attach.mutateAsync({ volumeId: volume.id, vmId })
      toast.success(t.volumes.attaching)
      setVmId('')
      onOpenChange(false)
    } catch {
      toast.error(t.volumes.attachFailed)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setVmId(''); onOpenChange(v) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.volumes.attachTitle}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-soft-foreground mb-3">
            {t.volumes.attachBefore}<span className="text-foreground font-medium">{volume?.name}</span>{t.volumes.attachAfter}
          </p>
          <select
            className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
            value={vmId}
            onChange={e => setVmId(e.target.value)}
            aria-label={t.volumes.selectVm}
          >
            <option value="">{t.volumes.selectVmPlaceholder}</option>
            {eligibleVms.map(vm => (
              <option key={vm.id} value={vm.id}>{vm.name} ({vmLabel(vm)})</option>
            ))}
          </select>
          {eligibleVms.length === 0 && (
            <p className="text-xs text-faint mt-2">{t.volumes.noEligibleVms}</p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">{t.common.cancel}</Button>
          </DialogClose>
          <Button onClick={handleAttach} disabled={attach.isPending || !vmId}>
            {t.volumes.attach}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── VolumeListPage ────────────────────────────────────────────────────────────

export function VolumeListPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Volume | null>(null)
  const [attachTarget, setAttachTarget] = useState<Volume | null>(null)

  const { data: volumes = [], isLoading, isError } = useVolumes()
  // The top-bar search lands here with ?q=<text>: show only the volumes whose name matches.
  const [searchParams, setSearchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim()
  const shown = volumes.filter(v => v.name.toLowerCase().includes(query.toLowerCase()))
  const { data: vms = [] } = useVms()
  const deleteVolume = useDeleteVolume()
  const detachVolume = useDetachVolume()
  const zoneMap = useZoneMap()
  const offeringMap = useVolumeOfferingMap()
  const t = useT()
  const f = useFormat()

  // C2 — "Attached to" shows the VM name, not the raw id (mirrors design; same shape as B-INV).
  const vmNameMap = new Map(vms.map(vm => [vm.id, vm.name]))

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteVolume.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      toast.success(t.volumes.deleted)
    } catch (err) {
      // Every refusal below is a toast that says what to do next, and that happens on the page, not in the dialog.
      setDeleteTarget(null)
      const res = (err as import('axios').AxiosError<{ code?: string }>).response
      const hasSnapshots = res?.status === 422 && res.data?.code === 'VOLUME_HAS_SNAPSHOTS'
      if (res?.status === 422 && res.data?.code === 'VOLUME_INVALID_STATE') {
        toast.error(t.volumes.deleteNotYet)
      } else if (hasSnapshots) {
        toast.error(t.volumes.hasSnapshots)
      } else {
        toast.error(t.volumes.deleteFailed)
      }
    }
  }

  async function handleDetach(volume: Volume) {
    try {
      await detachVolume.mutateAsync(volume.id)
      toast.success(t.volumes.detached)
    } catch {
      toast.error(t.volumes.detachFailed)
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t.volumes.title}</h1>
          <p className="text-[13px] text-faint mt-1">
            {isLoading ? t.common.loading : volumes.length === 0 ? t.volumes.noneYet : t.volumes.count(volumes.length)}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-[13px]" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          {t.volumes.create}
        </Button>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.volumes.loadFailed}
        </p>
      )}

      {query !== '' && (
        <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          {t.volumes.matching}<span className="font-semibold text-foreground">“{query}”</span>
          <button type="button" className="font-semibold text-primary-ink hover:underline" onClick={() => setSearchParams({})}>
            {t.volumes.clear}
          </button>
        </p>
      )}

      {!isError && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                <HardDrive className="w-5 h-5" />
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">{t.volumes.empty}</p>
              <p className="text-xs text-faint">{t.volumes.emptyHint}</p>
            </div>
          ) : (
            <ul aria-label={t.volumes.listLabel} className="divide-y divide-border">
              {shown.map(volume => (
                <li key={volume.id}>
                  <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                      <HardDrive className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{volume.name}</span>
                        <Badge variant={volumeStateVariant[volumeLabel(volume)] ?? 'default'}>{volumeLabel(volume)}</Badge>
                        {attachmentDrift(volume, vmNameMap, t) !== null && (
                          <span className="text-[11px] text-faint">{attachmentDrift(volume, vmNameMap, t)}</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-faint">
                        {offeringMap.get(volume.volumeOfferingId)?.name ?? volume.volumeOfferingId} · {zoneMap.get(volume.zoneId) ?? volume.zoneId} · {t.volumes.createdOn(f.date(volume.createdAt))}
                      </p>
                    </div>
                    <div className="col-start-2 min-w-0 md:col-start-auto">
                      <p className="text-[11.5px] text-faint">{t.volumes.size}</p>
                      <p className="truncate text-[13px] text-soft-foreground">{volume.sizeGb} GB</p>
                    </div>
                    <div className="col-start-2 min-w-0 md:col-start-auto">
                      <p className="text-[11.5px] text-faint">{t.volumes.attachedTo}</p>
                      <p className="truncate font-mono text-[12.5px] text-soft-foreground">{attachedToLabel(volume, vmNameMap, t)}</p>
                    </div>
                    <div className="col-start-2 flex flex-wrap items-center gap-1.5 md:col-start-auto md:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-xs"
                        aria-expanded={expandedId === volume.id}
                        onClick={() => toggleExpanded(volume.id)}
                      >
                        {expandedId === volume.id
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronRight className="w-3.5 h-3.5" />}
                        {t.volumes.snapshots}
                      </Button>
                      {canAttachStoredVolume(volume) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-faint hover:text-info text-xs"
                          onClick={() => setAttachTarget(volume)}
                        >
                          {t.volumes.attach}
                        </Button>
                      )}
                      {canDetachStoredVolume(volume) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-faint hover:text-warn text-xs"
                          disabled={detachVolume.isPending}
                          onClick={() => handleDetach(volume)}
                        >
                          {t.volumes.detach}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-faint hover:text-bad text-xs"
                        disabled={!canDeleteStoredVolume(volume)}
                        onClick={() => setDeleteTarget(volume)}
                      >
                        {t.common.delete}
                      </Button>
                    </div>
                  </div>
                  {expandedId === volume.id && <SnapshotPanel volume={volume} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        name={deleteTarget?.name ?? ''}
        onConfirm={handleConfirmDelete}
        loading={deleteVolume.isPending}
      />

      <VolumeCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => toast.success(t.volumes.created)}

      />

      <AttachVolumeDialog
        open={!!attachTarget}
        volume={attachTarget}
        onOpenChange={open => { if (!open) setAttachTarget(null) }}
      />
    </div>
  )
}
