import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pollWhileVolumesWait } from '@/lib/volumeState'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'

// One status (lib/volumeState.ts): Creating | Attaching | Detaching | Deleting while a request waits, else Available |
// NotFound | Failed. Who uses the volume is the attachment pair beside it.
export interface Volume {
  id: string
  name: string
  status: string
  currentAttachedVmId: string | null
  currentAttachedElsewhere: boolean
  desiredAttachedVmId: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  clusterId: string
  volumeOfferingId: string
  sizeGb: number
  createdAt: string
}

interface CreateVolumeRequest {
  name: string
  volumeOfferingId: string
  clusterId: string
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
    refetchInterval: q => pollWhileVolumesWait(q.state.data),
  })
}

export function useCreateVolume() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // titan-ops architecture/http-contract.md#idempotency-key: one key per submission
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
