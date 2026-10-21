import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pollWhileStorageWaits } from '@/lib/storageState'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'

// Incus has no status word for a volume: whether it holds it, and which instance uses it — lib/storageState.ts.
export interface Volume {
  id: string
  name: string
  currentExistence: string
  desiredExistence: string
  currentAttachedVmId: string | null
  currentAttachedElsewhere: boolean
  desiredAttachedVmId: string | null
  transition: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  zoneId: string
  volumeOfferingId: string
  sizeGb: number
  createdAt: string
}

interface CreateVolumeRequest {
  name: string
  volumeOfferingId: string
  zoneId: string
  sizeGb: number
}

interface AttachVolumeRequest {
  vmId: string
}

export function useVolumes() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['volumes', tenantId],
    queryFn: () => api.get<Volume[]>(`/v1/tenant/volumes`).then(r => r.data),
    enabled: !!tenantId,
    refetchInterval: q => pollWhileStorageWaits(q.state.data),
  })
}

export function useCreateVolume() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (req: CreateVolumeRequest) =>
      withKey(headers => api.post(`/v1/tenant/volumes`, req, { headers })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volumes', tenantId] }),
  })
}

export function useDeleteVolume() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (volumeId: string) =>
      api.delete(`/v1/tenant/volumes/${volumeId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volumes', tenantId] }),
  })
}

export function useAttachVolume() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ volumeId, vmId }: { volumeId: string; vmId: string }) =>
      api.post<AttachVolumeRequest>(`/v1/tenant/volumes/${volumeId}/attach`, { vmId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volumes', tenantId] }),
  })
}

export function useDetachVolume() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (volumeId: string) =>
      api.post(`/v1/tenant/volumes/${volumeId}/detach`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volumes', tenantId] }),
  })
}
