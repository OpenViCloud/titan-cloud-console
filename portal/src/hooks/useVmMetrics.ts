import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'

export type VmMetricsRange = '1h' | '24h' | '7d'

// 1h gives one point per sample, 24h and 7d one per step that has samples. A null field is a number the control plane
// does not have: Incus reported none, CPU and the rates on the first sample, a restart or a change of source, or CPU
// when the VM has no offering.
export interface VmMetricPoint {
  at: string
  cpuPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  rootFsUsedBytes: number | null
  rootFsSizeBytes: number | null
  diskReadBytesPerSecond: number | null
  diskWriteBytesPerSecond: number | null
}

export interface VmMetrics {
  range: VmMetricsRange
  stepSeconds: number
  points: VmMetricPoint[]
}

// The worker sends a sample every minute (titan-ops features/vm/design.md#vm-metrics).
const REFRESH_MS = 60_000

export function useVmMetrics(vmId: string | undefined, range: VmMetricsRange) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['vm-metrics', tenantId, vmId, range],
    queryFn: () =>
      api
        .get<VmMetrics>(`/v1/tenant/vms/${vmId}/metrics`, { params: { range } })
        .then(r => r.data),
    enabled: !!tenantId && !!vmId,
    refetchInterval: REFRESH_MS,
  })
}
