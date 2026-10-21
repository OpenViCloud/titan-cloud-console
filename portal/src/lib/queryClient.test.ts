import { describe, expect, it } from 'vitest'
import { createAppQueryClient } from './queryClient'

// INTENT-4 S-D (DASHBOARD-STALE) — the Dashboard's Recent Activity is cached 30 s (staleTime), and no
// mutation refreshed it, so returning to the Dashboard right after an action showed the old feed.
// Every successful mutation now marks the activity feed stale, from one place: the mutation cache.
async function runMutation(client: ReturnType<typeof createAppQueryClient>, succeed: boolean) {
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => {
      if (!succeed) {
        throw new Error('refused')
      }
      return 'ok'
    },
  })
  try {
    await mutation.execute(undefined)
  } catch {
    // the failure path is the point of one test below
  }
}

describe('createAppQueryClient', () => {
  it('marks the activity feed stale after any successful mutation', async () => {
    const client = createAppQueryClient()
    client.setQueryData(['activity', 'tenant-1', 20], [])

    await runMutation(client, true)

    expect(client.getQueryState(['activity', 'tenant-1', 20])?.isInvalidated).toBe(true)
  })

  it('leaves the feed alone when the mutation failed — nothing new happened', async () => {
    const client = createAppQueryClient()
    client.setQueryData(['activity', 'tenant-1', 20], [])

    await runMutation(client, false)

    expect(client.getQueryState(['activity', 'tenant-1', 20])?.isInvalidated).toBe(false)
  })

  it('does not touch other queries', async () => {
    const client = createAppQueryClient()
    client.setQueryData(['vms', 'tenant-1'], [])

    await runMutation(client, true)

    expect(client.getQueryState(['vms', 'tenant-1'])?.isInvalidated).toBe(false)
  })
})
