// A network and a firewall rule have one status, as the server sends it
// (titan-ops features/network/design.md#network-lifecycle):
//   Creating · Deleting — a request waits on its command
//   Pending · Created · Errored · Unavailable · Unknown — the Incus word of a network, at rest
//   enabled · disabled · logged · Unknown — the Incus word of an ACL rule, at rest (a rule's Unknown is Titan's: its
//                         create ended but its report could not read the rule; the next observation replaces it)
//   NotFound — the reconciler sees nothing on Incus
//   Failed   — the create gave up before Incus made it
//   Deleted  — gone
// requestFailureReason is the fixed text of the last request whose command gave up
// (titan-ops architecture/resource-lifecycle.md#callback-routes).
// The delete follows Incus: whatever the word, even not found, Incus answers; only a request already waiting holds the
// button back.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface IncusStateFields {
  // A string, not a union: a status this portal was not taught still renders, and offers only Delete.
  status: string
  requestFailureReason: string | null
}

/** A request waits on its command: the list keeps refreshing and the badge names the move. */
function isWaiting(resource: IncusStateFields): boolean {
  return resource.status === 'Creating' || resource.status === 'Deleting'
}

/** The badge: the status as the server sends it, with NotFound spelled the way every other resource shows it. */
export function incusLabel(resource: IncusStateFields): string {
  if (resource.status === 'NotFound') {
    return 'Not found'
  }
  return resource.status
}

/**
 * Why the provider refused the last request, while nothing else waits. After a refused delete the badge is the Incus
 * word again, so this is the only thing that says the delete did not happen. A request waiting again makes it stale.
 */
export function refusedRequestReason(resource: IncusStateFields): string | null {
  if (isWaiting(resource)) {
    return null
  }
  return resource.requestFailureReason
}

/** Nothing waits and it is not gone: a create still waiting is refused by the server, a delete waiting adds nothing. */
export function canDeleteIncusResource(resource: IncusStateFields): boolean {
  return !isWaiting(resource) && resource.status !== 'Deleted'
}

/** Mirrors Network.Rename: everything but a network on its way out, or already gone. */
export function canRenameNetwork(network: IncusStateFields): boolean {
  return network.status !== 'Deleting' && network.status !== 'Deleted'
}

/** Same rule as the server's Network.IsUsable: Incus reports it Created and nothing waits on it. */
export function isUsableNetwork(network: IncusStateFields): boolean {
  return network.status === 'Created'
}

/**
 * React Query `refetchInterval`: refresh while any row has a request waiting, or a network Incus still reports
 * Pending (defined but not yet created on the cluster), then stop.
 */
export function pollWhileIncusWaits(rows: readonly IncusStateFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => isWaiting(row) || row.status === 'Pending')
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
