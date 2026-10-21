import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'
import { useIdempotencyKey } from '@/lib/idempotency'

export type TopUpStatus = 'Pending' | 'Confirmed' | 'Failed'
export type StatementLineType = 'TopUp' | 'Promo' | 'Spend'

// docs/architecture/money-and-wallet.md#wallet-one-balance — the wallet is one balance. The credit-lot breakdown that used to ride along in `entries`
// is gone from the API: nothing here ever rendered it, and after docs/architecture/money-and-wallet.md#credit-is-money the lots meant nothing to
// render. Movement history comes from the statement below.
export interface Wallet {
  balance: number
  currency: string
}

export interface StatementLine {
  at: string
  type: StatementLineType
  amount: number
  runningBalance: number
}

export interface WalletStatement {
  openingBalance: number
  closingBalance: number
  currency: string
  lines: StatementLine[]
}

export interface TopUp {
  id: string
  tenantId: string
  amount: number
  currency: string
  status: TopUpStatus
  paymentRef: string
  source: string | null
  createdAt: string
  confirmedAt: string | null
}

export function useWallet() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wallet', tenantId],
    queryFn: () => api.get<Wallet>('/v1/tenant/wallet').then(r => r.data),
    enabled: !!tenantId,
  })
}

export function useWalletStatement() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wallet-statement', tenantId],
    queryFn: () => api.get<WalletStatement>('/v1/tenant/wallet/statement').then(r => r.data),
    enabled: !!tenantId,
  })
}

// poll: while a top-up is awaiting payment we refetch so the SePay webhook's confirmation surfaces
// without a manual reload (mirrors pollUntilSettled for VMs). Stops when disabled by the caller.
export function useTopUps(poll = false) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['topups', tenantId],
    queryFn: () => api.get<TopUp[]>('/v1/tenant/topups').then(r => r.data),
    enabled: !!tenantId,
    refetchInterval: poll ? 5000 : false,
  })
}

// docs/architecture/http-contract.md#create-returns-id: a create answers with the id it just minted and nothing else, so this returns the id and
// the caller reads the rest back with the topups query. That matters here more than elsewhere: the
// QR the customer scans carries `paymentRef`, which SePay uses to match an incoming transfer to this
// top-up. The portal knows the amount (it just typed it) but CANNOT know paymentRef — the server
// mints it — so WalletPage must wait for the query rather than render a QR without one.
export interface CreateTopUpResult {
  topUpId: string
}

export function useCreateTopUp() {
  const qc = useQueryClient()
  const { tenantId } = useTenant()
  const withKey = useIdempotencyKey() // docs/architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (amount: number) =>
      withKey(headers => api.post<CreateTopUpResult>('/v1/tenant/topups', { amount }, { headers }).then(r => r.data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['topups', tenantId] })
    },
  })
}
