import { describe, expect, it } from 'vitest'
import { USER_DATA_MAX_BYTES, userDataByteLength } from './vmUserData'

// titan-ops features/vm/design.md#vm-create-flow — CreateVmValidator counts UTF-8 bytes, not characters.
describe('userDataByteLength', () => {
  it('counts ASCII one byte per character', () => {
    expect(userDataByteLength('#cloud-config')).toBe(13)
  })

  it('counts a Vietnamese accented character as more than one byte', () => {
    // 'á' (U+00E1) encodes to 2 bytes in UTF-8 though it is one JS character.
    expect(userDataByteLength('á')).toBe(2)
    expect('á'.length).toBe(1)
  })

  it('exceeds the limit at 16385 accented characters, each 2 bytes', () => {
    const text = 'á'.repeat(16385)
    expect(userDataByteLength(text)).toBe(32770)
    expect(userDataByteLength(text)).toBeGreaterThan(USER_DATA_MAX_BYTES)
  })

  it('stays within the limit at 16384 accented characters', () => {
    const text = 'á'.repeat(16384)
    expect(userDataByteLength(text)).toBe(USER_DATA_MAX_BYTES)
  })
})
