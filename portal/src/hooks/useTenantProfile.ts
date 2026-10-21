import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface TenantProfile {
  id: string
  name: string
  status: string
  maxVms: number
  maxNetworks: number
  // Absent while the control plane still runs an image older than these two fields.
  maxVolumes?: number
  maxPublicIpv6?: number
}

export function useTenantProfile() {
  return useQuery({
    queryKey: ['tenant-profile'],
    queryFn: () => api.get<TenantProfile>('/v1/tenant').then(r => r.data),
  })
}
