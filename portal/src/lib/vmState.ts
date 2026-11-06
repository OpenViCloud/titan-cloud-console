// A VM has one status (titan-ops features/vm/design.md#requests-follow-incus):
//   Creating · Starting · Stopping · Deleting — a request waits on its command
//   Running · Ready · Stopped · Frozen · Error — the Incus word, at rest
//   Unknown  — a request ended but its report could not read the instance; the next observation replaces it
//   NotFound — the reconciler sees no instance
//   Failed   — the create gave up before Incus made an instance
//   Deleted  — gone; the API no longer lists it
// requestFailureReason is the fixed text of the last request whose command gave up
// (titan-ops architecture/resource-lifecycle.md#callback-routes).

import { POLL_MS } from '@/hooks/pollUntilSettled'

export type VmStatus =
  | 'Creating' | 'Starting' | 'Stopping' | 'Deleting'
  | 'Running' | 'Ready' | 'Stopped' | 'Frozen' | 'Error'
  | 'Unknown' | 'NotFound' | 'Failed' | 'Deleted'

export interface VmStateFields {
  // A string, not VmStatus: a status this portal was not taught still renders, and offers only Delete.
  status: string
  requestFailureReason: string | null
}

const IN_TRANSITION = new Set(['Creating', 'Starting', 'Stopping', 'Deleting'])
// Ready is a running guest that also told Incus it is ready.
const RUNNING_STATUSES = new Set(['Running', 'Ready'])
const STOPPABLE_STATUSES = new Set(['Running', 'Ready', 'Frozen', 'Error'])
// Frozen: Incus `start` resumes it.
const STARTABLE_STATUSES = new Set(['Stopped', 'Frozen'])
// A waiting start still leaves the instance Stopped (or Frozen) on Incus; a waiting stop or delete would race its
// command.
const SNAPSHOT_AND_ATTACH_STATUSES = new Set(['Running', 'Ready', 'Stopped', 'Frozen', 'Starting'])
// A create that may still instantiate is refused by the server, so the button does not offer it.
const NOT_DELETABLE_STATUSES = new Set(['Creating', 'Deleting', 'Deleted'])
const WITHOUT_AN_INSTANCE = new Set(['Deleted', 'NotFound', 'Failed'])

/** A request waits on its command: the list keeps refreshing and the badge names the move. */
export function isVmInTransition(vm: VmStateFields): boolean {
  return IN_TRANSITION.has(vm.status)
}

/** The badge: the status as the server sends it, with NotFound spelled the way every other resource shows it. */
export function vmLabel(vm: VmStateFields): string {
  if (vm.status === 'NotFound') {
    return 'Not found'
  }
  return vm.status
}

/** A guest is running: Running, or Ready (a running guest that also told Incus it is ready). */
export function runsAGuest(vm: VmStateFields): boolean {
  return RUNNING_STATUSES.has(vm.status)
}

export function canStopVm(vm: VmStateFields): boolean {
  return STOPPABLE_STATUSES.has(vm.status)
}

export function canStartVm(vm: VmStateFields): boolean {
  return STARTABLE_STATUSES.has(vm.status)
}

/** Every status but a delete already waiting or done, and but a create still waiting. */
export function canDeleteVm(vm: VmStateFields): boolean {
  return !NOT_DELETABLE_STATUSES.has(vm.status)
}

export function canSnapshotVm(vm: VmStateFields): boolean {
  return SNAPSHOT_AND_ATTACH_STATUSES.has(vm.status)
}

export function canAttachVolume(vm: VmStateFields): boolean {
  return SNAPSHOT_AND_ATTACH_STATUSES.has(vm.status)
}

/**
 * Same rule as the server's network-in-use check (Vm.HoldsItsNetwork): the instance may be on Incus, a delete in
 * flight included, or its create waits.
 */
export function holdsItsNetwork(vm: VmStateFields): boolean {
  return !WITHOUT_AN_INSTANCE.has(vm.status)
}

interface PolledVm extends VmStateFields {
  ipAddress: string | null
}

function awaitsItsAddress(vm: PolledVm): boolean {
  return runsAGuest(vm) && vm.ipAddress === null
}

/**
 * React Query `refetchInterval`: refresh while any VM has a request waiting, is Unknown (the next observation replaces
 * it), or runs a guest whose address has not shown yet (Incus says Running before DHCP answers, and that ends the
 * create), then stop.
 */
export function pollWhileVmWaits(rows: readonly PolledVm[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => isVmInTransition(row) || row.status === 'Unknown' || awaitsItsAddress(row))
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
