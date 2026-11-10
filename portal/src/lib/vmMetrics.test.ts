import { describe, expect, it } from 'vitest'
import type { VmMetricPoint } from '@/hooks/useVmMetrics'
import { fillGaps, formatByteRate, formatBytes, formatPercent, latestWith } from './vmMetrics'

const point = (at: string, overrides: Partial<VmMetricPoint> = {}): VmMetricPoint => ({
  at,
  cpuPercent: 1,
  memoryUsedBytes: 1,
  memoryTotalBytes: 2,
  rootFsUsedBytes: 1,
  rootFsSizeBytes: 2,
  diskReadBytesPerSecond: 0,
  diskWriteBytesPerSecond: 0,
  ...overrides,
})

describe('bytes in readable units', () => {
  it('uses binary units with one decimal from KiB up', () => {
    expect(formatBytes(278491136, 'en')).toBe('265.6 MiB')
    expect(formatBytes(2059284480, 'en')).toBe('1.9 GiB')
    expect(formatBytes(10222313472, 'en')).toBe('9.5 GiB')
    expect(formatBytes(40960, 'en')).toBe('40 KiB')
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(0, 'en')).toBe('0 B')
    expect(formatBytes(3 * 1024 ** 4, 'en')).toBe('3 TiB')
  })

  it('writes the decimal mark of the language', () => {
    expect(formatBytes(278491136, 'vi')).toBe('265,6 MiB')
  })

  it('writes a rate per second', () => {
    expect(formatByteRate(40960, 'en')).toBe('40 KiB/s')
    expect(formatByteRate(1572864, 'vi')).toBe('1,5 MiB/s')
  })
})

describe('percent', () => {
  it('keeps one decimal in the language', () => {
    expect(formatPercent(3.2, 'en')).toBe('3.2%')
    expect(formatPercent(12.46, 'vi')).toBe('12,5%')
    expect(formatPercent(100, 'en')).toBe('100%')
  })
})

describe('latest value of a field', () => {
  it('is the last point where the field is not null', () => {
    const points = [
      point('2026-11-10T14:00:00Z', { cpuPercent: 5 }),
      point('2026-11-10T14:01:00Z', { cpuPercent: 7 }),
      point('2026-11-10T14:02:00Z', { cpuPercent: null }),
    ]
    expect(latestWith(points, p => p.cpuPercent)?.at).toBe('2026-11-10T14:01:00Z')
  })

  it('is undefined when the field is null in every point', () => {
    const points = [point('2026-11-10T14:00:00Z', { memoryUsedBytes: null })]
    expect(latestWith(points, p => p.memoryUsedBytes)).toBeUndefined()
  })
})

describe('gaps between points', () => {
  // A frame with no sample has no point (titan-ops features/vm/design.md#vm-metrics); the chart must break the line
  // there instead of joining the neighbours.
  it('adds a point with every field null for each missing step', () => {
    const points = [point('2026-11-10T14:00:00Z'), point('2026-11-10T14:03:00Z')]
    const filled = fillGaps(points, 60)
    expect(filled.map(p => p.at)).toEqual([
      '2026-11-10T14:00:00Z',
      '2026-11-10T14:01:00.000Z',
      '2026-11-10T14:02:00.000Z',
      '2026-11-10T14:03:00Z',
    ])
    expect(filled[1].cpuPercent).toBeNull()
    expect(filled[1].memoryUsedBytes).toBeNull()
    expect(filled[3].cpuPercent).toBe(1)
  })

  it('keeps points that follow each other as they are', () => {
    const points = [point('2026-11-10T14:00:00Z'), point('2026-11-10T14:05:00Z')]
    expect(fillGaps(points, 300)).toEqual(points)
    expect(fillGaps([], 60)).toEqual([])
  })

  // In 1h the points are the raw samples, at the second the worker read Incus: a few seconds late is not a gap.
  it('does not see a gap in samples a few seconds off the step', () => {
    const points = [point('2026-11-10T14:00:03Z'), point('2026-11-10T14:01:09Z'), point('2026-11-10T14:01:58Z')]
    expect(fillGaps(points, 60)).toEqual(points)
  })
})
