import { describe, expect, it } from 'vitest'
import {
  canAttachVolume,
  canDeleteVm,
  canSnapshotVm,
  canStartVm,
  canStopVm,
  holdsItsNetwork,
  pollWhileVmWaits,
  runsAGuest,
  isVmDrift,
  vmLabel,
  type VmStateFields,
} from './vmState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// a VM's currentState is the Incus status word for word (null while Incus has no instance), its
// existence is a field of its own, and a create the provider refused is a request failure
// (docs/architecture/desired-and-current.md#provider-state-is-verbatim). What the customer may do follows what
// Incus allows (docs/features/vm/design.md#requests-follow-incus).

function vm(overrides: Partial<VmStateFields>): VmStateFields {
  return {
    currentState: 'Running',
    desiredState: 'Running',
    currentExistence: 'Exists',
    desiredExistence: 'Exists',
    transition: null,
    requestFailureReason: null,
    ...overrides,
  }
}

const notFound = vm({ currentState: null, currentExistence: 'NotFound' })
const failedCreate = vm({ currentState: null, currentExistence: 'NotCreated', requestFailureReason: 'VM provisioning failed.' })
const gaveUpWithAnInstance = vm({ currentState: null, currentExistence: 'Exists', requestFailureReason: 'VM provisioning failed.' })
const creating = vm({ currentState: null, currentExistence: 'NotCreated', transition: 'Creating' })
const createdNotSeen = vm({ currentState: null, currentExistence: 'Exists', transition: 'Creating' })

describe('vmLabel', () => {
  it('shows the waiting request while there is one', () => {
    expect(vmLabel(creating)).toBe('Creating')
    expect(vmLabel(vm({ desiredState: 'Stopped', transition: 'Stopping' }))).toBe('Stopping')
  })

  it('shows the Incus status as Incus says it', () => {
    for (const status of ['Running', 'Ready', 'Stopped', 'Frozen', 'Error']) {
      expect(vmLabel(vm({ currentState: status }))).toBe(status)
    }
  })

  it('names the cases where Incus has no status to give', () => {
    expect(vmLabel(notFound)).toBe('Not found')
    expect(vmLabel(failedCreate)).toBe('Failed')
    expect(vmLabel(gaveUpWithAnInstance)).toBe('Failed')
  })
})

describe('isVmDrift', () => {
  it('Ready is running: a guest that reported itself ready is what Running asked for', () => {
    expect(isVmDrift(vm({ currentState: 'Ready' }))).toBe(false)
  })

  it('a guest that shut itself down, or a VM paused outside Titan, is drift', () => {
    expect(isVmDrift(vm({ currentState: 'Stopped' }))).toBe(true)
    expect(isVmDrift(vm({ currentState: 'Frozen' }))).toBe(true)
  })

  it('nothing to compare while a request waits or Incus has no status', () => {
    expect(isVmDrift(vm({ currentState: 'Running', desiredState: 'Stopped', transition: 'Stopping' }))).toBe(false)
    expect(isVmDrift(notFound)).toBe(false)
    expect(isVmDrift(vm({ currentState: 'Error' }))).toBe(false)
  })
})

describe('runsAGuest', () => {
  it('Running and Ready, nothing else', () => {
    expect(runsAGuest(vm({ currentState: 'Running' }))).toBe(true)
    expect(runsAGuest(vm({ currentState: 'Ready' }))).toBe(true)
    for (const row of [vm({ currentState: 'Stopped' }), vm({ currentState: 'Frozen' }), vm({ currentState: 'Error' }), notFound, creating]) {
      expect(runsAGuest(row)).toBe(false)
    }
  })
})

describe('the buttons follow Incus', () => {
  it('Stop from Running, Ready, Frozen and Error', () => {
    for (const status of ['Running', 'Ready', 'Frozen', 'Error']) {
      expect(canStopVm(vm({ currentState: status }))).toBe(true)
    }
    expect(canStopVm(vm({ currentState: 'Stopped', desiredState: 'Stopped' }))).toBe(false)
    expect(canStopVm(notFound)).toBe(false)
    expect(canStopVm(vm({ desiredState: 'Stopped', transition: 'Stopping' }))).toBe(false)
  })

  it('Start from Stopped, and from Frozen where it resumes', () => {
    expect(canStartVm(vm({ currentState: 'Stopped', desiredState: 'Stopped' }))).toBe(true)
    expect(canStartVm(vm({ currentState: 'Frozen' }))).toBe(true)
    for (const status of ['Running', 'Ready', 'Error']) {
      expect(canStartVm(vm({ currentState: status }))).toBe(false)
    }
    expect(canStartVm(failedCreate)).toBe(false)
  })

  it('Delete from every state but a delete already waiting, or a create that has no instance yet', () => {
    for (const row of [notFound, failedCreate, gaveUpWithAnInstance, createdNotSeen, vm({ currentState: 'Error' }),
      vm({ currentState: 'Frozen' }), vm({ desiredState: 'Stopped', transition: 'Stopping' })]) {
      expect(canDeleteVm(row)).toBe(true)
    }
    expect(canDeleteVm(vm({ desiredExistence: 'Deleted', transition: 'Deleting' }))).toBe(false)
    // The server refuses this one (Vm.RequestDelete: no provider id while the create waits — it may yet instantiate),
    // so the button does not offer it.
    expect(canDeleteVm(creating)).toBe(false)
  })

  it('snapshot and volume attach from Running, Ready, Stopped and Frozen — not Error, not without an instance', () => {
    for (const status of ['Running', 'Ready', 'Stopped', 'Frozen']) {
      expect(canSnapshotVm(vm({ currentState: status }))).toBe(true)
      expect(canAttachVolume(vm({ currentState: status }))).toBe(true)
    }
    for (const row of [vm({ currentState: 'Error' }), notFound, failedCreate, createdNotSeen]) {
      expect(canSnapshotVm(row)).toBe(false)
      expect(canAttachVolume(row)).toBe(false)
    }
  })

  it('no snapshot or attach while a stop or delete waits: the server refuses both', () => {
    expect(canSnapshotVm(vm({ desiredState: 'Stopped', transition: 'Stopping' }))).toBe(false)
    expect(canAttachVolume(vm({ desiredExistence: 'Deleted', transition: 'Deleting' }))).toBe(false)
  })
})

describe('holdsItsNetwork', () => {
  // Same rule as the server's network-in-use check: an instance that exists, in any status (an Error VM still has
  // its qemu process), or a create still waiting.
  it('while an instance exists or its create waits', () => {
    for (const status of ['Running', 'Ready', 'Stopped', 'Frozen', 'Error']) {
      expect(holdsItsNetwork(vm({ currentState: status }))).toBe(true)
    }
    expect(holdsItsNetwork(creating)).toBe(true)
    expect(holdsItsNetwork(vm({ desiredExistence: 'Deleted', transition: 'Deleting' }))).toBe(true)
  })

  it('not once Incus has nothing', () => {
    expect(holdsItsNetwork(notFound)).toBe(false)
    expect(holdsItsNetwork(failedCreate)).toBe(false)
  })
})

describe('pollWhileVmWaits', () => {
  // Incus has no in-between VM status to wait through: only a request still waiting keeps the list refreshing.
  const withAddress = (row: VmStateFields, ipAddress: string | null) => ({ ...row, ipAddress })

  it('refreshes while a request waits, and stops once none does', () => {
    expect(pollWhileVmWaits([withAddress(vm({}), '10.0.0.5'), withAddress(creating, null)])).toBe(POLL_MS)
    expect(pollWhileVmWaits([withAddress(vm({}), '10.0.0.5'), withAddress(notFound, null),
      withAddress(vm({ currentState: 'Frozen' }), null)])).toBe(false)
    expect(pollWhileVmWaits([])).toBe(false)
    expect(pollWhileVmWaits(undefined)).toBe(false)
  })

  // Incus says Running before DHCP answers, which ends the create: keep refreshing until the address shows.
  it('refreshes while a running guest has no address yet', () => {
    expect(pollWhileVmWaits([withAddress(vm({}), null)])).toBe(POLL_MS)
    expect(pollWhileVmWaits([withAddress(vm({ currentState: 'Ready' }), null)])).toBe(POLL_MS)
    expect(pollWhileVmWaits([withAddress(vm({ currentState: 'Stopped', desiredState: 'Stopped' }), null)])).toBe(false)
  })
})
