import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, ChevronDown, ChevronRight, Network as NetworkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { NetworkCreateModal } from '@/components/NetworkCreateModal'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { useNetworks, useDeleteNetwork, useRenameNetwork, type Network } from '@/hooks/useNetworks'
import { useVms } from '@/hooks/useVms'
import { useLoadBalancers } from '@/hooks/useLoadBalancers'
import { useZoneMap } from '@/hooks/useZones'
import {
  useFirewallRules,
  useCreateFirewallRule,
  useDeleteFirewallRule,
  type FirewallRule,
} from '@/hooks/useFirewallRules'
import type { BadgeProps } from '@/components/ui/badge'
import { incusLabel, canDeleteIncusResource, canRenameNetwork, refusedRequestReason } from '@/lib/networkState'
import { holdsItsNetwork } from '@/lib/vmState'
import { useT, useFormat } from '@/i18n/LanguageContext'

// Keys are what incusLabel() returns: an Incus word, a waiting request's move, or why Incus has none.
const statusVariant: Record<string, BadgeProps['variant']> = {
  Created:       'success',
  Pending:       'blue',
  Creating:      'blue',
  Deleting:      'warning',
  Unknown:       'warning',
  Errored:       'destructive',
  Unavailable:   'destructive',
  'Not found':   'destructive',
  Failed:        'destructive',
}

// A rule Incus holds disabled was turned off outside Titan; logged still filters, and logs too.
const ruleStatusVariant: Record<string, BadgeProps['variant']> = {
  enabled:     'success',
  logged:      'success',
  disabled:    'warning',
  Creating:    'blue',
  Deleting:    'warning',
  Unknown:     'warning',
  'Not found': 'destructive',
  Failed:      'destructive',
}

// ── Firewall panel ────────────────────────────────────────────────────────────

function FirewallRuleCreateForm({ networkId, onDone }: { networkId: string; onDone: () => void }) {
  const [direction, setDirection] = useState('Ingress')
  const [protocol, setProtocol] = useState('TCP')
  const [cidr, setCidr] = useState('')
  const [startPort, setStartPort] = useState('')
  const [endPort, setEndPort] = useState('')
  const [error, setError] = useState('')
  const create = useCreateFirewallRule(networkId)
  const t = useT()

  const needsPorts = protocol === 'TCP' || protocol === 'UDP'

  async function handleCreate() {
    if (!cidr.trim()) { setError(t.firewall.cidrRequired); return }
    if (needsPorts && startPort === '') {
      setError(t.firewall.startPortRequired)
      return
    }
    setError('')
    let ports: { startPort: number | null; endPort: number | null } = { startPort: null, endPort: null }
    if (needsPorts) {
      // One port typed and End Port left empty is that one port.
      const first = parseInt(startPort)
      let last = first
      if (endPort !== '') {
        last = parseInt(endPort)
      }
      ports = { startPort: first, endPort: last }
    }
    try {
      await create.mutateAsync({ direction, protocol, cidr: cidr.trim(), ...ports })
      toast.success(t.firewall.created)
      setCidr(''); setStartPort(''); setEndPort('')
      onDone()
    } catch (err) {
      setError(createRuleError(err))
    }
  }

  function createRuleError(err: unknown): string {
    const res = (err as import('axios').AxiosError<{ code?: string }>).response
    const code = res?.data?.code
    if (code === 'FIREWALL_QUOTA_EXCEEDED') {
      return t.firewall.quotaExceeded
    }
    if (code === 'FIREWALL_NETWORK_NOT_READY') {
      return t.firewall.networkNotReady
    }
    if (code === 'TENANT_SUSPENDED') {
      return t.firewall.tenantSuspended
    }
    if (code === 'TENANT_PENDING_APPROVAL') {
      return t.firewall.tenantPendingApproval
    }
    return t.firewall.createFailed
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-[10px] text-faint mb-1 block">{t.firewall.direction}</label>
          <select
            className="bg-muted border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
            value={direction}
            onChange={e => setDirection(e.target.value)}
            aria-label={t.firewall.direction}
          >
            <option value="Ingress">{t.firewall.ingress}</option>
            <option value="Egress">{t.firewall.egress}</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-faint mb-1 block">{t.firewall.protocol}</label>
          <select
            className="bg-muted border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
            value={protocol}
            onChange={e => setProtocol(e.target.value)}
            aria-label={t.firewall.protocol}
          >
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
            <option value="ICMP">ICMP</option>
            <option value="All">{t.firewall.allProtocols}</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-faint mb-1 block">{t.firewall.cidr}</label>
          <Input
            placeholder={t.firewall.cidrPlaceholder}
            value={cidr}
            onChange={e => setCidr(e.target.value)}
            className="h-7 text-xs w-36"
          />
        </div>
        {needsPorts && (
          <>
            <div>
              <label htmlFor={`rule-start-port-${networkId}`} className="text-[10px] text-faint mb-1 block">{t.firewall.startPort}</label>
              <Input
                id={`rule-start-port-${networkId}`}
                type="number"
                placeholder={t.firewall.portPlaceholder}
                value={startPort}
                onChange={e => setStartPort(e.target.value)}
                className="h-7 text-xs w-24"
                min={1}
                max={65535}
              />
            </div>
            <div>
              <label htmlFor={`rule-end-port-${networkId}`} className="text-[10px] text-faint mb-1 block">{t.firewall.endPort}</label>
              <Input
                id={`rule-end-port-${networkId}`}
                type="number"
                placeholder={t.firewall.portPlaceholder}
                value={endPort}
                onChange={e => setEndPort(e.target.value)}
                className="h-7 text-xs w-24"
                min={1}
                max={65535}
              />
            </div>
          </>
        )}
        <Button size="sm" className="h-7 text-xs px-3" onClick={handleCreate} disabled={create.isPending || !cidr.trim()}>
          {t.firewall.submit}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs px-3 text-faint" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
}

function FirewallRuleRow({ rule, networkId }: { rule: FirewallRule; networkId: string }) {
  const deleteRule = useDeleteFirewallRule(networkId)
  const t = useT()

  async function handleDelete() {
    try {
      await deleteRule.mutateAsync(rule.id)
      // The rule stays listed as Deleting until the provider confirms (docs/architecture/desired-and-current.md#forget-on-provider-confirm).
      toast.success(t.firewall.deleteRequested)
    } catch {
      toast.error(t.firewall.deleteFailed)
    }
  }

  const portLabel = rule.startPort != null
    ? rule.startPort === rule.endPort || rule.endPort == null
      ? String(rule.startPort)
      : `${rule.startPort}–${rule.endPort}`
    : '—'

  return (
    <div data-testid="firewall-rule-row" className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-card">
      <span className="text-[10px] text-faint w-12">{rule.direction}</span>
      <span className="text-xs text-soft-foreground w-10">{rule.protocol}</span>
      <span className="font-mono text-xs text-muted-foreground flex-1">{rule.cidr}</span>
      <span className="text-xs text-faint w-16 text-center">{portLabel}</span>
      <Badge variant={ruleStatusVariant[incusLabel(rule)] ?? 'default'} className="text-[10px]">{incusLabel(rule)}</Badge>
      {refusedRequestReason(rule) !== null && (
        <span className="text-[10px] text-bad">{refusedRequestReason(rule)}</span>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 text-[10px] px-2 text-faint hover:text-bad"
        onClick={handleDelete}
        disabled={deleteRule.isPending || !canDeleteIncusResource(rule)}
        aria-label={t.firewall.deleteRule}
      >
        {t.common.delete}
      </Button>
    </div>
  )
}

function FirewallPanel({ network }: { network: Network }) {
  const [showForm, setShowForm] = useState(false)
  const { data: rules = [], isLoading } = useFirewallRules(network.id)
  const t = useT()

  const ingress = rules.filter(r => r.direction === 'Ingress')
  const egress = rules.filter(r => r.direction === 'Egress')

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-faint font-medium uppercase tracking-wide">{t.firewall.title}</span>
        {!showForm && (
          <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => setShowForm(true)}>
            <Plus className="w-3 h-3" />
            {t.firewall.addRule}
          </Button>
        )}
      </div>

      {isLoading && <p className="text-xs text-faint py-2">{t.common.loading}</p>}

      {!isLoading && (
        <>
          {ingress.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] text-faint uppercase tracking-wider mb-1">{t.firewall.ingress}</p>
              {ingress.map(r => <FirewallRuleRow key={r.id} rule={r} networkId={network.id} />)}
            </div>
          )}
          {egress.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] text-faint uppercase tracking-wider mb-1">{t.firewall.egress}</p>
              {egress.map(r => <FirewallRuleRow key={r.id} rule={r} networkId={network.id} />)}
            </div>
          )}
          {rules.length === 0 && !showForm && (
            <p className="text-xs text-faint py-2">{t.firewall.empty}</p>
          )}
        </>
      )}

      {showForm && <FirewallRuleCreateForm networkId={network.id} onDone={() => setShowForm(false)} />}
    </div>
  )
}

// ── RenameNetworkDialog ───────────────────────────────────────────────────────

// B-N02 — rename is a single field, so it gets a dialog rather than a page: the user never loses
// sight of the list they are relabelling. Save stays disabled until the name actually differs, which
// mirrors the no-op guard in RenameNetworkCommandHandler — no wasted round-trip.
function RenameNetworkDialog({ network, onOpenChange }: {
  network: Network | null
  onOpenChange: (open: boolean) => void
}) {
  // Initialised from the network, not reset by an effect: the call site gives this component a
  // `key` of the network id, so opening a different row REMOUNTS it and the initial value is right
  // by construction. Resetting in an effect rendered once with the stale name first, and it is the
  // shape react-hooks/set-state-in-effect flags (US-PORTAL-01).
  const [name, setName] = useState(network?.name ?? '')
  const rename = useRenameNetwork()
  const t = useT()

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && trimmed !== network?.name

  async function handleSave() {
    if (!network || !canSave) return
    try {
      await rename.mutateAsync({ networkId: network.id, name: trimmed })
      onOpenChange(false)
      toast.success(t.networks.renamed)
    } catch (err) {
      const res = (err as import('axios').AxiosError<{ code?: string }>).response
      if (res?.data?.code === 'NETWORK_NAME_TAKEN') {
        toast.error(t.networks.nameTaken(trimmed))
      } else {
        toast.error(t.networks.renameFailed)
      }
    }
  }

  return (
    <Dialog open={!!network} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.networks.renameTitle}</DialogTitle>
          <DialogDescription>
            {t.networks.renameDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={e => { e.preventDefault(); handleSave() }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor="network-name" className="text-xs text-muted-foreground">{t.networks.name}</label>
          <Input
            id="network-name"
            value={name}
            maxLength={100}
            autoFocus
            onFocus={e => e.currentTarget.select()}
            onChange={e => setName(e.target.value)}
          />
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={rename.isPending}>{t.common.cancel}</Button>
            </DialogClose>
            <Button type="submit" disabled={!canSave || rename.isPending}>
              {rename.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── NetworkListPage ───────────────────────────────────────────────────────────

export function NetworkListPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Network | null>(null)
  const [renameTarget, setRenameTarget] = useState<Network | null>(null)

  const { data: networks = [], isLoading, isError } = useNetworks()
  // The top-bar search lands here with ?q=<text>: show only the networks whose name matches.
  const [searchParams, setSearchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim()
  const shown = networks.filter(n => n.name.toLowerCase().includes(query.toLowerCase()))
  const { data: vms = [] } = useVms()
  const deleteNetwork = useDeleteNetwork()
  const zoneMap = useZoneMap()
  const t = useT()
  const f = useFormat()

  const attachedNetworkIds = new Set(
    vms
      .filter(v => v.networkId && holdsItsNetwork(v))
      .map(v => v.networkId!)
  )
  // Same rule as the server (NetworkRepository.HasLiveLoadBalancersAsync): a load balancer not yet Deleted keeps its
  // network, whatever else it is doing.
  const { data: loadBalancers = [] } = useLoadBalancers()
  const networksWithALoadBalancer = new Set(
    loadBalancers.filter(lb => lb.currentExistence !== 'Deleted').map(lb => lb.networkId)
  )

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteNetwork.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      toast.success(t.networks.deleted)
    } catch (err) {
      const res = (err as import('axios').AxiosError<{ code?: string }>).response
      if (res?.status === 422 && res.data?.code === 'NETWORK_NOT_EMPTY') {
        toast.error(t.networks.notEmpty)
      } else {
        toast.error(t.networks.deleteFailed)
      }
    }
  }

  function deleteBlockedTitle(networkId: string): string | undefined {
    if (attachedNetworkIds.has(networkId)) {
      return t.networks.removeVmsFirst
    }
    if (networksWithALoadBalancer.has(networkId)) {
      return t.networks.removeLoadBalancersFirst
    }
    return undefined
  }

  function toggleExpanded(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t.networks.title}</h1>
          <p className="text-[13px] text-faint mt-1">
            {isLoading ? t.common.loading : networks.length === 0 ? t.networks.noneYet : t.networks.count(networks.length)}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-[13px]" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          {t.networks.create}
        </Button>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.networks.loadFailed}
        </p>
      )}

      {query !== '' && (
        <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          {t.networks.matching}<span className="font-semibold text-foreground">“{query}”</span>
          <button type="button" className="font-semibold text-primary-ink hover:underline" onClick={() => setSearchParams({})}>
            {t.networks.clear}
          </button>
        </p>
      )}

      {!isError && <div className="rounded-xl border border-border bg-card overflow-hidden">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
              <NetworkIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />
            </div>
            <p className="text-[13px] text-muted-foreground font-medium">{t.networks.empty}</p>
            <p className="text-xs text-faint">{t.networks.emptyHint}</p>
          </div>
        ) : (
          <ul aria-label={t.networks.listLabel} className="divide-y divide-border">
            {shown.map(net => (
              <li key={net.id}>
                <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                    <NetworkIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{net.name}</span>
                      <Badge variant={statusVariant[incusLabel(net)] ?? 'default'}>{incusLabel(net)}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-faint">
                      {zoneMap.get(net.zoneId) ?? net.zoneId} · {t.networks.createdOn(f.date(net.createdAt))}
                    </p>
                    {refusedRequestReason(net) !== null && (
                      <p className="mt-0.5 text-[12px] text-bad">{refusedRequestReason(net)}</p>
                    )}
                  </div>
                  <div className="col-start-2 min-w-0 md:col-start-auto">
                    <p className="text-[11.5px] text-faint">{t.networks.cidr}</p>
                    <p className="truncate font-mono text-[12.5px] text-soft-foreground">{net.cidr ?? '—'}</p>
                    {typeof net.publicIpv6Subnet === 'string' && (
                      <p className="truncate font-mono text-[12.5px] text-soft-foreground" title={t.networks.publicIpv6}>
                        {net.publicIpv6Subnet}
                      </p>
                    )}
                  </div>
                  <div className="col-start-2 min-w-0 md:col-start-auto">
                    <p className="text-[11.5px] text-faint">{t.networks.gateway}</p>
                    <p className="truncate font-mono text-[12.5px] text-soft-foreground">{net.gateway ?? '—'}</p>
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-1.5 md:col-start-auto md:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      aria-expanded={expandedId === net.id}
                      onClick={() => toggleExpanded(net.id)}
                    >
                      {expandedId === net.id
                        ? <ChevronDown className="w-3.5 h-3.5" />
                        : <ChevronRight className="w-3.5 h-3.5" />}
                      {t.networks.firewall}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-faint hover:text-soft-foreground text-xs"
                      disabled={!canRenameNetwork(net)}
                      onClick={() => setRenameTarget(net)}
                    >
                      {t.networks.rename}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-faint hover:text-bad text-xs"
                      disabled={!canDeleteIncusResource(net) || attachedNetworkIds.has(net.id) || networksWithALoadBalancer.has(net.id)}
                      title={deleteBlockedTitle(net.id)}
                      onClick={() => setDeleteTarget(net)}
                    >
                      {t.common.delete}
                    </Button>
                  </div>
                </div>
                {expandedId === net.id && <FirewallPanel network={net} />}
              </li>
            ))}
          </ul>
        )}
      </div>}

      <NetworkCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => toast.success(t.networks.created)}

      />

      <RenameNetworkDialog
        key={renameTarget?.id ?? 'none'}
        network={renameTarget}
        onOpenChange={open => { if (!open) setRenameTarget(null) }}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        name={deleteTarget?.name ?? ''}
        onConfirm={handleConfirmDelete}
        loading={deleteNetwork.isPending}
      />
    </div>
  )
}
