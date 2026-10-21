import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'

export interface Member {
  id: string
  keycloakUserId: string
  joinedAt: string
}

export function useMembers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => api.get<Member[]>('/v1/tenant/members').then(r => r.data),
    enabled: !!tenantId,
  })
}
