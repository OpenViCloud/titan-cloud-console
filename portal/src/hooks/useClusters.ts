import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface ClusterInfo { id: string; name: string }

export function useClusters() {
  return useQuery({
    queryKey: ['clusters'],
    queryFn: () => api.get<ClusterInfo[]>('/v1/clusters').then(r => r.data),
  })
}

export function useClusterMap(): Map<string, string> {
  const { data = [] } = useClusters()
  return new Map(data.map(z => [z.id, z.name]))
}
