// A load balancer's state as the server sends it (titan-ops features/load-balancer/design.md#lb-lifecycle): Incus has no
// status word for one, so the one `status` is Titan's — Creating, Updating and Deleting while a request waits for the
// worker, Available when Incus holds it, NotFound when the reconciler saw it gone, Failed when a create gave up before
// Incus had it, Deleted once it is gone. The buttons mirror the aggregate's rules.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface LoadBalancerStateFields {
  status: string
  requestFailureReason: string | null
}

// The statuses a request is waiting in.
const WAITING = new Set(['Creating', 'Updating', 'Deleting'])

const LABEL: Record<string, string> = {
  Creating: 'Creating',
  Available: 'Active',
  Updating: 'Updating',
  Deleting: 'Deleting',
  NotFound: 'Not found',
  Failed: 'Failed',
  Deleted: 'Deleted',
}

export interface ListenerFields {
  protocol: string
  port: number
  targetPort: number
}

export interface BackendCandidateFields {
  networkId: string | null
  status: string
}

// Any status whose instance is on Incus and whose delete was not pressed: a stopped VM is still a backend
// (titan-ops features/load-balancer/design.md#backend-address), the health check takes it out of rotation
// (titan-ops features/load-balancer/design.md#health-check).
const BACKEND_STATUSES = new Set(['Running', 'Ready', 'Stopped', 'Frozen', 'Error', 'Starting', 'Stopping', 'Snapshotting'])

// The limits and the name rule of the server's validators (Endpoints/LoadBalancer/LoadBalancerSpecRules.cs).
export const MAX_LISTENERS = 10
export const MAX_BACKENDS = 20
const NAME_MAX = 100
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** The badge: the status word, spelled for the customer. A status this page does not know shows as the server spelled it. */
export function loadBalancerLabel(lb: LoadBalancerStateFields): string {
  return LABEL[lb.status] ?? lb.status
}

/**
 * Why the last request gave up, while nothing waits: a desired state put back to what Incus holds must say why
 * (titan-ops architecture/resource-lifecycle.md#invariants). Server text, shown as sent.
 */
export function loadBalancerRequestFailureNote(lb: LoadBalancerStateFields): string | null {
  return WAITING.has(lb.status) ? null : lb.requestFailureReason
}

/** LoadBalancer.RequestUpdate: on Incus, nothing waiting. */
export function canEditLoadBalancer(lb: LoadBalancerStateFields): boolean {
  return lb.status === 'Available'
}

/** LoadBalancer.Delete: a delete replaces a waiting update; a waiting create refuses it and a waiting delete needs no second one. */
export function canDeleteLoadBalancer(lb: LoadBalancerStateFields): boolean {
  const createOrDeleteWaits = lb.status === 'Creating' || lb.status === 'Deleting'
  const isGone = lb.status === 'Deleted'
  return !createOrDeleteWaits && !isGone
}

/** React Query `refetchInterval`: refresh while any row has a request waiting, then stop. */
export function pollWhileLoadBalancersWait(rows: readonly LoadBalancerStateFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => WAITING.has(row.status))
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}

export function listenerLabel(listener: ListenerFields): string {
  return `${listener.protocol} ${listener.port} → ${listener.targetPort}`
}

/** Vm.EnsureLoadBalancerCanSendTo: on the load balancer's network, on Incus, not being deleted. */
export function isBackendCandidate(vm: BackendCandidateFields, networkId: string): boolean {
  return vm.networkId === networkId && BACKEND_STATUSES.has(vm.status)
}

export type SpecProblem =
  | 'nameRequired' | 'nameInvalid' | 'listenerCount' | 'portRange' | 'listenerRepeated' | 'backendCount'

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/** The first rule a configuration breaks, or null. `name` is null when editing: the name does not change. */
export function specProblem(spec: { name: string | null; listeners: ListenerFields[]; backendCount: number }): SpecProblem | null {
  if (spec.name !== null) {
    if (spec.name.trim() === '') {
      return 'nameRequired'
    }
    if (spec.name.length > NAME_MAX || !NAME_PATTERN.test(spec.name)) {
      return 'nameInvalid'
    }
  }
  if (spec.listeners.length < 1 || spec.listeners.length > MAX_LISTENERS) {
    return 'listenerCount'
  }
  if (spec.listeners.some(l => !isPort(l.port) || !isPort(l.targetPort))) {
    return 'portRange'
  }
  const pairs = new Set(spec.listeners.map(l => `${l.protocol}/${l.port}`))
  if (pairs.size !== spec.listeners.length) {
    return 'listenerRepeated'
  }
  if (spec.backendCount < 1 || spec.backendCount > MAX_BACKENDS) {
    return 'backendCount'
  }
  return null
}
