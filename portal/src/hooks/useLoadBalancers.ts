import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useIdempotencyKey } from '@/lib/idempotency'
import { pollWhileLoadBalancersWait, type ListenerFields } from '@/lib/loadBalancerState'

// docs/features/load-balancer/design.md#lb-resource-model — listeners and backends are what the customer last asked
// for; transition says whether Incus has it yet.
export interface LoadBalancer {
  id: string
  name: string
  networkId: string
  zoneId: string
  vip: string
  listeners: ListenerFields[]
  backends: { vmId: string }[]
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  createdAt: string
}

export interface LoadBalancerSpec {
  listeners: ListenerFields[]
  backends: { vmId: string }[]
}

export interface CreateLoadBalancerRequest extends LoadBalancerSpec {
  name: string
  networkId: string
}

const KEY = ['load-balancers']

export function useLoadBalancers() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<LoadBalancer[]>('/v1/tenant/load-balancers').then(r => r.data),
    refetchInterval: q => pollWhileLoadBalancersWait(q.state.data),
  })
}

export function useCreateLoadBalancer() {
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (req: CreateLoadBalancerRequest) =>
      withKey(headers => api.post('/v1/tenant/load-balancers', req, { headers })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateLoadBalancer() {
  const qc = useQueryClient()
  return useMutation({
    // The whole configuration; 204 with no body (docs/architecture/http-contract.md#commands-return-no-data).
    mutationFn: ({ id, spec }: { id: string; spec: LoadBalancerSpec }) =>
      api.put(`/v1/tenant/load-balancers/${id}`, spec),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteLoadBalancer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/tenant/load-balancers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
