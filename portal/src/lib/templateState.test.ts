import { describe, expect, it } from 'vitest'
import { pollWhileASyncWaits, templateZoneLabel, type TemplateZoneFields } from './templateState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

function zone(currentExistence: string, transition: string | null, requestFailureReason: string | null = null): TemplateZoneFields {
  return { currentExistence, transition, requestFailureReason }
}

describe('templateZoneLabel', () => {
  it('shows the waiting sync while there is one, whatever the cluster holds', () => {
    expect(templateZoneLabel(zone('NotCreated', 'Syncing'))).toBe('Syncing')
    expect(templateZoneLabel(zone('NotFound', 'Syncing', 'The zone has no cluster.'))).toBe('Syncing')
  })

  it('says whether the cluster holds the alias once nothing waits', () => {
    expect(templateZoneLabel(zone('Exists', null))).toBe('Available')
    expect(templateZoneLabel(zone('NotFound', null))).toBe('Not found')
    // An alias seen gone keeps the reason of an older give-up; what the cluster shows now comes first.
    expect(templateZoneLabel(zone('NotFound', null, 'The zone has no cluster.'))).toBe('Not found')
  })

  // A zone never synced and a zone whose sync gave up both have no alias; only the second has a reason.
  it('tells a sync that gave up from one never run', () => {
    expect(templateZoneLabel(zone('NotCreated', null, 'The zone has no cluster.'))).toBe('Failed')
    expect(templateZoneLabel(zone('NotCreated', null))).toBe('Not synced')
  })
})

describe('pollWhileASyncWaits', () => {
  it('does not poll without data', () => {
    expect(pollWhileASyncWaits(undefined)).toBe(false)
    expect(pollWhileASyncWaits([])).toBe(false)
  })

  it('keeps polling while a sync waits in any zone', () => {
    expect(pollWhileASyncWaits([zone('Exists', null), zone('NotCreated', 'Syncing')])).toBe(POLL_MS)
  })

  it('stops once nothing waits — a failed or lost zone will not change on its own', () => {
    expect(pollWhileASyncWaits([zone('Exists', null), zone('NotCreated', null, 'x'), zone('NotFound', null)])).toBe(false)
  })
})
