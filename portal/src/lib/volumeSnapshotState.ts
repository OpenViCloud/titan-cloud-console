// A volume snapshot has one status, as the server sends it (titan-ops features/volume/design.md#volume-state-is-existence).
// Incus has no status word for a volume snapshot, so the words are Titan's:
//   Creating · Deleting — a request waits on its command
//   Available — Incus holds it and nothing waits
//   NotFound  — the reconciler no longer sees it
//   Failed    — the create gave up before Incus made it
//   Deleted   — gone (not listed)
// requestFailureReason is the fixed text of the last request whose command gave up
// (titan-ops architecture/resource-lifecycle.md#invariants).

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface VolumeSnapshotStateFields {
  // A string, not a union: a status this portal was not taught still renders, and offers only Delete.
  status: string
  requestFailureReason: string | null
}

/** A request waits on its command: the list keeps refreshing and the badge names the move. */
function isWaiting(snapshot: VolumeSnapshotStateFields): boolean {
  return snapshot.status === 'Creating' || snapshot.status === 'Deleting'
}

/** The badge: the status as the server sends it, with NotFound spelled the way every other resource shows it. */
export function volumeSnapshotLabel(snapshot: VolumeSnapshotStateFields): string {
  if (snapshot.status === 'NotFound') {
    return 'Not found'
  }
  return snapshot.status
}

/** Why the last request gave up, while nothing waits. Server text, shown as sent. */
export function volumeSnapshotFailureNote(snapshot: VolumeSnapshotStateFields): string | null {
  return isWaiting(snapshot) ? null : snapshot.requestFailureReason
}

/** VolumeSnapshot.EnsureRestorable: Incus holds it and nothing waits. */
export function canUseStoredSnapshot(snapshot: VolumeSnapshotStateFields): boolean {
  return snapshot.status === 'Available'
}

/** Delete follows Incus: not found and a failed create are deletable; a waiting request is not. */
export function canDeleteStoredSnapshot(snapshot: VolumeSnapshotStateFields): boolean {
  return !isWaiting(snapshot) && snapshot.status !== 'Deleted'
}

/** React Query `refetchInterval`: refresh while any snapshot has a request waiting, then stop. */
export function pollWhileVolumeSnapshotsWait(rows: readonly VolumeSnapshotStateFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => isWaiting(row))
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
