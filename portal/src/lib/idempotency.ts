import { useState } from 'react'
import { isAxiosError } from 'axios'

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

// IDEM-409-UX: how long a submission keeps asking while the server says its first request still runs.
// 20 × 500 ms covers a create's own request (it only records and enqueues — the worker runs the command later).
const IN_PROGRESS_RETRY_MS = 500
const IN_PROGRESS_MAX_ASKS = 20

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// docs/architecture/http-contract.md#idempotency-key: the server refuses a create without an Idempotency-Key, and replays the stored answer when
// the same key comes back. One key covers ONE logical submission:
//   - kept while the outcome is unknown (the request is in flight, or the network failed before any
//     response), so a double-click or a retry replays the first answer instead of creating twice;
//   - replaced as soon as the server has answered — success OR error. The server stores 4xx answers
//     too, so keeping the key after "quota exceeded" would replay that refusal even after the user
//     freed a slot and tried again.
//   - 409 IDEMPOTENCY_IN_PROGRESS is NOT an answer: it means "the first request with this key is still
//     running". The same request is sent again with the same key until the first one's stored answer
//     comes back as a replay (IDEM-409-UX). Treating it as an answer used to show an error for a
//     create that succeeded, and to drop the key — so the next click created a second resource.
export function createIdempotencyKeeper(
  newKey: () => string = () => crypto.randomUUID(),
  wait: (ms: number) => Promise<void> = sleep,
) {
  // The key of the submission whose outcome is still unknown; null when there is none.
  let pendingKey: string | null = null

  return async function withKey<T>(send: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    if (pendingKey === null) {
      pendingKey = newKey()
    }
    const key = pendingKey

    let result: T
    try {
      result = await sendUntilAnswered(send, key)
    } catch (error) {
      const serverAnswered = isAxiosError(error) && error.response !== undefined && !isInProgress(error)
      if (serverAnswered) {
        forget(key)
      }
      // No answer (network failure, timeout, or still in progress after the bounded wait): keep the
      // key so a retry replays the same submission.
      throw error
    }

    forget(key)
    return result
  }

  async function sendUntilAnswered<T>(send: (headers: Record<string, string>) => Promise<T>, key: string): Promise<T> {
    for (let ask = 1; ; ask++) {
      try {
        return await send({ [IDEMPOTENCY_HEADER]: key })
      } catch (error) {
        const askAgain = isInProgress(error) && ask < IN_PROGRESS_MAX_ASKS
        if (!askAgain) {
          throw error
        }
        await wait(IN_PROGRESS_RETRY_MS)
      }
    }
  }

  // Only clear the key this call used. A newer submission may have started meanwhile.
  function forget(key: string) {
    if (pendingKey === key) {
      pendingKey = null
    }
  }
}

function isInProgress(error: unknown): boolean {
  if (!isAxiosError(error) || error.response === undefined) {
    return false
  }
  if (error.response.status !== 409) {
    return false
  }
  const body = error.response.data as { code?: string } | null | undefined
  if (body === null || body === undefined) {
    return false
  }
  return body.code === 'IDEMPOTENCY_IN_PROGRESS'
}

/** One keeper per mounted mutation hook, so a key never leaks between two different forms. */
export function useIdempotencyKey() {
  // useState's initializer runs once per mount, so each form keeps the same keeper across renders.
  const [keeper] = useState(() => createIdempotencyKeeper())
  return keeper
}
