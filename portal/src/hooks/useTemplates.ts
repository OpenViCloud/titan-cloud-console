import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Field names mirror the control-plane TemplateQueryResult (camelCase): `os` = OsImageName.
interface TemplateInfo { id: string; name: string; os: string }

// Templates synced in any zone — enough to name the template of a VM that already exists, wherever it runs.
export function useTemplates() {
  return useQuery({
    queryKey: ['templates', 'any-zone'],
    queryFn: () => api.get<TemplateInfo[]>('/v1/templates').then(r => r.data),
  })
}

// What a VM in this zone can be created from: each zone's cluster holds its own copy of a template, and one not
// synced there yet is not offered (docs/features/catalog/design.md#template-per-zone). Waits for a zone.
export function useZoneTemplates(zoneId: string) {
  return useQuery({
    queryKey: ['templates', zoneId],
    queryFn: () => api.get<TemplateInfo[]>('/v1/templates', { params: { zoneId } }).then(r => r.data),
    enabled: zoneId !== '',
  })
}

export function useTemplateMap(): Map<string, string> {
  const { data = [] } = useTemplates()
  return new Map(data.map(t => [t.id, `${t.name} — ${t.os}`]))
}
