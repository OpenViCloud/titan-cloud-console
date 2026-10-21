// A network's and a firewall rule's state as the server sends it
// (docs/architecture/desired-and-current.md#provider-state-is-verbatim):
//   currentState      — the Incus word for word, null while Incus holds nothing: a network status (Pending ·
//                       Created · Errored · Unknown · Unavailable) or an ACL rule state (enabled · disabled · logged)
//   currentExistence  — NotCreated · Exists · NotFound · Deleted (docs/architecture/desired-and-current.md#existence-axis)
//   requestFailureReason — the fixed text of a command the provider gave up on (…#request-failure)
// The delete follows Incus (docs/features/network/design.md#network-lifecycle): whatever the word, even not found,
// Incus answers; only a request already waiting holds the button back.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface IncusStateFields {
  currentState: string | null
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
}

/** The badge: the waiting request's move, else the Incus word, else why Incus has none. */
export function incusLabel(resource: IncusStateFields): string {
  if (resource.transition !== null) {
    return resource.transition
  }
  if (resource.currentState !== null) {
    return resource.currentState
  }
  if (resource.currentExistence === 'NotFound') {
    return 'Not found'
  }
  if (resource.requestFailureReason !== null) {
    return 'Failed'
  }
  return 'Unknown'
}

/**
 * Why the provider refused the last request, while nothing else waits. After a refused delete the badge is the Incus
 * word again (AbandonRequest keeps current), so this is the only thing that says the delete did not happen. A request
 * waiting again makes it stale.
 */
export function refusedRequestReason(resource: IncusStateFields): string | null {
  if (resource.transition !== null) {
    return null
  }
  return resource.requestFailureReason
}

/** Nothing waits and it is not gone: a create still waiting is refused by the server, a delete waiting adds nothing. */
export function canDeleteIncusResource(resource: IncusStateFields): boolean {
  const nothingWaits = resource.transition === null
  const isGone = resource.currentExistence === 'Deleted'
  return nothingWaits && !isGone
}

/** Mirrors Network.Rename: everything but a network on its way out, or already gone. */
export function canRenameNetwork(network: IncusStateFields): boolean {
  const deleteAsked = network.desiredExistence === 'Deleted'
  const isGone = network.currentExistence === 'Deleted'
  return !deleteAsked && !isGone
}

/** Same rule as the server's Network.IsUsable: Incus reports it Created and nothing waits on it. */
export function isUsableNetwork(network: IncusStateFields): boolean {
  return network.currentState === 'Created'
    && network.currentExistence === 'Exists'
    && network.desiredExistence === 'Exists'
    && network.transition === null
}

/**
 * React Query `refetchInterval`: refresh while any row has a request waiting, or a network Incus still reports
 * Pending (defined but not yet created on the cluster), then stop.
 */
export function pollWhileIncusWaits(rows: readonly IncusStateFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => row.transition !== null || row.currentState === 'Pending')
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
