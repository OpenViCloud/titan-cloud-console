import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// titan-ops architecture/testing.md#doubles-only-in-unit-tests — the app the browser runs talks to a real control plane;
// MSW and its switch live in unit tests only. This scan reads source text: it does not see a double built
// without these names.
const FORBIDDEN = [
  { pattern: /from ['"]msw(\/[^'"]*)?['"]/, why: 'imports MSW' },
  { pattern: /import\(['"][^'"]*mocks\/browser['"]\)/, why: 'loads the browser mock server' },
  { pattern: /setupWorker/, why: 'starts a mock service worker' },
  { pattern: /VITE_MOCK_AUTH/, why: 'reads the mock-auth switch' },
]

const sources = import.meta.glob<string>(
  ['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx', '!/src/test/**'],
  { query: '?raw', import: 'default', eager: true },
)

describe('no test double outside unit tests', () => {
  it('scans the app sources', () => {
    expect(Object.keys(sources)).toContain('/src/main.tsx')
  })

  it('no app source uses MSW or the mock-auth switch', () => {
    const offenders: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) {
          offenders.push(`${file} ${rule.why}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the build ships no mock service worker', () => {
    expect(existsSync(join(__dirname, '..', '..', 'public', 'mockServiceWorker.js'))).toBe(false)
  })
})
