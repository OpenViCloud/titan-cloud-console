// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Read the file itself: vitest.config sets `css: false`, so any CSS import (even `?raw`) yields an empty string.
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

// Every pair a page draws text with: foreground token on the surface it sits on. WCAG AA needs 4.5:1.
const PAIRS: [string, string][] = [
  ['foreground', 'background'], ['foreground', 'card'],
  ['soft-foreground', 'card'], ['soft-foreground', 'background'],
  ['muted-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'muted'],
  ['faint', 'card'], ['faint', 'background'],
  ['sidebar-foreground', 'sidebar'],
  ['primary-foreground', 'primary'],
  ['primary-ink', 'card'], ['primary-ink', 'primary-soft'],
  ['destructive', 'card'],
  ['ok', 'ok-soft'], ['ok', 'card'],
  ['warn', 'warn-soft'], ['warn', 'card'],
  ['bad', 'bad-soft'], ['bad', 'card'],
  ['info', 'info-soft'], ['info', 'card'],
  ['idle', 'idle-soft'], ['idle', 'card'],
  ['qr-foreground', 'qr'],
]

function block(source: string, opener: RegExp): Record<string, string> {
  const start = source.search(opener)
  if (start < 0) {
    throw new Error(`block not found: ${opener}`)
  }
  const open = source.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') depth--
    if (depth === 0) {
      end = i
      break
    }
  }
  const tokens: Record<string, string> = {}
  for (const m of source.slice(open + 1, end).matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim()
  }
  return tokens
}

function rgb(value: string): [number, number, number] {
  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  }
  const m = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/)
  if (m === null) {
    throw new Error(`unsupported colour ${value}`)
  }
  const h = Number(m[1]) / 360
  const s = Number(m[2]) / 100
  const l = Number(m[3]) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

function luminance(value: string): number {
  const [r, g, b] = rgb(value).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function failures(tokens: Record<string, string>): string[] {
  const out: string[] = []
  for (const [fg, bg] of PAIRS) {
    const ratio = contrast(tokens[fg], tokens[bg])
    if (ratio < 4.5) out.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`)
  }
  return out
}

const light = block(css, /@theme\s*\{/)
const darkByOs = block(css, /@media \(prefers-color-scheme: dark\)/)
const darkByChoice = block(css, /:root\[data-theme="dark"\]\s*\{/)

describe('theme tokens', () => {
  it('declares the same dark palette for the OS setting and for the account-menu choice', () => {
    expect(Object.keys(darkByOs).length).toBeGreaterThan(30)
    expect(darkByOs).toEqual(darkByChoice)
  })

  it('reaches 4.5:1 for every text pair in light', () => {
    expect(failures(light)).toEqual([])
  })

  it('reaches 4.5:1 for every text pair in dark', () => {
    expect(failures({ ...light, ...darkByOs })).toEqual([])
  })

  it('reports a pair that is too pale (the check can fail)', () => {
    expect(failures({ ...light, faint: '#b0b3bd' })).toEqual(['faint on card: 2.09', 'faint on background: 1.90'])
  })
})
