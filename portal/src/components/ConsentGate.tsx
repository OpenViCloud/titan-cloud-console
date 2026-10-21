import type { ReactNode } from 'react'
import { useConsentStatus } from '@/hooks/useLegal'
import { ConsentGatePage } from '@/pages/ConsentGatePage'
import { useT } from '@/i18n/LanguageContext'

// US-LEGAL-01 — gates the app behind click-wrap consent. Rendered inside TenantProvider for tenants that
// would otherwise reach the app (Active, or Suspended for reads). Shows the consent gate when the caller still owes
// consent for the current document version; otherwise renders the app.
//
// On error we fail OPEN (render the app): consent is a legal-record mechanism, not a server-side access
// control (no other endpoint rejects an un-accepted caller in the MVP), so a transient /legal outage must
// not lock a user out of their own resources. A successful "mustAcceptTerms" still gates.
export function ConsentGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useConsentStatus()
  const t = useT()

  if (isLoading) return <div data-testid="consent-loading">{t.common.loading}</div>
  if (data?.mustAcceptTerms) return <ConsentGatePage />
  return <>{children}</>
}
