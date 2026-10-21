import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TenantContext } from '@/contexts/TenantContext'
import { FixedLanguage } from './FixedLanguage'
import type { Lang } from '@/i18n/lang'

interface TenantData { tenantId: string; tenantName: string; status: string }

const defaultTenant: TenantData = { tenantId: 'tenant-1', tenantName: 'alice', status: 'Active' }

export function renderWithProviders(
  ui: ReactNode,
  options?: { tenant?: TenantData; lang?: Lang },
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tenant = options?.tenant ?? defaultTenant
  const lang = options?.lang ?? 'en'

  return render(
    <QueryClientProvider client={qc}>
      <TenantContext.Provider value={tenant}>
        <FixedLanguage lang={lang}>
          {ui}
        </FixedLanguage>
      </TenantContext.Provider>
    </QueryClientProvider>,
  )
}
