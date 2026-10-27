import { describe, expect, it } from 'vitest'
import { pollWhileASyncWaits, templateClusterLabel, type TemplateClusterFields } from './templateState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

function cluster(currentExistence: string, transition: string | null, requestFailureReason: string | null = null): TemplateClusterFields {
  return { currentExistence, transition, requestFailureReason }
}

describe('templateClusterLabel', () => {
  it('shows the waiting sync while there is one, whatever the cluster holds', () => {
    expect(templateClusterLabel(cluster('NotCreated', 'Syncing'))).toBe('Syncing')
    expect(templateClusterLabel(cluster('NotFound', 'Syncing', 'The cluster has no cluster.'))).toBe('Syncing')
  })

  it('says whether the cluster holds the alias once nothing waits', () => {
    expect(templateClusterLabel(cluster('Exists', null))).toBe('Available')
    expect(templateClusterLabel(cluster('NotFound', null))).toBe('Not found')
    // An alias seen gone keeps the reason of an older give-up; what the cluster shows now comes first.
    expect(templateClusterLabel(cluster('NotFound', null, 'The cluster has no cluster.'))).toBe('Not found')
  })

  // A cluster never synced and a cluster whose sync gave up both have no alias; only the second has a reason.
  it('tells a sync that gave up from one never run', () => {
    expect(templateClusterLabel(cluster('NotCreated', null, 'The cluster has no cluster.'))).toBe('Failed')
    expect(templateClusterLabel(cluster('NotCreated', null))).toBe('Not synced')
  })
})

describe('pollWhileASyncWaits', () => {
  it('does not poll without data', () => {
    expect(pollWhileASyncWaits(undefined)).toBe(false)
    expect(pollWhileASyncWaits([])).toBe(false)
  })

  it('keeps polling while a sync waits in any cluster', () => {
    expect(pollWhileASyncWaits([cluster('Exists', null), cluster('NotCreated', 'Syncing')])).toBe(POLL_MS)
  })

  it('stops once nothing waits — a failed or lost cluster will not change on its own', () => {
    expect(pollWhileASyncWaits([cluster('Exists', null), cluster('NotCreated', null, 'x'), cluster('NotFound', null)])).toBe(false)
  })
})
