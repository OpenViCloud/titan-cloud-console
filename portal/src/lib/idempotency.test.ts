import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { createIdempotencyKeeper, IDEMPOTENCY_HEADER } from './idempotency'

const answered = (status: number) =>
  new AxiosError('http', 'ERR', undefined, undefined,
    { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {} })
const networkDown = () => new AxiosError('down', 'ERR_NETWORK')
const inProgress = () =>
  new AxiosError('http', 'ERR', undefined, undefined,
    { status: 409, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: { code: 'IDEMPOTENCY_IN_PROGRESS' } })

function keeper() {
  let n = 0
  return createIdempotencyKeeper(() => `k${++n}`, async () => {})
}

describe('createIdempotencyKeeper (docs/architecture/http-contract.md#idempotency-key)', () => {
  it('sends the key header', async () => {
    const withKey = keeper()
    const seen: string[] = []
    await withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    expect(seen).toEqual(['k1'])
  })

  it('a double submit while the first is in flight carries the SAME key', async () => {
    const withKey = keeper()
    const seen: string[] = []
    let release!: () => void
    const first = withKey(h => { seen.push(h[IDEMPOTENCY_HEADER]); return new Promise<void>(r => { release = r }) })
    const second = withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    await second
    release()
    await first
    expect(seen).toEqual(['k1', 'k1'])
  })

  it('a retry after the network failed (no answer) reuses the key', async () => {
    const withKey = keeper()
    const seen: string[] = []
    await expect(withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]); throw networkDown() })).rejects.toThrow()
    await withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    expect(seen).toEqual(['k1', 'k1'])
  })

  // The server stores 4xx answers and replays them for the same key — so after an answer, the next
  // submission must be a new request, or "quota exceeded" would outlive the user freeing a slot.
  it('after the server answered with an error, the next submission gets a new key', async () => {
    const withKey = keeper()
    const seen: string[] = []
    await expect(withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]); throw answered(422) })).rejects.toThrow()
    await withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    expect(seen).toEqual(['k1', 'k2'])
  })

  // IDEM-409-UX: a double click sends a second POST while the first still runs; the server answers it
  // 409 IDEMPOTENCY_IN_PROGRESS. That is not an answer to the submission — it is "ask again". Treating
  // it as one used to show an error toast AND drop the key, so the next click created a second resource.
  it('a 409 IDEMPOTENCY_IN_PROGRESS waits and asks again with the SAME key, then returns the replayed answer', async () => {
    const withKey = keeper()
    const seen: string[] = []
    let calls = 0
    const result = await withKey(async h => {
      seen.push(h[IDEMPOTENCY_HEADER])
      calls++
      if (calls < 3) throw inProgress()
      return 'vol-1'
    })
    expect(result).toBe('vol-1')
    expect(seen).toEqual(['k1', 'k1', 'k1'])
  })

  // The old bug exactly: the first request still runs, the second only ever hears 409 — the key must
  // survive, so the NEXT click is still the same submission and cannot create a second resource.
  it('while the first submission is still in flight, a 409 IDEMPOTENCY_IN_PROGRESS does not drop its key', async () => {
    const withKey = keeper()
    const seen: string[] = []
    let release!: () => void
    const first = withKey(h => { seen.push(h[IDEMPOTENCY_HEADER]); return new Promise<void>(r => { release = r }) })
    await expect(withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]); throw inProgress() })).rejects.toThrow()
    const third = withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    await third
    release()
    await first
    expect(new Set(seen)).toEqual(new Set(['k1']))
  })

  it('gives up after a bounded wait, keeping the key for a later retry', async () => {
    const withKey = keeper()
    const seen: string[] = []
    await expect(withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]); throw inProgress() })).rejects.toThrow()
    const attempts = seen.length
    expect(attempts).toBeGreaterThan(1)
    expect(attempts).toBeLessThanOrEqual(21)
    await withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    expect(new Set(seen)).toEqual(new Set(['k1']))
  })

  it('after a success, the next submission gets a new key (a second resource on purpose)', async () => {
    const withKey = keeper()
    const seen: string[] = []
    await withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    await withKey(async h => { seen.push(h[IDEMPOTENCY_HEADER]) })
    expect(seen).toEqual(['k1', 'k2'])
  })
})
