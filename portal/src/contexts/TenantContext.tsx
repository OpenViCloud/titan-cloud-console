import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { api } from '@/lib/api'
import { PendingApprovalPage } from '@/pages/PendingApprovalPage'
import { ConsentGate } from '@/components/ConsentGate'
import { useT } from '@/i18n/LanguageContext'
import { browserStorage, signinArgs } from '@/i18n/lang'

interface TenantData {
  tenantId: string
  tenantName: string
  status: string
}

export const TenantContext = createContext<TenantData | null>(null)

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [tenantError, setTenantError] = useState(false)
  const t = useT()

  useEffect(() => {
    if (!auth.isAuthenticated) return
    api.get<{ id: string; name: string; status: string }>('/v1/tenant')
      .then(r => setTenant({ tenantId: r.data.id, tenantName: r.data.name, status: r.data.status }))
      .catch(() => setTenantError(true))
  }, [auth.isAuthenticated])

  if (auth.isLoading) return <div data-testid="auth-loading">{t.common.loading}</div>

  if (!auth.isAuthenticated) {
    auth.signinRedirect(signinArgs(browserStorage()))
    return null
  }

  if (tenantError) return (
    <div data-testid="tenant-error" className="flex items-center justify-center h-screen text-muted-foreground text-sm">
      {t.accountGate.loadFailed}
    </div>
  )

  if (!tenant) return <div data-testid="tenant-loading">{t.common.loading}</div>

  // US-SL-01c — gate PendingApproval to the waiting screen. GET /v1/tenant is allowed
  // for pending tenants (US-SL-02 AC8), but every write op 403s, so the app is unusable;
  // show why instead of a dashboard full of silent failures. Active and Suspended fall through.
  if (tenant.status === 'PendingApproval') return <PendingApprovalPage tenantName={tenant.tenantName} />

  // US-LEGAL-01 — an Active tenant still passes through the click-wrap consent gate: a user
  // who has not accepted the current terms is gated before reaching the app (per-user, docs/features/legal/design.md#consent-gate-per-user).
  return (
    <TenantContext.Provider value={tenant}>
      <ConsentGate>{children}</ConsentGate>
    </TenantContext.Provider>
  )
}

export function useTenant(): TenantData {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used inside TenantProvider')
  return ctx
}
