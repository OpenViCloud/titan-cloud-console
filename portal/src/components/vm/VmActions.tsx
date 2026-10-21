import { useState } from 'react'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { useDeleteVm, useStartVm, useStopVm, type Vm } from '@/hooks/useVms'
import { canDeleteVm, canStartVm, canStopVm, isVmDrift, vmLabel } from '@/lib/vmState'
import { useT } from '@/i18n/LanguageContext'

// Keys are what vmLabel() returns: an Incus status, the move a waiting request makes, or why Incus has no status.
const stateVariant: Record<string, BadgeProps['variant']> = {
  Running:     'success',
  Ready:       'success',
  Starting:    'blue',
  Creating:    'blue',
  Stopped:     'gray',
  Frozen:      'warning',
  Stopping:    'warning',
  Deleting:    'warning',
  Error:       'destructive',
  'Not found': 'destructive',
  Failed:      'destructive',
}

export function VmStatusBadge({ vm }: { vm: Vm }) {
  const label = vmLabel(vm)
  return <Badge variant={stateVariant[label] ?? 'default'}>{label}</Badge>
}

/** What the badge alone does not say: a VM resting away from what was asked, or why a create was refused. */
export function VmStatusNote({ vm }: { vm: Vm }) {
  const t = useT()
  if (isVmDrift(vm)) {
    return <span className="text-[11px] text-faint">{t.vmActions.requested(vm.desiredState)}</span>
  }
  if (vm.requestFailureReason !== null && vm.transition === null) {
    return <span className="text-[11px] text-bad">{vm.requestFailureReason}</span>
  }
  return null
}

type ApiError = AxiosError<{ code?: string }>

/** Stop / Start (Resume) / Delete as Incus allows them (docs/features/vm/design.md#requests-follow-incus). */
export function VmActions({ vm, onDeleted }: { vm: Vm; onDeleted?: () => void }) {
  const t = useT()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteVm = useDeleteVm()
  const stopVm = useStopVm()
  const startVm = useStartVm()

  function handleActionError(err: unknown) {
    const res = (err as ApiError).response
    if (res?.status === 422 && res.data?.code === 'VM_INVALID_STATUS') {
      toast.error(t.vmActions.invalidStatus)
    } else {
      toast.error(t.vmActions.actionFailed)
    }
  }

  async function handleStop() {
    try {
      await stopVm.mutateAsync(vm.id)
    } catch (err) {
      handleActionError(err)
    }
  }

  async function handleStart() {
    try {
      await startVm.mutateAsync(vm.id)
    } catch (err) {
      handleActionError(err)
    }
  }

  async function handleConfirmDelete() {
    try {
      await deleteVm.mutateAsync(vm.id)
      setConfirmDelete(false)
      toast.success(t.vmActions.deleted)
      if (onDeleted) {
        onDeleted()
      }
    } catch (err) {
      const res = (err as ApiError).response
      const stillBeingCreated = vm.transition === 'Creating'
      if (res?.status === 422 && res.data?.code === 'VM_SNAPSHOT_IN_PROGRESS') {
        toast.error(t.vmActions.snapshotInProgress)
      } else if (res?.status === 422 && res.data?.code === 'VM_IS_LOAD_BALANCER_BACKEND') {
        toast.error(t.vmActions.isLoadBalancerBackend)
      } else if (res?.status === 422 && res.data?.code === 'VM_INVALID_STATUS' && stillBeingCreated) {
        toast.error(t.vmActions.stillBeingCreated)
      } else {
        toast.error(t.vmActions.deleteFailed)
      }
    }
  }

  return (
    <>
      {vm.transition !== null && (
        <Button variant="ghost" size="sm" disabled className="text-xs text-faint">
          {`${vm.transition}…`}
        </Button>
      )}
      {canStopVm(vm) && (
        <Button variant="outline" size="sm" className="text-xs" onClick={handleStop} disabled={stopVm.isPending}>
          {t.vmActions.stop}
        </Button>
      )}
      {canStartVm(vm) && (
        <Button variant="outline" size="sm" className="text-xs" onClick={handleStart} disabled={startVm.isPending}>
          {vm.currentState === 'Frozen' ? t.vmActions.resume : t.vmActions.start}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-faint hover:text-bad"
        disabled={!canDeleteVm(vm)}
        onClick={() => setConfirmDelete(true)}
      >
        {t.common.delete}
      </Button>
      <DeleteConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={vm.name}
        onConfirm={handleConfirmDelete}
        loading={deleteVm.isPending}
      />
    </>
  )
}
