import { describe, expect, it } from 'vitest'
import { networkOccupiesQuota, vmOccupiesQuota, volumeOccupiesQuota } from './quota'

// Vm.OccupiesQuota: status not in Deleting, Deleted, NotFound, Failed.
describe('vmOccupiesQuota', () => {
  it('counts a VM with an instance or a create waiting, whatever else waits on it', () => {
    for (const status of ['Creating', 'Starting', 'Stopping', 'Running', 'Ready', 'Stopped', 'Frozen', 'Error', 'Unknown']) {
      expect(vmOccupiesQuota({ status }), status).toBe(true)
    }
  })

  it('stops counting as soon as delete is pressed, and does not count a VM whose instance is gone or never came', () => {
    for (const status of ['Deleting', 'Deleted', 'NotFound', 'Failed']) {
      expect(vmOccupiesQuota({ status }), status).toBe(false)
    }
  })

  it('never counts a VM restored from a backup, whatever its status', () => {
    for (const status of ['Creating', 'Starting', 'Stopping', 'Running', 'Ready', 'Stopped', 'Frozen', 'Error', 'Unknown', 'Deleting', 'Deleted', 'NotFound', 'Failed']) {
      expect(vmOccupiesQuota({ status, restoredFromBackup: true }), status).toBe(false)
    }
  })

  it('counts a VM not restored from a backup as before, the field false or absent', () => {
    expect(vmOccupiesQuota({ status: 'Running', restoredFromBackup: false })).toBe(true)
    expect(vmOccupiesQuota({ status: 'Running' })).toBe(true)
    expect(vmOccupiesQuota({ status: 'Failed', restoredFromBackup: false })).toBe(false)
  })
})

// Network.OccupiesQuota: status not in Deleting, Deleted, NotFound, Failed.
describe('networkOccupiesQuota', () => {
  it('counts a network with a create waiting or held by Incus, whatever word Incus gave', () => {
    for (const status of ['Creating', 'Pending', 'Created', 'Errored', 'Unavailable', 'Unknown']) {
      expect(networkOccupiesQuota({ status }), status).toBe(true)
    }
  })

  it('stops counting as soon as delete is pressed, and does not count a network on its way out, gone, lost or never made', () => {
    for (const status of ['Deleting', 'Deleted', 'NotFound', 'Failed']) {
      expect(networkOccupiesQuota({ status }), status).toBe(false)
    }
  })
})

// Volume.OccupiesQuota: Creating, Available, and Attaching or Detaching while Incus holds it (counted as held here).
describe('volumeOccupiesQuota', () => {
  it('counts a volume with a create waiting or held by Incus, attach and detach waiting included', () => {
    for (const status of ['Creating', 'Available', 'Attaching', 'Detaching']) {
      expect(volumeOccupiesQuota({ status }), status).toBe(true)
    }
  })

  it('stops counting as soon as delete is pressed, and does not count a volume that is gone, lost or never made', () => {
    for (const status of ['Deleting', 'Deleted', 'NotFound', 'Failed']) {
      expect(volumeOccupiesQuota({ status }), status).toBe(false)
    }
  })

  it('never counts a volume restored from a backup, whatever its status', () => {
    for (const status of ['Creating', 'Available', 'Attaching', 'Detaching', 'Deleting', 'Deleted', 'NotFound', 'Failed']) {
      expect(volumeOccupiesQuota({ status, restoredFromBackup: true }), status).toBe(false)
    }
  })

  it('counts a volume not restored from a backup as before, the field false or absent', () => {
    expect(volumeOccupiesQuota({ status: 'Available', restoredFromBackup: false })).toBe(true)
    expect(volumeOccupiesQuota({ status: 'Available' })).toBe(true)
    expect(volumeOccupiesQuota({ status: 'Deleting', restoredFromBackup: false })).toBe(false)
  })
})
