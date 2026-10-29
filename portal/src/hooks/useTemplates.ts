import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Field names mirror the control-plane TemplateQueryResult (camelCase): `os` = OsImageName.
interface TemplateInfo { id: string; name: string; os: string }

// Templates synced in any cluster — enough to name the template of a VM that already exists, wherever it runs.
export function useTemplates() {
  return useQuery({
    queryKey: ['templates', 'any-cluster'],
    queryFn: () => api.get<TemplateInfo[]>('/v1/templates').then(r => r.data),
  })
}

// What a VM in this cluster can be created from: each cluster holds its own copy of a template, and one not
// synced there yet is not offered (titan-ops features/catalog/design.md#template-per-cluster). Waits for a cluster.
export function useClusterTemplates(clusterId: string) {
  return useQuery({
    queryKey: ['templates', clusterId],
    queryFn: () => api.get<TemplateInfo[]>('/v1/templates', { params: { clusterId } }).then(r => r.data),
    enabled: clusterId !== '',
  })
}

export function useTemplateMap(): Map<string, string> {
  const { data = [] } = useTemplates()
  return new Map(data.map(t => [t.id, `${t.name} — ${t.os}`]))
}
