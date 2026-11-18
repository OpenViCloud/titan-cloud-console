import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// titan-ops features/vm/design.md#vm-key-addition — a child entity of Vm with its own three-state lifecycle
// (Adding -> Added/Failed); the VM's own status never changes because of it, so the VM page cannot show progress:
// the dialog follows the one addition it created, by id.
export interface VmKeyAddition {
  id: string
  status: 'Adding' | 'Added' | 'Failed'
  sshKeyIds: string[]
  restartNeeded: boolean
  requestFailureReason: string | null
  requestFailedAt: string | null
  createdAt: string
}

export function useCreateKeyAddition(vmId: string) {
  const withKey = useIdempotencyKey() // titan-ops architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (sshKeyIds: string[]) =>
      withKey(headers =>
        api.post<{ keyAdditionId: string }>(`/v1/tenant/vms/${vmId}/key-additions`, { sshKeyIds }, { headers }),
      ).then(r => r.data),
  })
}

// Followed right after a submit: refreshes while the worker has not reported back yet, then stops.
export function useVmKeyAddition(vmId: string, keyAdditionId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['vm-key-addition', tenantId, vmId, keyAdditionId],
    queryFn: () =>
      api.get<VmKeyAddition>(`/v1/tenant/vms/${vmId}/key-additions/${keyAdditionId}`).then(r => r.data),
    enabled: !!tenantId && keyAdditionId !== null,
    refetchInterval: q => (q.state.data?.status === 'Adding' ? POLL_MS : false),
  })
}
