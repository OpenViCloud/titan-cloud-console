import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'
import { pollWhileStorageWaits } from '@/lib/storageState'

// Incus has no status word for an instance snapshot (lib/storageState.ts): currentExistence NotCreated | Exists |
// NotFound (Deleted rows are not listed); desiredExistence Exists | Deleted; transition Creating | Reverting | Deleting
// while a request waits.
export interface VmSnapshot {
  id: string
  name: string
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  createdAt: string
}

export function useVmSnapshots(vmId: string, enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['vm-snapshots', tenantId, vmId],
    queryFn: () =>
      api
        .get<VmSnapshot[]>(`/v1/tenant/vms/${vmId}/snapshots`)
        .then(r => r.data),
    enabled: !!tenantId && enabled,
    // A snapshot being created, reverted to or deleted refreshes until the worker reports back.
    refetchInterval: q => pollWhileStorageWaits(q.state.data),
  })
}

export function useCreateVmSnapshot(vmId: string) {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (name: string) =>
      withKey(headers => api.post(`/v1/tenant/vms/${vmId}/snapshots`, { name }, { headers })),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['vm-snapshots', tenantId, vmId] }),
  })
}

export function useDeleteVmSnapshot(vmId: string) {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.delete(`/v1/tenant/vms/${vmId}/snapshots/${snapshotId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['vm-snapshots', tenantId, vmId] }),
  })
}

export function useRevertVmSnapshot(vmId: string) {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.post(`/v1/tenant/vms/${vmId}/snapshots/${snapshotId}/revert`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vm-snapshots', tenantId, vmId] })
      qc.invalidateQueries({ queryKey: ['vms', tenantId] })
    },
  })
}
