import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'

export interface VmCostSummary {
  vmId: string
  vmName: string
  totalCost: number
}

export interface BillingSummary {
  month: string
  totalCost: number
  currency: string
  perVm: VmCostSummary[]
}

export function useBillingSummary(month: string) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['billing-summary', tenantId, month],
    queryFn: () =>
      api
        .get<BillingSummary>(`/v1/tenant/billing/summary`, {
          params: { month },
        })
        .then(r => r.data),
    enabled: !!tenantId,
  })
}
