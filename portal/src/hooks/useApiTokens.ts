import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { IDEMPOTENCY_HEADER, useIdempotencyKey } from '@/lib/idempotency'
import { useTenant } from '@/contexts/TenantContext'

export interface ApiToken {
  id: string
  name: string
  prefix: string
  createdAt: string
  /** null: never expires */
  expiresAt: string | null
}

export const API_TOKEN_LIFETIMES = [30, 90, 365] as const

export interface CreateApiTokenRequest {
  name: string
  /** 30, 90 or 365; null for a token that never expires */
  expiresInDays: number | null
}

export interface CreatedApiToken {
  apiTokenId: string
  /** The secret, shown once: the server keeps only its hash (docs/features/public-api/design.md#api-token). */
  secret: string
}

/** ovc_ + 32 random bytes in base64url without padding: 43 characters. */
export function newApiTokenSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return 'ovc_' + base64url
}

/**
 * The secret lives exactly as long as the Idempotency-Key of its submission: a retry under the same key sends the same
 * secret (another body would be IDEMPOTENCY_KEY_REUSED, and a create whose answer was lost would leave a token nobody
 * saw); a new key gets a new secret.
 */
export function secretPerSubmission(newSecret: () => string = newApiTokenSecret): (key: string) => string {
  const secrets = new Map<string, string>()
  return (key: string) => {
    let secret = secrets.get(key)
    if (secret === undefined) {
      secret = newSecret()
      secrets.set(key, secret)
    }
    return secret
  }
}

export function useApiTokens() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['api-tokens', tenantId],
    queryFn: () => api.get<ApiToken[]>('/v1/tenant/api-tokens').then(r => r.data),
    enabled: !!tenantId,
  })
}

export function useCreateApiToken() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const withKey = useIdempotencyKey()
  const [secretFor] = useState(() => secretPerSubmission())
  return useMutation({
    mutationFn: (req: CreateApiTokenRequest) =>
      withKey(async headers => {
        const secret = secretFor(headers[IDEMPOTENCY_HEADER])
        const body = { name: req.name, token: secret, expiresInDays: req.expiresInDays }
        const response = await api.post<{ apiTokenId: string }>('/v1/tenant/api-tokens', body, { headers })
        const created: CreatedApiToken = { apiTokenId: response.data.apiTokenId, secret }
        return created
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens', tenantId] }),
  })
}

export function useDeleteApiToken() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (apiTokenId: string) => api.delete(`/v1/tenant/api-tokens/${apiTokenId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens', tenantId] }),
  })
}
