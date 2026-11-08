// A volume has one status, as the server sends it (titan-ops features/volume/design.md#volume-state-is-existence). Incus
// has no status word for a custom volume, so the words are Titan's:
//   Creating · Attaching · Detaching · Deleting — a request waits on its command
//   Available — Incus holds it and nothing waits
//   NotFound  — the reconciler no longer sees it
//   Failed    — the create gave up before Incus made it
//   Deleted   — gone (not listed)
// The attachment is separate (the status says nothing about who uses the volume):
//   currentAttachedVmId      — the Titan VM Incus reports using the volume (what Incus reported or a report of its command saw)
//   currentAttachedElsewhere — an instance that is no Titan VM uses it (attached outside Titan)
//   desiredAttachedVmId      — the VM the customer asked for (set by an attach or detach request, put back by its report)
// requestFailureReason is the fixed text of the last request whose command gave up
// (titan-ops architecture/resource-lifecycle.md#invariants).
// The buttons mirror the aggregate's rules, so the server's 422 is never the first thing a customer reads.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface VolumeStateFields {
  // A string, not a union: a status this portal was not taught still renders, and offers only Delete (unless an instance uses it).
  status: string
  currentAttachedVmId: string | null
  currentAttachedElsewhere: boolean
  desiredAttachedVmId: string | null
  requestFailureReason: string | null
}

/** A request waits on its command: the list keeps refreshing and the badge names the move. */
export function isVolumeWaiting(volume: { status: string }): boolean {
  return volume.status === 'Creating'
    || volume.status === 'Attaching'
    || volume.status === 'Detaching'
    || volume.status === 'Deleting'
}

function isInUse(volume: VolumeStateFields): boolean {
  return volume.currentAttachedVmId !== null || volume.currentAttachedElsewhere
}

/** The badge: the move a waiting request makes, else why Incus has none, else who uses it — Available when no one. */
export function volumeLabel(volume: VolumeStateFields): string {
  if (volume.status === 'NotFound') {
    return 'Not found'
  }
  if (volume.status !== 'Available') {
    return volume.status
  }
  if (volume.currentAttachedElsewhere) {
    return 'Attached outside OpenViCloud'
  }
  if (volume.currentAttachedVmId !== null) {
    return 'Attached'
  }
  return 'Available'
}

/** Why the last request gave up, while nothing waits. Server text, shown as sent. */
export function volumeFailureNote(volume: VolumeStateFields): string | null {
  return isVolumeWaiting(volume) ? null : volume.requestFailureReason
}

/** Volume.Attach: on Incus, no instance uses it, nothing waits. */
export function canAttachStoredVolume(volume: VolumeStateFields): boolean {
  return volume.status === 'Available' && !isInUse(volume)
}

/** Volume.Detach: a Titan VM alone uses it — Titan does not edit an instance it does not manage. */
export function canDetachStoredVolume(volume: VolumeStateFields): boolean {
  return volume.status === 'Available' && volume.currentAttachedVmId !== null && !volume.currentAttachedElsewhere
}

/** Volume.EnsureSnapshottable: on Incus, nothing waits, attached or not. */
export function canSnapshotStoredVolume(volume: VolumeStateFields): boolean {
  return volume.status === 'Available'
}

/**
 * Delete follows Incus: not found and a failed create are deletable; a waiting request or an instance using it are not.
 * A volume that still holds a snapshot is refused by the server (VOLUME_HAS_SNAPSHOTS), which the page reports.
 */
export function canDeleteStoredVolume(volume: VolumeStateFields): boolean {
  return !isVolumeWaiting(volume) && volume.status !== 'Deleted' && !isInUse(volume)
}

/** Nothing waits, yet the attachment Incus shows is not the one asked for: attached or detached outside Titan. */
export function volumeAttachmentDrifts(volume: VolumeStateFields): boolean {
  return !isVolumeWaiting(volume) && volume.currentAttachedVmId !== volume.desiredAttachedVmId
}

/** React Query `refetchInterval`: refresh while any volume has a request waiting, then stop. */
export function pollWhileVolumesWait(rows: readonly { status: string }[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => isVolumeWaiting(row))
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
