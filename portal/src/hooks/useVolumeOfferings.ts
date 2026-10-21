import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface VolumeOffering {
  id: string
  name: string
  sizeGb: number
  isCustomized: boolean
}

export function useVolumeOfferings() {
  return useQuery({
    queryKey: ['volume-offerings'],
    queryFn: () => api.get<VolumeOffering[]>('/v1/volume-offerings').then(r => r.data),
  })
}

export function useVolumeOfferingMap() {
  const { data = [] } = useVolumeOfferings()
  return new Map(data.map(o => [o.id, o]))
}
