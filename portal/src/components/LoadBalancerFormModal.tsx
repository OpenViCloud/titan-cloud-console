import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { AxiosError } from 'axios'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNetworks } from '@/hooks/useNetworks'
import { useVms } from '@/hooks/useVms'
import {
  useCreateLoadBalancer, useUpdateLoadBalancer, type LoadBalancer,
} from '@/hooks/useLoadBalancers'
import { isUsableNetwork } from '@/lib/networkState'
import { MAX_LISTENERS, isBackendCandidate, specProblem } from '@/lib/loadBalancerState'
import { useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = edit this one: name and network stay, listeners and VMs change. */
  loadBalancer?: LoadBalancer | null
  onDone?: (kind: 'created' | 'updated') => void
}

// Ports stay text while typed: an empty field must read as an error, not as 0.
interface ListenerDraft {
  protocol: string
  port: string
  targetPort: string
}

const NEW_LISTENER: ListenerDraft = { protocol: 'TCP', port: '80', targetPort: '80' }

function errorSentence(err: unknown, t: Messages, editing: boolean): string {
  const res = (err as AxiosError<{ code?: string }>).response
  const code = res?.data?.code
  const f = t.loadBalancerForm
  if (res?.status === 409 && code === 'LOAD_BALANCER_NAME_TAKEN') return f.nameTaken
  if (res?.status === 409 && code === 'LOAD_BALANCER_VIP_CONFLICT') return f.vipConflict
  if (res?.status === 422 && code === 'LOAD_BALANCER_QUOTA_EXCEEDED') return f.quotaExceeded
  if (res?.status === 422 && code === 'LOAD_BALANCER_NEEDS_PUBLIC_IPV6') return f.needsPublicIpv6
  if (res?.status === 422 && code === 'NETWORK_INVALID_STATE') return f.networkNotReady
  if (res?.status === 422 && code === 'LOAD_BALANCER_BACKEND_INVALID') return f.backendInvalid
  // On a create the handler gives this code when the network has no free VIP number left.
  if (res?.status === 422 && code === 'LOAD_BALANCER_INVALID_STATE') return editing ? f.invalidState : f.noFreeVip
  if (res?.status === 403 && code === 'TENANT_SUSPENDED') return f.suspended
  if (res?.status === 403 && code === 'TENANT_PENDING_APPROVAL') return f.pendingApproval
  return f.genericError
}

export function LoadBalancerFormModal({ open, onOpenChange, loadBalancer, onDone }: Props) {
  const editing = loadBalancer != null
  const t = useT()
  const f = t.loadBalancerForm
  const { data: networks = [] } = useNetworks()
  const { data: vms = [] } = useVms()
  const create = useCreateLoadBalancer()
  const update = useUpdateLoadBalancer()

  const [name, setName] = useState('')
  const [networkId, setNetworkId] = useState(loadBalancer?.networkId ?? '')
  const [listeners, setListeners] = useState<ListenerDraft[]>(
    loadBalancer
      ? loadBalancer.listeners.map(l => ({ protocol: l.protocol, port: String(l.port), targetPort: String(l.targetPort) }))
      : [NEW_LISTENER],
  )
  const [vmIds, setVmIds] = useState<string[]>(loadBalancer ? loadBalancer.backends.map(b => b.vmId) : [])
  const [error, setError] = useState('')

  // docs/features/load-balancer/design.md#lb-needs-public-ipv6: only a network with its own /64 can carry a VIP.
  const ipv6Networks = networks.filter(n => n.publicIpv6Subnet !== null && isUsableNetwork(n))
  // Editing also lists the backends it already has, even one Incus no longer holds, so it can be unticked.
  const currentBackends = new Set(loadBalancer ? loadBalancer.backends.map(b => b.vmId) : [])
  const candidates = networkId === ''
    ? []
    : vms.filter(v => isBackendCandidate(v, networkId) || currentBackends.has(v.id))
  const pending = create.isPending || update.isPending
  const noNetworkToUse = !editing && ipv6Networks.length === 0

  function setListener(index: number, change: Partial<ListenerDraft>) {
    setListeners(rows => rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
    setError('')
  }

  function chooseNetwork(id: string) {
    setNetworkId(id)
    setVmIds([]) // VMs of another network can never be backends here
    setError('')
  }

  function toggleVm(id: string) {
    setVmIds(ids => (ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id]))
    setError('')
  }

  function handleClose() {
    setName(''); setNetworkId(loadBalancer?.networkId ?? ''); setError('')
    onOpenChange(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = listeners.map(l => ({ protocol: l.protocol, port: Number(l.port), targetPort: Number(l.targetPort) }))
    const problem = specProblem({ name: editing ? null : name, listeners: parsed, backendCount: vmIds.length })
    if (problem !== null) {
      setError(f[problem])
      return
    }
    // The VM list's order, not the click order: the request reads the same whatever was ticked first.
    const backends = vms.filter(v => vmIds.includes(v.id)).map(v => ({ vmId: v.id }))
    setError('')
    try {
      if (editing) {
        await update.mutateAsync({ id: loadBalancer.id, spec: { listeners: parsed, backends } })
      } else {
        await create.mutateAsync({ name, networkId, listeners: parsed, backends })
      }
      onDone?.(editing ? 'updated' : 'created')
      handleClose()
    } catch (err) {
      setError(errorSentence(err, t, editing))
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? f.editTitle : f.createTitle}</DialogTitle>
          <DialogDescription>{editing ? loadBalancer.name : f.description}</DialogDescription>
        </DialogHeader>

        {/* noValidate: otherwise the browser stops a port outside min/max before specProblem can give its sentence */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-soft-foreground">{f.name}</label>
              <Input
                placeholder={f.namePlaceholder}
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                disabled={pending}
                autoFocus
              />
            </div>
          )}

          {!editing && (
            <div className="space-y-1.5">
              <label htmlFor="lb-network" className="text-[13px] font-medium text-soft-foreground">{f.network}</label>
              {noNetworkToUse ? (
                <p className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">{f.noIpv6Network}</p>
              ) : (
                <select
                  id="lb-network"
                  className="w-full rounded-md border border-border bg-popover px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                  value={networkId}
                  onChange={e => chooseNetwork(e.target.value)}
                  disabled={pending}
                >
                  <option value="">{f.selectNetwork}</option>
                  {ipv6Networks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              )}
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-soft-foreground">{f.listeners}</legend>
            {listeners.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={f.protocol}
                  className="rounded-md border border-border bg-popover px-2 py-1.5 text-[13px] text-foreground"
                  value={row.protocol}
                  onChange={e => setListener(i, { protocol: e.target.value })}
                  disabled={pending}
                >
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                </select>
                <Input
                  type="number" aria-label={f.port} placeholder={f.port} className="h-8 w-24 text-[13px]"
                  min={1} max={65535} value={row.port} disabled={pending}
                  onChange={e => setListener(i, { port: e.target.value })}
                />
                <span className="text-faint" aria-hidden="true">→</span>
                <Input
                  type="number" aria-label={f.targetPort} placeholder={f.targetPort} className="h-8 w-28 text-[13px]"
                  min={1} max={65535} value={row.targetPort} disabled={pending}
                  onChange={e => setListener(i, { targetPort: e.target.value })}
                />
                <Button
                  type="button" variant="ghost" size="sm" className="h-8 px-2 text-faint hover:text-bad"
                  aria-label={f.removeListener} disabled={pending || listeners.length === 1}
                  onClick={() => setListeners(rows => rows.filter((_, j) => j !== i))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs"
              disabled={pending || listeners.length >= MAX_LISTENERS}
              onClick={() => setListeners(rows => [...rows, { ...NEW_LISTENER }])}
            >
              <Plus className="h-3 w-3" />
              {f.addListener}
            </Button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-soft-foreground">{f.backends}</legend>
            {networkId === '' ? (
              <p className="text-[12px] text-faint">{f.selectNetworkFirst}</p>
            ) : candidates.length === 0 ? (
              <p className="text-[12px] text-faint">{f.noVms}</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {candidates.map(v => (
                  <div key={v.id} className="flex items-center gap-2.5">
                    <input
                      id={`lb-vm-${v.id}`} type="checkbox" className="h-4 w-4 rounded accent-primary"
                      checked={vmIds.includes(v.id)} disabled={pending} onChange={() => toggleVm(v.id)}
                    />
                    <label htmlFor={`lb-vm-${v.id}`} className="cursor-pointer select-none text-[13px] text-soft-foreground">
                      {v.name}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {error && (
            <p className="rounded-md border border-bad-border bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>{t.common.cancel}</Button>
            </DialogClose>
            <Button type="submit" disabled={pending || noNetworkToUse}>
              {editing
                ? (update.isPending ? f.saving : f.save)
                : (create.isPending ? f.creating : f.submit)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
