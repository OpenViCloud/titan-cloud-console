import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import type { Vm } from '@/hooks/useVms'
import { snapshotLabel, canUseStoredSnapshot, canDeleteStoredSnapshot } from '@/lib/storageState'
import { canSnapshotVm } from '@/lib/vmState'
import {
  useVmSnapshots,
  useCreateVmSnapshot,
  useDeleteVmSnapshot,
  useRevertVmSnapshot,
  type VmSnapshot,
} from '@/hooks/useVmSnapshots'
import { useFormat, useT } from '@/i18n/LanguageContext'

// Keys are what snapshotLabel() returns: the move a waiting request makes, else whether Incus holds it
// (lib/storageState.ts).
const snapshotStateVariant: Record<string, BadgeProps['variant']> = {
  Available:   'success',
  Creating:    'blue',
  Reverting:   'warning',
  Deleting:    'warning',
  'Not found': 'destructive',
  Failed:      'destructive',
}

function VmSnapshotCreateForm({ vmId, onDone }: { vmId: string; onDone: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const create = useCreateVmSnapshot(vmId)

  async function handleCreate() {
    if (!name.trim()) return
    setError('')
    try {
      await create.mutateAsync(name.trim())
      toast.success(t.vmSnapshots.created)
      setName('')
      onDone()
    } catch (e: unknown) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'VM_SNAPSHOT_QUOTA_EXCEEDED') {
        setError(t.vmSnapshots.quotaExceeded)
      } else {
        setError(t.vmSnapshots.createFailed)
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      <div className="flex gap-2">
        <Input
          placeholder={t.vmSnapshots.namePlaceholder}
          value={name}
          onChange={e => setName(e.target.value)}
          className="h-7 text-xs max-w-[220px]"
          onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
        />
        <Button size="sm" className="h-7 text-xs px-3" onClick={handleCreate} disabled={create.isPending || !name.trim()}>
          {t.vmSnapshots.create}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs px-3 text-faint" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
}

export function VmSnapshotPanel({ vm }: { vm: Vm }) {
  const t = useT()
  const f = useFormat()
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<VmSnapshot | null>(null)

  const { data: snapshots = [], isLoading } = useVmSnapshots(vm.id)
  const deleteSnap = useDeleteVmSnapshot(vm.id)
  const revertSnap = useRevertVmSnapshot(vm.id)

  const canSnapshot = canSnapshotVm(vm)

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    try {
      await deleteSnap.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      toast.success(t.vmSnapshots.deleted)
    } catch {
      toast.error(t.vmSnapshots.deleteFailed)
    }
  }

  async function handleRevert(snap: VmSnapshot) {
    try {
      await revertSnap.mutateAsync(snap.id)
      toast.success(t.vmSnapshots.revertStarted)
    } catch {
      toast.error(t.vmSnapshots.revertFailed)
    }
  }

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-faint font-medium uppercase tracking-wide">{t.vmSnapshots.title}</span>
        {canSnapshot && !showForm && (
          <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => setShowForm(true)}>
            <Plus className="w-3 h-3" />
            {t.vmSnapshots.newSnapshot}
          </Button>
        )}
      </div>

      {isLoading && <p className="text-xs text-faint py-2">{t.common.loading}</p>}

      {!isLoading && snapshots.length === 0 && !showForm && (
        <p className="text-xs text-faint py-2">{t.vmSnapshots.empty}</p>
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
                  onClick={() => handleRevert(snap)}
                  disabled={revertSnap.isPending}
                  aria-label={t.vmSnapshots.revert}
                >
                  {t.vmSnapshots.revert}
                </Button>
              )}
              {/* Delete follows Incus: a snapshot Incus no longer has, or whose create failed, is deletable too. */}
              {canDeleteStoredSnapshot(snap) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 text-[10px] px-2 text-faint hover:text-bad"
                  onClick={() => setDeleteTarget(snap)}
                  aria-label={t.vmSnapshots.deleteSnapshot}
                >
                  {t.common.delete}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && <VmSnapshotCreateForm vmId={vm.id} onDone={() => setShowForm(false)} />}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        name={deleteTarget?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        loading={deleteSnap.isPending}
      />
    </div>
  )
}
