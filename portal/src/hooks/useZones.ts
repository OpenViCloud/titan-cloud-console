import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface ZoneInfo { id: string; name: string }

export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: () => api.get<ZoneInfo[]>('/v1/zones').then(r => r.data),
  })
}

export function useZoneMap(): Map<string, string> {
  const { data = [] } = useZones()
  return new Map(data.map(z => [z.id, z.name]))
}
