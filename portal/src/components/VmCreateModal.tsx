import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateVm } from '@/hooks/useVms'
import { useNetworks } from '@/hooks/useNetworks'
import { useZones } from '@/hooks/useZones'
import { useZoneTemplates } from '@/hooks/useTemplates'
import { useVmOfferings, formatOfferingLabel } from '@/hooks/useVmOfferings'
import { useSshKeys } from '@/hooks/useSshKeys'
import type { AxiosError } from 'axios'
import { isUsableNetwork } from '@/lib/networkState'
import { useT } from '@/i18n/LanguageContext'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

function SelectField({ label, value, onChange, options, placeholder, disabled, empty }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { id: string; label: string }[]
  placeholder: string
  disabled?: boolean
  empty?: string
}) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-medium text-soft-foreground">{label}</label>
      {options.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">
          {empty ?? t.vmCreate.noOptions}
        </div>
      ) : (
        <select
          aria-label={label}
          className="w-full rounded-md border border-border bg-popover px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">{placeholder}</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export function VmCreateModal({ open, onOpenChange, onCreated }: Props) {
  const t = useT()
  const [name, setName]           = useState('')
  const [networkId, setNetworkId] = useState('')
  const [zoneId, setZoneId]       = useState('')
  const [templateId, setTemplateId] = useState('')
  const [vmOfferingId, setVmOfferingId] = useState('')
  const [sshKeyIds, setSshKeyIds] = useState<string[]>([])
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError]   = useState('')

  const createVm = useCreateVm()
  const { data: networks = [] }  = useNetworks()
  const { data: zones = [] }     = useZones()
  const { data: zoneTemplates = [] } = useZoneTemplates(zoneId)
  const { data: offerings = [] } = useVmOfferings()
  const { data: sshKeys = [] } = useSshKeys()
  const queryClient = useQueryClient()
  // A key deleted meanwhile (another tab, a refetch) drops out of what is sent; its checkbox is gone already.
  const pickedSshKeyIds = sshKeyIds.filter(id => sshKeys.some(key => key.id === id))

  // A network whose delete is waiting still reads Created on Incus, and the server refuses a VM on it
  // (Network.BeginVmDeployment).
  const activeNetworks = networks.filter(isUsableNetwork)
  // A VM lands on its network's cluster, so only the chosen zone's networks are offered
  // (docs/features/catalog/design.md#zone-is-a-real-choice).
  const zoneNetworks = activeNetworks.filter(n => n.zoneId === zoneId)
  const canSubmit = activeNetworks.length > 0 && !createVm.isPending

  let networkEmptyText = t.vmCreate.noNetworksInZone
  const noZoneChosen = zoneId === ''
  if (activeNetworks.length === 0) {
    networkEmptyText = t.vmCreate.noNetworks
  } else if (noZoneChosen) {
    networkEmptyText = t.vmCreate.selectZoneFirst
  }

  // The chosen template counts only while the chosen zone offers it: switching zone keeps a template synced in
  // both, and drops one the new zone does not have yet (docs/features/catalog/design.md#template-per-zone).
  const templateOfferedInZone = zoneTemplates.some(zt => zt.id === templateId)
  let chosenTemplateId = ''
  if (templateOfferedInZone) {
    chosenTemplateId = templateId
  }
  let templateEmptyText = t.vmCreate.noTemplatesInZone
  if (noZoneChosen) {
    templateEmptyText = t.vmCreate.selectZoneFirst
  }

  function handleZoneChange(nextZoneId: string) {
    setZoneId(nextZoneId)
    const chosenNetworkStaysInZone = activeNetworks.some(n => n.id === networkId && n.zoneId === nextZoneId)
    if (!chosenNetworkStaysInZone) {
      setNetworkId('')
    }
  }

  function toggleSshKey(id: string, picked: boolean) {
    if (picked) {
      setSshKeyIds([...sshKeyIds, id])
    } else {
      setSshKeyIds(sshKeyIds.filter(existing => existing !== id))
    }
  }

  function validate() {
    if (!name.trim()) { setNameError(t.vmCreate.nameRequired); return false }
    if (name.length > 64) { setNameError(t.vmCreate.nameTooLong); return false }
    setNameError('')
    const everyChoiceMade = zoneId !== '' && networkId !== '' && chosenTemplateId !== '' && vmOfferingId !== ''
    if (!everyChoiceMade) {
      setApiError(t.vmCreate.choicesRequired)
      return false
    }
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setApiError('')
    try {
      await createVm.mutateAsync({ name, networkId, zoneId, vmOfferingId, templateId: chosenTemplateId, sshKeyIds: pickedSshKeyIds })
      handleClose()
      onCreated?.()
    } catch (err) {
      const res = (err as AxiosError<{ code?: string }>).response
      const code = res?.data?.code
      if (res?.status === 409) setApiError(t.vmCreate.nameTaken)
      else if (res?.status === 422 && code === 'VM_QUOTA_EXCEEDED') setApiError(t.vmCreate.vmQuotaExceeded)
      else if (res?.status === 404 && code === 'ZONE_NOT_FOUND') setApiError(t.vmCreate.zoneGone)
      else if (res?.status === 422 && code === 'NETWORK_ZONE_MISMATCH') setApiError(t.vmCreate.networkZoneMismatch)
      else if (res?.status === 404 && code === 'VM_OFFERING_NOT_FOUND') setApiError(t.vmCreate.sizeGone)
      else if (res?.status === 422 && code === 'TEMPLATE_UNAVAILABLE') setApiError(t.vmCreate.templateUnavailable)
      else if (res?.status === 422 && code === 'TEMPLATE_NOT_SYNCED') setApiError(t.vmCreate.templateNotSynced)
      else if (res?.status === 403 && code === 'TENANT_SUSPENDED') setApiError(t.vmCreate.tenantSuspended)
      else if (res?.status === 403 && code === 'TENANT_PENDING_APPROVAL') setApiError(t.vmCreate.tenantPendingApproval)
      else if (res?.status === 404 && code === 'SSH_KEY_NOT_FOUND') {
        setApiError(t.vmCreate.sshKeyNotFound)
        queryClient.invalidateQueries({ queryKey: ['ssh-keys'] })
      }
      else setApiError(t.vmCreate.genericError)
    }
  }

  function handleClose() {
    setName(''); setNetworkId(''); setZoneId('')
    setTemplateId(''); setVmOfferingId(''); setSshKeyIds([])
    setNameError(''); setApiError('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.vmCreate.title}</DialogTitle>
          <DialogDescription>{t.vmCreate.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-soft-foreground">{t.vmCreate.name}</label>
            <Input
              placeholder={t.vmCreate.namePlaceholder}
              value={name}
              onChange={e => { setName(e.target.value); setNameError('') }}
              error={nameError}
              disabled={createVm.isPending}
              autoFocus
            />
          </div>

          <SelectField
            label={t.vmCreate.zone}
            value={zoneId}
            onChange={handleZoneChange}
            options={zones.map(z => ({ id: z.id, label: z.name }))}
            placeholder={t.vmCreate.selectZone}
            disabled={createVm.isPending}
          />

          <SelectField
            label={t.vmCreate.network}
            value={networkId}
            onChange={setNetworkId}
            options={zoneNetworks.map(n => ({ id: n.id, label: n.name }))}
            placeholder={t.vmCreate.selectNetwork}
            disabled={createVm.isPending}
            empty={networkEmptyText}
          />

          <SelectField
            label={t.vmCreate.template}
            value={chosenTemplateId}
            onChange={setTemplateId}
            options={zoneTemplates.map(zt => ({ id: zt.id, label: `${zt.name} — ${zt.os}` }))}
            placeholder={t.vmCreate.selectTemplate}
            disabled={createVm.isPending}
            empty={templateEmptyText}
          />

          {/* Size is chosen independently of the OS template (docs/features/catalog/design.md#vm-offering-sizing) — the label spells out
              vCPU/RAM so the customer sees what they are provisioning, not just a tier name. */}
          <SelectField
            label={t.vmCreate.size}
            value={vmOfferingId}
            onChange={setVmOfferingId}
            options={offerings.map(o => ({ id: o.id, label: formatOfferingLabel(o) }))}
            placeholder={t.vmCreate.selectSize}
            disabled={createVm.isPending}
          />

          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium text-soft-foreground">{t.vmCreate.sshKeys}</legend>
            {sshKeys.length === 0 ? (
              <p className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">
                {t.vmCreate.noSshKeysBefore}
                <Link to="/ssh-keys" className="text-primary underline-offset-2 hover:underline">{t.vmCreate.noSshKeysLink}</Link>
                {t.vmCreate.noSshKeysAfter}
              </p>
            ) : (
              <div className="space-y-1.5">
                {sshKeys.map(key => (
                  <div key={key.id} className="flex items-center gap-2.5">
                    <input
                      id={`ssh-key-${key.id}`}
                      type="checkbox"
                      checked={sshKeyIds.includes(key.id)}
                      onChange={e => toggleSshKey(key.id, e.target.checked)}
                      disabled={createVm.isPending}
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <label htmlFor={`ssh-key-${key.id}`} className="text-[13px] text-soft-foreground select-none cursor-pointer">
                      {key.name} <span className="font-mono text-xs text-faint">{key.fingerprint}</span>
                    </label>
                  </div>
                ))}
                <p className="text-xs text-faint">{t.vmCreate.sshKeysHint}</p>
              </div>
            )}
          </fieldset>

          {apiError && (
            <p className="text-xs text-bad bg-bad-soft border border-bad-border rounded-md px-3 py-2">
              {apiError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={createVm.isPending} onClick={handleClose}>
                {t.common.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={createVm.isPending || !canSubmit}>
              {createVm.isPending ? t.vmCreate.creating : t.vmCreate.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
