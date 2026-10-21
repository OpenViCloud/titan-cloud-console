import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pollWhileIncusWaits } from '@/lib/networkState'
import { useIdempotencyKey } from '@/lib/idempotency'

export interface Network {
  id: string
  name: string
  // docs/architecture/desired-and-current.md#provider-state-is-verbatim — see lib/networkState.ts
  currentState: string | null
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  cidr: string | null
  gateway: string | null
  // The network's public /64; null when it has no public IPv6 (docs/features/network/design.md#ipv6-public).
  publicIpv6Subnet: string | null
  zoneId: string
  createdAt: string
}

interface CreateNetworkRequest {
  name: string
  zoneId: string
  cidr?: string
  enablePublicIpv6?: boolean
}

export function useNetworks() {
  return useQuery({
    queryKey: ['networks'],
    queryFn: () => api.get<Network[]>('/v1/tenant/networks').then(r => r.data),
    refetchInterval: q => pollWhileIncusWaits(q.state.data),
  })
}

export function useCreateNetwork() {
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (req: CreateNetworkRequest) =>
      withKey(headers => api.post('/v1/tenant/networks', req, { headers })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networks'] }),
  })
}

// B-N02 — rename is CP-only metadata: PATCH returns the updated network synchronously (200), with no
// provider command to poll, so invalidating the list is enough to reflect it.
export function useRenameNetwork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ networkId, name }: { networkId: string; name: string }) =>
      // docs/architecture/http-contract.md#commands-return-no-data: 204 with no body — the list is re-read.
      api.patch(`/v1/tenant/networks/${networkId}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networks'] }),
  })
}

export function useDeleteNetwork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (networkId: string) =>
      api.delete(`/v1/tenant/networks/${networkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networks'] }),
  })
}
