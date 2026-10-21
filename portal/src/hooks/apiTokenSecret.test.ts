import { describe, expect, it } from 'vitest'
import { newApiTokenSecret, secretPerSubmission } from './useApiTokens'

const SHAPE = /^ovc_[A-Za-z0-9_-]{43}$/

describe('newApiTokenSecret', () => {
  it('is ovc_ followed by 43 base64url characters, the shape the control plane accepts', () => {
    for (let i = 0; i < 50; i++) {
      expect(newApiTokenSecret()).toMatch(SHAPE)
    }
  })

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newApiTokenSecret()))
    expect(seen.size).toBe(200)
  })
})

describe('secretPerSubmission', () => {
  // A retry under the same Idempotency-Key must send the same body, or the server answers IDEMPOTENCY_KEY_REUSED;
  // a create whose answer was lost must not leave a token whose secret nobody saw.
  it('gives the same secret for the same key, and a new one for a new key', () => {
    let made = 0
    const secretFor = secretPerSubmission(() => `ovc_secret-${++made}`)

    const first = secretFor('key-1')
    expect(secretFor('key-1')).toBe(first)
    expect(secretFor('key-2')).not.toBe(first)
    expect(made).toBe(2)
  })
})
