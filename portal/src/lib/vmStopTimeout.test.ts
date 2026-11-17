import { describe, expect, it } from 'vitest'
import { parseStopTimeout } from './vmStopTimeout'

// titan-ops features/vm/design.md#vm-stop-timeout — whole seconds from 30 to 1800.
describe('parseStopTimeout', () => {
  it.each([
    ['30', 30],
    ['120', 120],
    ['1800', 1800],
    [' 600 ', 600],
  ])('reads %s as %d seconds', (text, seconds) => {
    expect(parseStopTimeout(text)).toBe(seconds)
  })

  it.each(['', '29', '1801', '0', '-60', '90.5', '1e3', 'two minutes'])('refuses %j', text => {
    expect(parseStopTimeout(text)).toBeNull()
  })
})
