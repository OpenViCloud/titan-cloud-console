// A VM's state as the server sends it (docs/architecture/desired-and-current.md#provider-state-is-verbatim):
//   currentState      — the Incus status word for word (Running · Ready · Stopped · Frozen · Error), null while
//                       Incus has no instance
//   currentExistence  — NotCreated · Exists · NotFound · Deleted (docs/architecture/desired-and-current.md#existence-axis)
//   requestFailureReason — the fixed text of a create the provider refused (…#request-failure)
// What the customer may do follows what Incus allows (docs/features/vm/design.md#requests-follow-incus).

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface VmStateFields {
  currentState: string | null
  desiredState: string
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
}

// Statuses with a qemu process that runs a guest; Ready is a running guest that also told Incus it is ready.
const RUNNING_STATUSES = new Set(['Running', 'Ready'])
const STOPPABLE_STATUSES = new Set(['Running', 'Ready', 'Frozen', 'Error'])
// Frozen: Incus `start` resumes it (docs/features/vm/design.md#requests-follow-incus).
const STARTABLE_STATUSES = new Set(['Stopped', 'Frozen'])
const SNAPSHOT_AND_ATTACH_STATUSES = new Set(['Running', 'Ready', 'Stopped', 'Frozen'])

function nothingWaits(vm: VmStateFields): boolean {
  return vm.transition === null
}

function hasStatus(vm: VmStateFields, statuses: Set<string>): boolean {
  if (vm.currentExistence !== 'Exists') {
    return false
  }
  if (vm.currentState === null) {
    return false
  }
  return statuses.has(vm.currentState)
}

/** The badge: the waiting request's move, else the Incus status, else why Incus has none. */
export function vmLabel(vm: VmStateFields): string {
  if (vm.transition !== null) {
    return vm.transition
  }
  if (vm.currentState !== null) {
    return vm.currentState
  }
  if (vm.currentExistence === 'NotFound') {
    return 'Not found'
  }
  if (vm.requestFailureReason !== null) {
    return 'Failed'
  }
  return 'Unknown'
}

/**
 * Drift: nothing waits, yet the VM rests somewhere other than what was asked — a guest that shut itself down
 * (Stopped, asked Running), a VM paused outside Titan (Frozen), or a stop Incus never carried out. Ready satisfies
 * Running. Error and no instance at all are not drift: the badge already says what is wrong.
 */
export function isVmDrift(vm: VmStateFields): boolean {
  if (!nothingWaits(vm)) {
    return false
  }
  if (vm.currentState === null || vm.currentState === 'Error') {
    return false
  }
  if (vm.desiredState === 'Running') {
    return !RUNNING_STATUSES.has(vm.currentState)
  }
  return vm.currentState !== vm.desiredState
}

/** A guest is running: Running, or Ready (a running guest that also told Incus it is ready). */
export function runsAGuest(vm: VmStateFields): boolean {
  return hasStatus(vm, RUNNING_STATUSES)
}

export function canStopVm(vm: VmStateFields): boolean {
  return nothingWaits(vm) && hasStatus(vm, STOPPABLE_STATUSES)
}

export function canStartVm(vm: VmStateFields): boolean {
  return nothingWaits(vm) && hasStatus(vm, STARTABLE_STATUSES)
}

/**
 * Every state but a delete already waiting (delete wins over a waiting stop or start), and but a create that has no
 * instance yet: the server refuses that delete because the create may still instantiate
 * (docs/features/vm/design.md#requests-follow-incus).
 */
export function canDeleteVm(vm: VmStateFields): boolean {
  if (vm.transition === 'Deleting') {
    return false
  }
  const createWaitsWithoutAnInstance = vm.transition === 'Creating' && vm.currentExistence === 'NotCreated'
  if (createWaitsWithoutAnInstance) {
    return false
  }
  return true
}

function stopOrDeleteWaits(vm: VmStateFields): boolean {
  return vm.transition === 'Stopping' || vm.transition === 'Deleting'
}

export function canSnapshotVm(vm: VmStateFields): boolean {
  return !stopOrDeleteWaits(vm) && hasStatus(vm, SNAPSHOT_AND_ATTACH_STATUSES)
}

export function canAttachVolume(vm: VmStateFields): boolean {
  return !stopOrDeleteWaits(vm) && hasStatus(vm, SNAPSHOT_AND_ATTACH_STATUSES)
}

/** Same rule as the server's network-in-use check: an instance that exists in any status, or a create waiting. */
export function holdsItsNetwork(vm: VmStateFields): boolean {
  if (vm.currentExistence === 'Exists') {
    return true
  }
  return vm.currentExistence === 'NotCreated' && vm.transition === 'Creating'
}

interface PolledVm extends VmStateFields {
  ipAddress: string | null
}

function awaitsItsAddress(vm: PolledVm): boolean {
  return runsAGuest(vm) && vm.ipAddress === null
}

/**
 * React Query `refetchInterval`: refresh while any VM has a request waiting, or runs a guest whose address has not
 * shown yet (Incus says Running before DHCP answers, and that ends the create), then stop.
 */
export function pollWhileVmWaits(rows: readonly PolledVm[] | undefined): number | false {
  if (rows === undefined) {
    return false
  }
  const anyWaiting = rows.some(row => row.transition !== null || awaitsItsAddress(row))
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
