import { describe, expect, it } from 'vitest'

// Every colour comes from a theme token in index.css, so light and dark both work. A literal colour in a
// component reads in one theme only. The patterns are deliberately broader than the codemod that removed
// them: any white/black utility, any hex, any rgb()/hsl() call, any Tailwind palette name with a shade.
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'white/black utility', re: /[a-z]-(?:white|black)(?![\w-])/ },
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}(?![\w-])/ },
  { name: 'rgb/hsl call', re: /\b(?:rgba?|hsla?)\(/ },
  {
    name: 'palette shade',
    re: /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?![\w-])/,
  },
]

const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

export function findLiteralColors(files: Record<string, string>): string[] {
  const hits: string[] = []
  for (const [path, text] of Object.entries(files)) {
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      for (const p of PATTERNS) {
        const m = line.match(p.re)
        if (m !== null) {
          hits.push(`${path}:${index + 1} ${p.name}: ${m[0]}`)
        }
      }
    })
  }
  return hits
}

describe('no literal colours in components', () => {
  it('scans a non-empty set of source files', () => {
    // An empty glob would make the next test pass while checking nothing.
    expect(Object.keys(sources).length).toBeGreaterThan(40)
  })

  it('finds a planted literal (the scan can fail)', () => {
    const planted = { '/src/x.tsx': '<p className="text-white/50">x</p>' }
    expect(findLiteralColors(planted)).toEqual(['/src/x.tsx:1 white/black utility: t-white'])
  })

  it('finds none in src', () => {
    expect(findLiteralColors(sources)).toEqual([])
  })
})
