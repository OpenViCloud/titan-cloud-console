import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pollWhileVmWaits, type VmStatus } from '@/lib/vmState'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'

export interface Vm {
  id: string
  name: string
  // One status, see lib/vmState.ts
  status: VmStatus
  requestFailureReason: string | null
  requestFailedAt: string | null
  ipAddress: string | null
  publicIpv6Address: string | null
  networkId: string
  vmOfferingId: string
  templateId: string
  clusterId: string
  diskSizeGb: number
  createdAt: string
}

interface CreateVmRequest {
  name: string
  networkId: string
  clusterId: string
  vmOfferingId: string
  templateId: string
  diskSizeGb?: number
  sshKeyIds?: string[]
}

export function useVms() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['vms', tenantId],
    queryFn: () => api.get<Vm[]>(`/v1/tenant/vms`).then(r => r.data),
    enabled: !!tenantId,
    // A waiting request is the server's status (Starting, Stopping…), so the list refreshes until it settles; the page
    // does not remember what it clicked.
    refetchInterval: q => pollWhileVmWaits(q.state.data),
  })
}

export function useCreateVm() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // titan-ops architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (req: CreateVmRequest) =>
      withKey(headers => api.post(`/v1/tenant/vms`, req, { headers })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vms', tenantId] }),
  })
}

export function useDeleteVm() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vmId: string) =>
      api.delete(`/v1/tenant/vms/${vmId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vms', tenantId] }),
  })
}

export function useStopVm() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vmId: string) =>
      api.post(`/v1/tenant/vms/${vmId}/stop`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vms', tenantId] }),
  })
}

export function useStartVm() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vmId: string) =>
      api.post(`/v1/tenant/vms/${vmId}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vms', tenantId] }),
  })
}
