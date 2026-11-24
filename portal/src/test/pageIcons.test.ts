import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The page head names the OpenViCloud icon, and the files it names are in public/
// (titan-ops features/public-site/design.md#brand-icon).
// Vitest runs from portal/; jsdom gives import.meta.url an http scheme, so paths start at the working directory.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

function linkHref(rel: string): string | null {
  const tags = html.match(/<link\b[^>]*>/g)
  if (tags === null) return null
  for (const tag of tags) {
    const relMatch = tag.match(/\brel="([^"]*)"/)
    const hrefMatch = tag.match(/\bhref="([^"]*)"/)
    if (relMatch !== null && hrefMatch !== null && relMatch[1] === rel) return hrefMatch[1]
  }
  return null
}

describe('page icons', () => {
  it('index.html links the PNG favicon and the phone icon', () => {
    expect(linkHref('icon')).toBe('/favicon.png')
    expect(linkHref('apple-touch-icon')).toBe('/apple-touch-icon.png')
  })

  it('every icon the app names is a PNG in public/', () => {
    for (const name of ['favicon.png', 'apple-touch-icon.png', 'brand-mark.png']) {
      const path = resolve(process.cwd(), 'public', name)
      expect(existsSync(path), name).toBe(true)
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), name).toBe('\x89PNG')
    }
  })
})
