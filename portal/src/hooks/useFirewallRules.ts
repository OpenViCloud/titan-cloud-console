import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useIdempotencyKey } from '@/lib/idempotency'
import { pollWhileIncusWaits } from '@/lib/networkState'

export interface FirewallRule {
  id: string
  direction: string
  protocol: string
  startPort: number | null
  endPort: number | null
  cidr: string
  externalId: string | null
  // The Incus ACL rule state (enabled · disabled · logged) or null — see lib/networkState.ts. Deleted rules are
  // not listed.
  currentState: string | null
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
  requestFailedAt: string | null
  createdAt: string
}

export interface CreateFirewallRuleRequest {
  direction: string
  protocol: string
  startPort: number | null
  endPort: number | null
  cidr: string
}

export function useFirewallRules(networkId: string, enabled = true) {
  return useQuery({
    queryKey: ['firewall-rules', networkId],
    queryFn: () =>
      api
        .get<FirewallRule[]>(`/v1/tenant/networks/${networkId}/firewall-rules`)
        .then(r => r.data),
    enabled,
    refetchInterval: q => pollWhileIncusWaits(q.state.data),
  })
}

export function useCreateFirewallRule(networkId: string) {
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (req: CreateFirewallRuleRequest) =>
      withKey(headers => api.post<FirewallRule>(`/v1/tenant/networks/${networkId}/firewall-rules`, req, { headers }).then(r => r.data)),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['firewall-rules', networkId] }),
  })
}

export function useDeleteFirewallRule(networkId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ruleId: string) =>
      api.delete(`/v1/tenant/networks/${networkId}/firewall-rules/${ruleId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['firewall-rules', networkId] }),
  })
}
