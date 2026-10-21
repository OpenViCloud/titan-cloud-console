// A volume's and a snapshot's state as the server sends it (docs/features/volume/design.md#volume-state-is-existence):
// Incus has no status word for a custom volume, a volume snapshot or an instance snapshot, so there is no
// currentState — only whether Incus holds it and, for a volume, which instance uses it.
//   currentExistence / desiredExistence — NotCreated · Exists · NotFound · Deleted / Exists · Deleted
//   currentAttachedVmId      — the Titan VM Incus reports using the volume (only observations write it)
//   currentAttachedElsewhere — an instance that is no Titan VM uses it (attached outside Titan)
//   desiredAttachedVmId      — the VM the customer asked for (only requests write it)
//   transition               — the request still waiting, derived by the server
// The buttons mirror the aggregates' rules, so the server's 422 is never the first thing a customer reads.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface StoredSnapshotFields {
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
}

export interface StoredVolumeFields extends StoredSnapshotFields {
  currentAttachedVmId: string | null
  currentAttachedElsewhere: boolean
  desiredAttachedVmId: string | null
}

/** Why there is nothing to show, or null when Incus holds it with nothing waiting. */
function waitingOrMissingLabel(resource: StoredSnapshotFields): string | null {
  if (resource.transition !== null) {
    return resource.transition
  }
  if (resource.currentExistence === 'NotFound') {
    return 'Not found'
  }
  if (resource.currentExistence === 'NotCreated') {
    return 'Failed'
  }
  if (resource.currentExistence === 'Deleted') {
    return 'Deleted'
  }
  return null
}

/** The badge (P3-2): the waiting request's move, else why Incus has none, else who uses it — Available when no one. */
export function volumeLabel(volume: StoredVolumeFields): string {
  const label = waitingOrMissingLabel(volume)
  if (label !== null) {
    return label
  }
  if (volume.currentAttachedElsewhere) {
    return 'Attached outside OpenViCloud'
  }
  if (volume.currentAttachedVmId !== null) {
    return 'Attached'
  }
  return 'Available'
}

export function snapshotLabel(snapshot: StoredSnapshotFields): string {
  const label = waitingOrMissingLabel(snapshot)
  if (label !== null) {
    return label
  }
  return 'Available'
}

function restsOnIncus(resource: StoredSnapshotFields): boolean {
  return resource.transition === null
    && resource.currentExistence === 'Exists'
    && resource.desiredExistence === 'Exists'
}

function isInUse(volume: StoredVolumeFields): boolean {
  return volume.currentAttachedVmId !== null || volume.currentAttachedElsewhere
}

/** Volume.Attach: on Incus, no instance uses it, nothing waits. */
export function canAttachStoredVolume(volume: StoredVolumeFields): boolean {
  return restsOnIncus(volume) && !isInUse(volume)
}

/** Volume.Detach: a Titan VM alone uses it — Titan does not edit an instance it does not manage. */
export function canDetachStoredVolume(volume: StoredVolumeFields): boolean {
  return restsOnIncus(volume) && volume.currentAttachedVmId !== null && !volume.currentAttachedElsewhere
}

/** Volume.EnsureSnapshottable: on Incus, nothing waits. */
export function canSnapshotStoredVolume(volume: StoredVolumeFields): boolean {
  return restsOnIncus(volume)
}

/** Delete follows Incus: not found and a failed create are deletable; a waiting request or an instance using it are not. */
export function canDeleteStoredVolume(volume: StoredVolumeFields): boolean {
  return canDeleteStoredSnapshot(volume) && !isInUse(volume)
}

/** Restore (volume snapshot) and revert (VM snapshot): on Incus, nothing waits. */
export function canUseStoredSnapshot(snapshot: StoredSnapshotFields): boolean {
  return restsOnIncus(snapshot)
}

export function canDeleteStoredSnapshot(snapshot: StoredSnapshotFields): boolean {
  const nothingWaits = snapshot.transition === null
  const isGone = snapshot.currentExistence === 'Deleted'
  return nothingWaits && !isGone
}

/** React Query `refetchInterval`: refresh while any row has a request waiting, then stop. */
export function pollWhileStorageWaits(rows: readonly StoredSnapshotFields[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => row.transition !== null)
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
