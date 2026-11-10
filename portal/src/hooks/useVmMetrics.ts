import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'

export type VmMetricsRange = '1h' | '24h' | '7d'

// One point per step; a field is null where Incus had no number (no guest agent, first sample, a counter reset).
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
