import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'
import { pollWhileStorageWaits } from '@/lib/storageState'

// Incus has no status word for a volume snapshot (lib/storageState.ts).
export interface VolumeSnapshot {
  id: string
  volumeId: string
  name: string
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  createdAt: string
}

interface RestoreResult {
  newVolumeId: string
}

export function useVolumeSnapshots(volumeId: string, enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['volume-snapshots', tenantId, volumeId],
    queryFn: () =>
      api
        .get<VolumeSnapshot[]>(`/v1/tenant/volumes/${volumeId}/snapshots`)
        .then(r => r.data),
    enabled: !!tenantId && enabled,
    // A snapshot being created or deleted refreshes until the worker reports back.
    refetchInterval: q => pollWhileStorageWaits(q.state.data),
  })
}

export function useCreateVolumeSnapshot(volumeId: string) {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (name: string) =>
      withKey(headers => api.post(`/v1/tenant/volumes/${volumeId}/snapshots`, { name }, { headers })),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['volume-snapshots', tenantId, volumeId] }),
  })
}

export function useDeleteVolumeSnapshot(volumeId: string) {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.delete(`/v1/tenant/volumes/${volumeId}/snapshots/${snapshotId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['volume-snapshots', tenantId, volumeId] }),
  })
}

export function useRestoreVolumeSnapshot(volumeId: string) {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: ({ snapshotId, name }: { snapshotId: string; name: string }) =>
      withKey(headers => api
        .post<RestoreResult>(
          `/v1/tenant/volumes/${volumeId}/snapshots/${snapshotId}/restore`,
          { name },
          { headers },
        )
        .then(r => r.data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volumes', tenantId] }),
  })
}
