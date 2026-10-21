import { describe, expect, it } from 'vitest'
import { occupiesQuota } from './quota'

// One case per branch of the server rule, e.g. VmRepository.CountActiveByTenantAsync:
// desired Exists ∧ (Exists ∨ (NotCreated ∧ a waiting request)). Networks and volumes use the same rule.
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
    expect(occupiesQuota({ ...base, transition: 'Stopping' })).toBe(true)
  })
})
