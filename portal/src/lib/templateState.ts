// A template's sync in one zone as the server sends it (docs/features/catalog/design.md#template-state-is-existence):
// Incus has no status word for an image alias, so there is no currentState — only whether that zone's cluster holds
// the alias, the sync still waiting, and why the last one gave up.
//   currentExistence / desiredExistence — NotCreated · Exists · NotFound / Exists (sync is add-only)
//   transition           — Syncing while a sync waits for the worker, derived by the server
//   requestFailureReason — the fixed reason of the last give-up; requestFailureDetail — the raw error

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface TemplateZoneFields {
  currentExistence: string
  transition: string | null
  requestFailureReason: string | null
}

/** The badge (P3b-1, the storage words): the waiting sync, else whether the cluster holds the alias, else why not. */
export function templateZoneLabel(zone: TemplateZoneFields): string {
  if (zone.transition !== null) {
    return zone.transition
  }
  if (zone.currentExistence === 'Exists') {
    return 'Available'
  }
  if (zone.currentExistence === 'NotFound') {
    return 'Not found'
  }
  if (zone.requestFailureReason !== null) {
    return 'Failed'
  }
  return 'Not synced'
}

/** React Query `refetchInterval`: refresh while a sync waits in any zone, then stop. */
export function pollWhileASyncWaits(zones: readonly TemplateZoneFields[] | undefined): number | false {
  if (zones === undefined) {
    return false
  }
  const anyWaiting = zones.some(zone => zone.transition !== null)
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
