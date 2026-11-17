import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateVm, type CreateVmRequest } from '@/hooks/useVms'
import { useNetworks } from '@/hooks/useNetworks'
import { useClusters } from '@/hooks/useClusters'
import { useClusterTemplates } from '@/hooks/useTemplates'
import { useVmOfferings, formatOfferingLabel } from '@/hooks/useVmOfferings'
import { useSshKeys } from '@/hooks/useSshKeys'
import type { AxiosError } from 'axios'
import { isUsableNetwork } from '@/lib/networkState'
import { useT } from '@/i18n/LanguageContext'
import { parseStopTimeout, STOP_TIMEOUT_DEFAULT } from '@/lib/vmStopTimeout'

// The length the server accepts (titan-ops features/vm/design.md#console-password); no rule on the kind of characters.
const CONSOLE_PASSWORD_MIN = 12
const CONSOLE_PASSWORD_MAX = 72

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
  const [clusterId, setClusterId]       = useState('')
  const [templateId, setTemplateId] = useState('')
  const [vmOfferingId, setVmOfferingId] = useState('')
  const [sshKeyIds, setSshKeyIds] = useState<string[]>([])
  const [consolePassword, setConsolePassword] = useState('')
  const [stopTimeout, setStopTimeout] = useState(String(STOP_TIMEOUT_DEFAULT))
  const [nameError, setNameError] = useState('')
  const [consolePasswordError, setConsolePasswordError] = useState('')
  const [stopTimeoutError, setStopTimeoutError] = useState('')
  const [apiError, setApiError]   = useState('')

  const createVm = useCreateVm()
  const { data: networks = [] }  = useNetworks()
  const { data: clusters = [] }     = useClusters()
  const { data: clusterTemplates = [] } = useClusterTemplates(clusterId)
  const { data: offerings = [] } = useVmOfferings()
  const { data: sshKeys = [] } = useSshKeys()
  const queryClient = useQueryClient()
  // A key deleted meanwhile (another tab, a refetch) drops out of what is sent; its checkbox is gone already.
  const pickedSshKeyIds = sshKeyIds.filter(id => sshKeys.some(key => key.id === id))

  // A network whose delete is waiting still reads Created on Incus, and the server refuses a VM on it
  // (Network.ProviderIdForVm).
  const activeNetworks = networks.filter(isUsableNetwork)
  // A VM lands on its network's cluster, so only the chosen cluster's networks are offered
  // (titan-ops features/catalog/design.md#cluster-is-a-real-choice).
  const clusterNetworks = activeNetworks.filter(n => n.clusterId === clusterId)
  const canSubmit = activeNetworks.length > 0 && !createVm.isPending

  let networkEmptyText = t.vmCreate.noNetworksInCluster
  const noClusterChosen = clusterId === ''
  if (activeNetworks.length === 0) {
    networkEmptyText = t.vmCreate.noNetworks
  } else if (noClusterChosen) {
    networkEmptyText = t.vmCreate.selectClusterFirst
  }

  // The chosen template counts only while the chosen cluster offers it: switching cluster keeps a template synced in
  // both, and drops one the new cluster does not have yet (titan-ops features/catalog/design.md#template-per-cluster).
  const templateOfferedInCluster = clusterTemplates.some(zt => zt.id === templateId)
  let chosenTemplateId = ''
  if (templateOfferedInCluster) {
    chosenTemplateId = templateId
  }
  let templateEmptyText = t.vmCreate.noTemplatesInCluster
  if (noClusterChosen) {
    templateEmptyText = t.vmCreate.selectClusterFirst
  }

  function handleClusterChange(nextClusterId: string) {
    setClusterId(nextClusterId)
    const chosenNetworkStaysInCluster = activeNetworks.some(n => n.id === networkId && n.clusterId === nextClusterId)
    if (!chosenNetworkStaysInCluster) {
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
    const passwordTooShort = consolePassword !== '' && consolePassword.length < CONSOLE_PASSWORD_MIN
    if (passwordTooShort || consolePassword.length > CONSOLE_PASSWORD_MAX) {
      setConsolePasswordError(t.vmCreate.consolePasswordLength)
      return false
    }
    setConsolePasswordError('')
    if (parseStopTimeout(stopTimeout) === null) {
      setStopTimeoutError(t.vmCreate.stopTimeoutRange)
      return false
    }
    setStopTimeoutError('')
    const everyChoiceMade = clusterId !== '' && networkId !== '' && chosenTemplateId !== '' && vmOfferingId !== ''
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
      const request: CreateVmRequest = {
        name, networkId, clusterId, vmOfferingId, templateId: chosenTemplateId, sshKeyIds: pickedSshKeyIds,
      }
      if (consolePassword !== '') {
        request.consolePassword = consolePassword
      }
      // The default is the server's too (a VM that sets none gets 120), so only a changed value is sent.
      const stopTimeoutSeconds = parseStopTimeout(stopTimeout)
      if (stopTimeoutSeconds !== null && stopTimeoutSeconds !== STOP_TIMEOUT_DEFAULT) {
        request.stopTimeoutSeconds = stopTimeoutSeconds
      }
      await createVm.mutateAsync(request)
      handleClose()
      onCreated?.()
    } catch (err) {
      const res = (err as AxiosError<{ code?: string }>).response
      const code = res?.data?.code
      if (res?.status === 409) setApiError(t.vmCreate.nameTaken)
      else if (res?.status === 422 && code === 'VM_QUOTA_EXCEEDED') setApiError(t.vmCreate.vmQuotaExceeded)
      else if (res?.status === 404 && code === 'CLUSTER_NOT_FOUND') setApiError(t.vmCreate.clusterGone)
      else if (res?.status === 422 && code === 'NETWORK_CLUSTER_MISMATCH') setApiError(t.vmCreate.networkClusterMismatch)
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
    setName(''); setNetworkId(''); setClusterId('')
    setTemplateId(''); setVmOfferingId(''); setSshKeyIds([]); setConsolePassword('')
    setStopTimeout(String(STOP_TIMEOUT_DEFAULT))
    setNameError(''); setConsolePasswordError(''); setStopTimeoutError(''); setApiError('')
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
            label={t.vmCreate.cluster}
            value={clusterId}
            onChange={handleClusterChange}
            options={clusters.map(z => ({ id: z.id, label: z.name }))}
            placeholder={t.vmCreate.selectCluster}
            disabled={createVm.isPending}
          />

          <SelectField
            label={t.vmCreate.network}
            value={networkId}
            onChange={setNetworkId}
            options={clusterNetworks.map(n => ({ id: n.id, label: n.name }))}
            placeholder={t.vmCreate.selectNetwork}
            disabled={createVm.isPending}
            empty={networkEmptyText}
          />

          <SelectField
            label={t.vmCreate.template}
            value={chosenTemplateId}
            onChange={setTemplateId}
            options={clusterTemplates.map(zt => ({ id: zt.id, label: `${zt.name} — ${zt.os}` }))}
            placeholder={t.vmCreate.selectTemplate}
            disabled={createVm.isPending}
            empty={templateEmptyText}
          />

          {/* Size is chosen independently of the OS template (titan-ops features/catalog/design.md#vm-offering-sizing) — the label spells out
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

          <div className="space-y-1.5">
            <label htmlFor="console-password" className="text-[13px] font-medium text-soft-foreground">
              {t.vmCreate.consolePassword}
            </label>
            <Input
              id="console-password"
              type="password"
              autoComplete="new-password"
              value={consolePassword}
              onChange={e => { setConsolePassword(e.target.value); setConsolePasswordError('') }}
              error={consolePasswordError}
              disabled={createVm.isPending}
            />
            <p className="text-xs text-faint">{t.vmCreate.consolePasswordHint}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="stop-timeout" className="text-[13px] font-medium text-soft-foreground">
              {t.vmCreate.stopTimeout}
            </label>
            {/* Text, not type=number: the range check is ours and shows inline, not the browser's bubble. */}
            <Input
              id="stop-timeout"
              type="text"
              inputMode="numeric"
              value={stopTimeout}
              onChange={e => { setStopTimeout(e.target.value); setStopTimeoutError('') }}
              error={stopTimeoutError}
              disabled={createVm.isPending}
            />
            <p className="text-xs text-faint">{t.vmCreate.stopTimeoutHint}</p>
          </div>

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
