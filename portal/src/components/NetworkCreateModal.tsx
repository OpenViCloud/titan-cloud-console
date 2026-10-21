import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateNetwork } from '@/hooks/useNetworks'
import { useZones } from '@/hooks/useZones'
import type { AxiosError } from 'axios'
import { useT } from '@/i18n/LanguageContext'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

const CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/(\d|[1-2]\d|3[0-2])$/

// The uplink of a network with public IPv6 routes only these ranges; the server refuses any other CIDR
// (docs/features/network/design.md#ipv6-public).
function isInsideAPrivateRange(cidr: string): boolean {
  const [address, prefixText] = cidr.split('/')
  const octets = address.split('.').map(Number)
  const prefix = Number(prefixText)
  const first = octets[0]
  const second = octets[1]
  if (first === 10) {
    return prefix >= 8
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return prefix >= 12
  }
  if (first === 192 && second === 168) {
    return prefix >= 16
  }
  return false
}

export function NetworkCreateModal({ open, onOpenChange, onCreated }: Props) {
  const { data: zones = [] } = useZones()
  const [name, setName] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [cidr, setCidr] = useState('')
  const [enableIpv6, setEnableIpv6] = useState(false)
  const [nameError, setNameError] = useState('')
  const [cidrError, setCidrError] = useState('')
  const [zoneError, setZoneError] = useState('')
  const [apiError, setApiError] = useState('')

  const createNetwork = useCreateNetwork()
  const t = useT()

  function validate() {
    let valid = true
    if (!name.trim()) { setNameError(t.networkCreate.nameRequired); valid = false }
    else setNameError('')
    if (zoneId === '') {
      setZoneError(t.networkCreate.zoneRequired)
      valid = false
    } else {
      setZoneError('')
    }
    if (cidr && !CIDR_REGEX.test(cidr)) {
      setCidrError(t.networkCreate.cidrInvalid)
      valid = false
    } else if (cidr && enableIpv6 && !isInsideAPrivateRange(cidr)) {
      setCidrError(t.networkCreate.cidrNotPrivate)
      valid = false
    } else setCidrError('')
    return valid
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setApiError('')
    try {
      await createNetwork.mutateAsync({
        name,
        zoneId,
        ...(cidr ? { cidr } : {}),
        ...(enableIpv6 ? { enablePublicIpv6: true } : {}),
      })
      handleClose()
      onCreated?.()
    } catch (err) {
      const res = (err as AxiosError<{ code?: string }>).response
      const code = res?.data?.code
      if (res?.status === 409 && code === 'IPV6_ALLOCATION_CONFLICT') {
        setApiError(t.networkCreate.ipv6Conflict)
      } else if (res?.status === 409) {
        setApiError(t.networkCreate.nameTaken)
      } else if (res?.status === 422 && code === 'IPV6_QUOTA_EXCEEDED') {
        setApiError(t.networkCreate.ipv6QuotaExceeded)
      } else if (res?.status === 422 && code === 'IPV6_NOT_AVAILABLE') {
        setApiError(t.networkCreate.ipv6NotAvailable)
      } else if (res?.status === 422 && code === 'NETWORK_CIDR_OVERLAP') {
        setApiError(t.networkCreate.cidrOverlap)
      } else if (res?.status === 422 && code === 'NETWORK_QUOTA_EXCEEDED') {
        setApiError(t.networkCreate.quotaExceeded)
      } else if (res?.status === 403 && code === 'TENANT_SUSPENDED') {
        setApiError(t.networkCreate.suspended)
      } else if (res?.status === 403 && code === 'TENANT_PENDING_APPROVAL') {
        setApiError(t.networkCreate.pendingApproval)
      } else {
        setApiError(t.networkCreate.genericError)
      }
    }
  }

  function handleClose() {
    setName(''); setZoneId(''); setCidr(''); setEnableIpv6(false)
    setNameError(''); setZoneError(''); setCidrError(''); setApiError('')
    onOpenChange(false)
  }

  const canSubmit = !createNetwork.isPending

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.networkCreate.title}</DialogTitle>
          <DialogDescription>{t.networkCreate.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-soft-foreground">{t.networkCreate.name}</label>
            <Input
              placeholder={t.networkCreate.namePlaceholder}
              value={name}
              onChange={e => { setName(e.target.value); setNameError('') }}
              error={nameError}
              disabled={createNetwork.isPending}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-soft-foreground">{t.networkCreate.zone}</label>
            {zones.length === 0 ? (
              <div className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">
                {t.networkCreate.noZones}
              </div>
            ) : (
              <select
                className="w-full rounded-md border border-border bg-popover px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                value={zoneId}
                onChange={e => setZoneId(e.target.value)}
                disabled={createNetwork.isPending}
              >
                <option value="">{t.networkCreate.selectZone}</option>
                {zones.map(z => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            )}
            {zoneError && <p className="text-[12px] text-bad">{zoneError}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-[13px] font-medium text-soft-foreground">{t.networkCreate.cidr}</label>
              <span className="text-[11px] text-faint border border-border rounded px-1.5 py-0.5">{t.networkCreate.optional}</span>
            </div>
            <Input
              placeholder={t.networkCreate.cidrPlaceholder}
              value={cidr}
              onChange={e => { setCidr(e.target.value); setCidrError('') }}
              error={cidrError}
              disabled={createNetwork.isPending}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <input
                id="enablePublicIpv6"
                type="checkbox"
                className="w-4 h-4 rounded accent-primary"
                checked={enableIpv6}
                onChange={e => { setEnableIpv6(e.target.checked); setCidrError('') }}
                disabled={createNetwork.isPending}
              />
              <label htmlFor="enablePublicIpv6" className="text-[13px] text-soft-foreground select-none cursor-pointer">
                {t.networkCreate.enableIpv6}
              </label>
            </div>
            <p className="text-[12px] text-faint">{t.networkCreate.enableIpv6Hint}</p>
          </div>

          {apiError && (
            <p className="text-xs text-bad bg-bad-soft border border-bad-border rounded-md px-3 py-2">
              {apiError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={createNetwork.isPending}>{t.common.cancel}</Button>
            </DialogClose>
            <Button type="submit" disabled={createNetwork.isPending || !canSubmit}>
              {createNetwork.isPending ? t.networkCreate.creating : t.networkCreate.submit}

            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
