import { describe, expect, it } from 'vitest'
import {
  canDeleteIncusResource,
  canRenameNetwork,
  incusLabel,
  isUsableNetwork,
  pollWhileIncusWaits,
  type IncusStateFields,
  refusedRequestReason,
} from './networkState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// A network's and a firewall rule's currentState is the Incus word for word (null while Incus holds nothing), its
// existence is a field of its own, and a command the provider gave up on is a request failure
// (docs/architecture/desired-and-current.md#provider-state-is-verbatim).

function row(overrides: Partial<IncusStateFields>): IncusStateFields {
  return {
    currentState: 'Created',
    currentExistence: 'Exists',
    desiredExistence: 'Exists',
    transition: null,
    requestFailureReason: null,
    ...overrides,
  }
}

const waitingCreate = row({ currentState: null, currentExistence: 'NotCreated', transition: 'Creating' })
const waitingDelete = row({ desiredExistence: 'Deleted', transition: 'Deleting' })
const failedCreate = row({ currentState: null, currentExistence: 'NotCreated', requestFailureReason: 'Network creation failed.' })
const notFound = row({ currentState: null, currentExistence: 'NotFound' })

describe('incusLabel', () => {
  it('shows a waiting request first, then the Incus word as Incus spells it', () => {
    expect(incusLabel(waitingCreate)).toBe('Creating')
    expect(incusLabel(waitingDelete)).toBe('Deleting')
    for (const word of ['Pending', 'Created', 'Errored', 'Unknown', 'Unavailable', 'enabled', 'disabled', 'logged']) {
      expect(incusLabel(row({ currentState: word }))).toBe(word)
    }
  })

  it('says why Incus has no word: not found, a failed create, or nothing heard yet', () => {
    expect(incusLabel(notFound)).toBe('Not found')
    expect(incusLabel(failedCreate)).toBe('Failed')
    expect(incusLabel(row({ currentState: null }))).toBe('Unknown')
  })
})

describe('canDeleteIncusResource', () => {
  it('offers delete whatever Incus reports, even not found, and for a failed create', () => {
    for (const word of ['Created', 'Errored', 'Unavailable', 'Pending', 'disabled']) {
      expect(canDeleteIncusResource(row({ currentState: word }))).toBe(true)
    }
    expect(canDeleteIncusResource(notFound)).toBe(true)
    expect(canDeleteIncusResource(failedCreate)).toBe(true)
  })

  it('holds it back while a request waits, or once it is gone', () => {
    expect(canDeleteIncusResource(waitingCreate)).toBe(false)
    expect(canDeleteIncusResource(waitingDelete)).toBe(false)
    expect(canDeleteIncusResource(row({ currentState: null, currentExistence: 'Deleted', desiredExistence: 'Deleted' }))).toBe(false)
  })
})

describe('canRenameNetwork', () => {
  it('refuses a network on its way out or gone, allows the rest', () => {
    expect(canRenameNetwork(row({}))).toBe(true)
    expect(canRenameNetwork(notFound)).toBe(true)
    expect(canRenameNetwork(waitingDelete)).toBe(false)
    expect(canRenameNetwork(row({ currentExistence: 'Deleted', desiredExistence: 'Deleted' }))).toBe(false)
  })
})

describe('isUsableNetwork', () => {
  it('is only a network Incus reports Created with nothing waiting', () => {
    expect(isUsableNetwork(row({}))).toBe(true)
    expect(isUsableNetwork(waitingDelete)).toBe(false)
    expect(isUsableNetwork(waitingCreate)).toBe(false)
    expect(isUsableNetwork(row({ currentState: 'Errored' }))).toBe(false)
    expect(isUsableNetwork(row({ currentState: 'Pending' }))).toBe(false)
    expect(isUsableNetwork(notFound)).toBe(false)
  })
})

describe('pollWhileIncusWaits', () => {
  it('refreshes while a request waits or a network is still Pending, then stops', () => {
    expect(pollWhileIncusWaits([row({}), waitingCreate])).toBe(POLL_MS)
    expect(pollWhileIncusWaits([row({ currentState: 'Pending' })])).toBe(POLL_MS)
    expect(pollWhileIncusWaits([row({}), notFound, failedCreate])).toBe(false)
    expect(pollWhileIncusWaits([])).toBe(false)
    expect(pollWhileIncusWaits(undefined)).toBe(false)
  })
})

describe('refusedRequestReason', () => {
  const resource = (overrides: Partial<IncusStateFields>): IncusStateFields => ({
    currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null,
    requestFailureReason: null, ...overrides,
  })

  it('gives the reason while nothing waits, and nothing once a request waits again', () => {
    expect(refusedRequestReason(resource({ requestFailureReason: 'refused' }))).toBe('refused')
    expect(refusedRequestReason(resource({ requestFailureReason: 'refused', transition: 'Deleting' }))).toBeNull()
    expect(refusedRequestReason(resource({}))).toBeNull()
  })
})
