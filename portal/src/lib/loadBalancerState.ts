// A load balancer's state as the server sends it (docs/features/load-balancer/design.md#lb-lifecycle): Incus has no
// status word for one, so only whether Incus holds it and which request still waits.
//   currentExistence / desiredExistence — NotCreated · Exists · NotFound · Deleted / Exists · Deleted
//   transition                          — Creating · Updating · Deleting, derived by the server
// The buttons mirror the aggregate's rules.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface LoadBalancerStateFields {
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
}

export interface ListenerFields {
  protocol: string
  port: number
  targetPort: number
}

export interface BackendCandidateFields {
  networkId: string | null
  currentExistence: string
  desiredExistence: string
}

// The limits and the name rule of the server's validators (Endpoints/LoadBalancer/LoadBalancerSpecRules.cs).
export const MAX_LISTENERS = 10
export const MAX_BACKENDS = 20
const NAME_MAX = 100
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** The badge: the waiting request's move, else why Incus has none, else Active. */
export function loadBalancerLabel(lb: LoadBalancerStateFields): string {
  if (lb.transition !== null) {
    return lb.transition
  }
  if (lb.currentExistence === 'NotFound') {
    return 'Not found'
  }
  if (lb.currentExistence === 'NotCreated') {
    return 'Failed'
  }
  if (lb.currentExistence === 'Deleted') {
    return 'Deleted'
  }
  return 'Active'
}

/** LoadBalancer.RequestUpdate: on Incus, nothing waiting. */
export function canEditLoadBalancer(lb: LoadBalancerStateFields): boolean {
  return lb.transition === null
    && lb.currentExistence === 'Exists'
    && lb.desiredExistence === 'Exists'
}

/** LoadBalancer.RequestDelete: a delete replaces a waiting update; a waiting create or delete refuses it. */
export function canDeleteLoadBalancer(lb: LoadBalancerStateFields): boolean {
  const createOrDeleteWaits = lb.transition === 'Creating' || lb.transition === 'Deleting'
  const isGone = lb.currentExistence === 'Deleted'
  return !createOrDeleteWaits && !isGone
}

/** React Query `refetchInterval`: refresh while any row has a request waiting, then stop. */
export function pollWhileLoadBalancersWait(rows: readonly LoadBalancerStateFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => row.transition !== null)
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}

export function listenerLabel(listener: ListenerFields): string {
  return `${listener.protocol} ${listener.port} → ${listener.targetPort}`
}

/** Vm.BeginLoadBalancerBackend: on the load balancer's network, on Incus, not being deleted. */
export function isBackendCandidate(vm: BackendCandidateFields, networkId: string): boolean {
  return vm.networkId === networkId
    && vm.currentExistence === 'Exists'
    && vm.desiredExistence === 'Exists'
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
