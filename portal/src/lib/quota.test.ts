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
})
