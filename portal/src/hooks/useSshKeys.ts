import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useIdempotencyKey } from '@/lib/idempotency'
import { useTenant } from '@/contexts/TenantContext'

export interface SshKey {
  id: string
  name: string
  type: string
  fingerprint: string
  createdAt: string
}

export interface AddSshKeyRequest {
  name: string
  publicKey: string
}

export function useSshKeys() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['ssh-keys', tenantId],
    queryFn: () => api.get<SshKey[]>('/v1/tenant/ssh-keys').then(r => r.data),
    enabled: !!tenantId,
  })
}

export function useAddSshKey() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (req: AddSshKeyRequest) =>
      withKey(headers => api.post<{ id: string }>('/v1/tenant/ssh-keys', req, { headers }).then(r => r.data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ssh-keys', tenantId] }),
  })
}

export function useDeleteSshKey() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sshKeyId: string) => api.delete(`/v1/tenant/ssh-keys/${sshKeyId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ssh-keys', tenantId] }),
  })
}
