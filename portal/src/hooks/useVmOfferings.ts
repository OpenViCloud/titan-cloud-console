import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Field names mirror the control-plane VmOfferingDto (camelCase).
interface VmOfferingInfo {
  id: string
  name: string
  vcpu: number
  memoryMb: number
  pricePerHour: number
}

export function useVmOfferings() {
  return useQuery({
    queryKey: ['vm-offerings'],
    queryFn: () => api.get<VmOfferingInfo[]>('/v1/vm-offerings').then(r => r.data),
  })
}

export type { VmOfferingInfo }
