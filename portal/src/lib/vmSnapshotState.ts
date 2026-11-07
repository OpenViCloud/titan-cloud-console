// A VM snapshot has one status, as the server sends it (titan-ops features/vm/design.md#vm-snapshot). Incus has no status
// word for an instance snapshot, so the words are Titan's:
//   Creating · Reverting · Deleting — a request waits on its command
//   Available — Incus holds it and nothing waits
//   NotFound  — the reconciler no longer sees it on its VM
//   Failed    — the create gave up before Incus made it
//   Deleted   — gone (not listed)
// requestFailureReason is the fixed text of the last request whose command gave up
// (titan-ops architecture/resource-lifecycle.md#callback-routes).
// The buttons mirror the aggregate's rules, so the server's 422 is never the first thing a customer reads.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface VmSnapshotStateFields {
  // A string, not a union: a status this portal was not taught still renders, and offers only Delete.
  status: string
  requestFailureReason: string | null
}

/** A request waits on its command: the list keeps refreshing and the badge names the move. */
function isWaiting(snapshot: VmSnapshotStateFields): boolean {
  return snapshot.status === 'Creating' || snapshot.status === 'Reverting' || snapshot.status === 'Deleting'
}

/** The badge: the status as the server sends it, with NotFound spelled the way every other resource shows it. */
export function vmSnapshotLabel(snapshot: VmSnapshotStateFields): string {
  if (snapshot.status === 'NotFound') {
    return 'Not found'
  }
  return snapshot.status
}

/** Why the last request gave up, while nothing waits. Server text, shown as sent. */
export function vmSnapshotFailureNote(snapshot: VmSnapshotStateFields): string | null {
  if (isWaiting(snapshot)) {
    return null
  }
  return snapshot.requestFailureReason
}

/** VmSnapshot.Revert: Incus holds it and nothing waits. */
export function canRevertVmSnapshot(snapshot: VmSnapshotStateFields): boolean {
  return snapshot.status === 'Available'
}

/** Delete follows Incus: not found and a failed create are deletable; a waiting request is not. */
export function canDeleteVmSnapshot(snapshot: VmSnapshotStateFields): boolean {
  return !isWaiting(snapshot) && snapshot.status !== 'Deleted'
}

/** React Query `refetchInterval`: refresh while any snapshot has a request waiting, then stop. */
export function pollWhileVmSnapshotsWait(rows: readonly VmSnapshotStateFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => isWaiting(row))
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
