import { describe, expect, it } from 'vitest'
import { networkOccupiesQuota, occupiesQuota, vmOccupiesQuota } from './quota'

// One case per branch of the server rule Volume.OccupiesQuota:
// desired Exists ∧ (Exists ∨ (NotCreated ∧ a waiting request)).
const base = { desiredExistence: 'Exists', currentExistence: 'Exists', transition: null as string | null }

describe('occupiesQuota', () => {
  it('counts what Incus holds', () => {
    expect(occupiesQuota(base)).toBe(true)
  })

  it('counts a create that is still waiting', () => {
    expect(occupiesQuota({ ...base, currentExistence: 'NotCreated', transition: 'Creating' })).toBe(true)
  })

  it('does not count a create that failed before Incus had it', () => {
    expect(occupiesQuota({ ...base, currentExistence: 'NotCreated', transition: null })).toBe(false)
  })

  it('does not count what Incus no longer has', () => {
    expect(occupiesQuota({ ...base, currentExistence: 'NotFound' })).toBe(false)
  })

  it('stops counting as soon as delete is pressed, even while Incus still holds it', () => {
    expect(occupiesQuota({ ...base, desiredExistence: 'Deleted', transition: 'Deleting' })).toBe(false)
  })

  it('does not count what is gone', () => {
    expect(occupiesQuota({ ...base, desiredExistence: 'Deleted', currentExistence: 'Deleted' })).toBe(false)
  })

  it('counts something Incus holds while another request waits on it', () => {
    expect(occupiesQuota({ ...base, transition: 'Attaching' })).toBe(true)
  })
})

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
