import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Lang } from '@/i18n/lang'

// US-LEGAL — click-wrap consent (docs/features/legal/design.md#consent-gate-per-user). Consent is per-USER (Keycloak sub), so these queries are NOT
// keyed by tenantId — a tenant's members each accept individually.

export interface ConsentStatus {
  mustAcceptTerms: boolean
  documentKey: string
  documentVersion: string
}

export interface LegalDocument {
  key: string
  version: string
  title: string
  content: string
  effectiveAt: string
  lang: Lang
}

// US-LEGAL-01 — whether the current caller still owes consent for the current document version.
export function useConsentStatus() {
  return useQuery({
    queryKey: ['consent-status'],
    queryFn: () => api.get<ConsentStatus>('/v1/legal/consent-status').then(r => r.data),
  })
}

// US-LEGAL-01 — record the caller's acceptance, then re-check status so the gate clears.
export function useAcceptTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/v1/legal/acceptance'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consent-status'] }),
  })
}

// US-LEGAL-03 — the public legal document (anonymous). Used by the /legal/terms page and linked from the
// consent gate + footer. Both texts carry the same version, so accepting after reading either one counts
// (docs/features/legal/design.md#legal-endpoints). The language is in the key: switching shows the other text.
export function useLegalDocument(lang: Lang) {
  return useQuery({
    queryKey: ['legal-document', lang],
    queryFn: () => api.get<LegalDocument>('/v1/legal/document', { params: { lang } }).then(r => r.data),
  })
}
