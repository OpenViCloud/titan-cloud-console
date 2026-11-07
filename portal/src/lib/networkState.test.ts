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

// A network and a firewall rule have one status; a command the provider gave up on is a request failure
// (titan-ops features/network/design.md#network-lifecycle).

function row(status: string, requestFailureReason: string | null = null): IncusStateFields {
  return { status, requestFailureReason }
}

const waitingCreate = row('Creating')
const waitingDelete = row('Deleting')
const failedCreate = row('Failed', 'Network creation failed.')
const notFound = row('NotFound')

describe('incusLabel', () => {
  it('shows the status as the server spells it, NotFound as Not found', () => {
    expect(incusLabel(waitingCreate)).toBe('Creating')
    expect(incusLabel(waitingDelete)).toBe('Deleting')
    for (const word of ['Pending', 'Created', 'Errored', 'Unknown', 'Unavailable', 'enabled', 'disabled', 'logged', 'Failed', 'Deleted']) {
      expect(incusLabel(row(word))).toBe(word)
    }
    expect(incusLabel(notFound)).toBe('Not found')
    expect(incusLabel(failedCreate)).toBe('Failed')
  })
})

describe('canDeleteIncusResource', () => {
  it('offers delete whatever Incus reports, even not found, and for a failed create', () => {
    for (const word of ['Created', 'Errored', 'Unavailable', 'Pending', 'disabled', 'Unknown']) {
      expect(canDeleteIncusResource(row(word))).toBe(true)
    }
    expect(canDeleteIncusResource(notFound)).toBe(true)
    expect(canDeleteIncusResource(failedCreate)).toBe(true)
  })

  it('holds it back while a request waits, or once it is gone', () => {
    expect(canDeleteIncusResource(waitingCreate)).toBe(false)
    expect(canDeleteIncusResource(waitingDelete)).toBe(false)
    expect(canDeleteIncusResource(row('Deleted'))).toBe(false)
  })
})

describe('canRenameNetwork', () => {
  it('refuses a network on its way out or gone, allows the rest', () => {
    expect(canRenameNetwork(row('Created'))).toBe(true)
    expect(canRenameNetwork(notFound)).toBe(true)
    expect(canRenameNetwork(waitingCreate)).toBe(true)
    expect(canRenameNetwork(waitingDelete)).toBe(false)
    expect(canRenameNetwork(row('Deleted'))).toBe(false)
  })
})

describe('isUsableNetwork', () => {
  it('is only a network Incus reports Created with nothing waiting', () => {
    expect(isUsableNetwork(row('Created'))).toBe(true)
    expect(isUsableNetwork(waitingDelete)).toBe(false)
    expect(isUsableNetwork(waitingCreate)).toBe(false)
    expect(isUsableNetwork(row('Errored'))).toBe(false)
    expect(isUsableNetwork(row('Pending'))).toBe(false)
    expect(isUsableNetwork(notFound)).toBe(false)
  })
})

describe('pollWhileIncusWaits', () => {
  it('refreshes while a request waits or a network is still Pending, then stops', () => {
    expect(pollWhileIncusWaits([row('Created'), waitingCreate])).toBe(POLL_MS)
    expect(pollWhileIncusWaits([row('Pending')])).toBe(POLL_MS)
    expect(pollWhileIncusWaits([row('Created'), notFound, failedCreate])).toBe(false)
    expect(pollWhileIncusWaits([])).toBe(false)
    expect(pollWhileIncusWaits(undefined)).toBe(false)
  })
})

describe('refusedRequestReason', () => {
  it('gives the reason while nothing waits, and nothing once a request waits again', () => {
    expect(refusedRequestReason(row('Created', 'refused'))).toBe('refused')
    expect(refusedRequestReason(row('Deleting', 'refused'))).toBeNull()
    expect(refusedRequestReason(row('Created'))).toBeNull()
  })
})
