import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Field names mirror the control-plane VmOfferingDto (camelCase).
interface VmOfferingInfo {
  id: string
  name: string
  cpu: number
  vcpu: number
  memoryMb: number
}

export function useVmOfferings() {
  return useQuery({
    queryKey: ['vm-offerings'],
    queryFn: () => api.get<VmOfferingInfo[]>('/v1/vm-offerings').then(r => r.data),
  })
}

// Spell out the size in the option label — the tier name alone ("Medium") does not tell the
// customer what they are about to provision or be billed for.
export function formatOfferingLabel(o: VmOfferingInfo): string {
  return `${o.name} — ${o.vcpu} vCPU · ${o.memoryMb / 1024} GB`
}

export type { VmOfferingInfo }
