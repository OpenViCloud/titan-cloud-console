import { describe, expect, it } from 'vitest'
import {
  canAttachVolume,
  canDeleteVm,
  canSnapshotVm,
  canStartVm,
  canStopVm,
  holdsItsNetwork,
  isVmInTransition,
  pollWhileVmWaits,
  runsAGuest,
  vmLabel,
  type VmStatus,
  type VmStateFields,
} from './vmState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// A VM has one status; what the customer may do follows what Incus allows
// (titan-ops features/vm/design.md#requests-follow-incus).

function vm(status: VmStatus, requestFailureReason: string | null = null): VmStateFields {
  return { status, requestFailureReason }
}

const ALL: VmStatus[] = ['Creating', 'Starting', 'Stopping', 'Deleting', 'Running', 'Ready', 'Stopped', 'Frozen',
  'Error', 'Unknown', 'NotFound', 'Failed', 'Deleted']

function only(statuses: VmStatus[], rule: (row: VmStateFields) => boolean) {
  for (const status of ALL) {
    expect(rule(vm(status)), status).toBe(statuses.includes(status))
  }
}

describe('vmLabel', () => {
  it('shows the status as the server sends it', () => {
    for (const status of ALL.filter(s => s !== 'NotFound')) {
      expect(vmLabel(vm(status))).toBe(status)
    }
  })

  it('spells NotFound the way every other resource shows it', () => {
    expect(vmLabel(vm('NotFound'))).toBe('Not found')
  })

  it('does not hide a stop that gave up: the badge keeps the Incus word', () => {
    expect(vmLabel(vm('Running', 'The VM could not be stopped.'))).toBe('Running')
  })
})

describe('isVmInTransition', () => {
  it('Creating, Starting, Stopping and Deleting, nothing else', () => {
    only(['Creating', 'Starting', 'Stopping', 'Deleting'], isVmInTransition)
  })
})

describe('runsAGuest', () => {
  it('Running and Ready, nothing else', () => {
    only(['Running', 'Ready'], runsAGuest)
  })
})

describe('the buttons follow Incus', () => {
  it('Stop from Running, Ready, Frozen and Error', () => {
    only(['Running', 'Ready', 'Frozen', 'Error'], canStopVm)
  })

  it('Start from Stopped, and from Frozen where it resumes', () => {
    only(['Stopped', 'Frozen'], canStartVm)
  })

  it('Delete from every status but a delete waiting or done, or a create still waiting', () => {
    only(['Starting', 'Stopping', 'Running', 'Ready', 'Stopped', 'Frozen', 'Error', 'Unknown', 'NotFound', 'Failed'],
      canDeleteVm)
  })

  it('snapshot and volume attach from Running, Ready, Stopped, Frozen and a waiting start', () => {
    only(['Running', 'Ready', 'Stopped', 'Frozen', 'Starting'], canSnapshotVm)
    only(['Running', 'Ready', 'Stopped', 'Frozen', 'Starting'], canAttachVolume)
  })

  it('a status this portal was not taught offers nothing but Delete', () => {
    const unknownWord = { status: 'Migrating', requestFailureReason: null }
    expect(canStopVm(unknownWord)).toBe(false)
    expect(canStartVm(unknownWord)).toBe(false)
    expect(canSnapshotVm(unknownWord)).toBe(false)
    expect(canDeleteVm(unknownWord)).toBe(true)
    expect(vmLabel(unknownWord)).toBe('Migrating')
  })
})

describe('holdsItsNetwork', () => {
  // Same rule as the server's network-in-use check: the instance may be on Incus (a delete in flight included), or
  // its create waits.
  it('every status but Deleted, NotFound and Failed', () => {
    only(['Creating', 'Starting', 'Stopping', 'Deleting', 'Running', 'Ready', 'Stopped', 'Frozen', 'Error', 'Unknown'],
      holdsItsNetwork)
  })
})

describe('pollWhileVmWaits', () => {
  const withAddress = (row: VmStateFields, ipAddress: string | null) => ({ ...row, ipAddress })

  it('refreshes while a request waits, and stops once none does', () => {
    for (const status of ['Creating', 'Starting', 'Stopping', 'Deleting'] as VmStatus[]) {
      expect(pollWhileVmWaits([withAddress(vm('Running'), '10.0.0.5'), withAddress(vm(status), null)])).toBe(POLL_MS)
    }
    expect(pollWhileVmWaits([withAddress(vm('Running'), '10.0.0.5'), withAddress(vm('NotFound'), null),
      withAddress(vm('Frozen'), null), withAddress(vm('Failed'), null)])).toBe(false)
    expect(pollWhileVmWaits([])).toBe(false)
    expect(pollWhileVmWaits(undefined)).toBe(false)
  })

  it('refreshes while a VM is Unknown, which the next observation replaces', () => {
    expect(pollWhileVmWaits([withAddress(vm('Unknown'), null)])).toBe(POLL_MS)
  })

  // Incus says Running before DHCP answers, which ends the create: keep refreshing until the address shows.
  it('refreshes while a running guest has no address yet', () => {
    expect(pollWhileVmWaits([withAddress(vm('Running'), null)])).toBe(POLL_MS)
    expect(pollWhileVmWaits([withAddress(vm('Ready'), null)])).toBe(POLL_MS)
    expect(pollWhileVmWaits([withAddress(vm('Stopped'), null)])).toBe(false)
  })
})
