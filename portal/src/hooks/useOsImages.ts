import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface OsImageInfo { id: string; name: string; sizeGb: number }

export function useOsImages() {
  return useQuery({
    queryKey: ['os-images'],
    queryFn: () => api.get<OsImageInfo[]>('/v1/os-images').then(r => r.data),
  })
}
