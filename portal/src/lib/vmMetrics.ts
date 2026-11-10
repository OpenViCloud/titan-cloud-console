import type { Lang } from '@/i18n/lang'
import type { VmMetricPoint } from '@/hooks/useVmMetrics'
import { NUMBER_LOCALE } from './money'

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

function oneDecimal(value: number, lang: Lang): string {
  return value.toLocaleString(NUMBER_LOCALE[lang], { maximumFractionDigits: 1 })
}

// Binary units, as Incus and the guest's own tools count memory and disk.
export function formatBytes(bytes: number, lang: Lang): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${oneDecimal(value, lang)} ${BYTE_UNITS[unit]}`
}

export function formatByteRate(bytesPerSecond: number, lang: Lang): string {
  return `${formatBytes(bytesPerSecond, lang)}/s`
}

export function formatPercent(percent: number, lang: Lang): string {
  return `${oneDecimal(percent, lang)}%`
}

// The last point where a field has a number, so a card header shows the latest value even when the newest step has
// none.
export function latestWith(points: VmMetricPoint[], field: (p: VmMetricPoint) => number | null): VmMetricPoint | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    if (field(points[i]) !== null) {
      return points[i]
    }
  }
  return undefined
}

function emptyPoint(at: string): VmMetricPoint {
  return {
    at,
    cpuPercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    rootFsUsedBytes: null,
    rootFsSizeBytes: null,
    diskReadBytesPerSecond: null,
    diskWriteBytesPerSecond: null,
  }
}

// The API leaves out a step with no sample (titan-ops features/vm/design.md#vm-metrics). A chart joins its neighbours
// across a missing row, so each missing step becomes a row of nulls and the line breaks there. Raw 1h points sit at
// the second the worker read Incus, so only a hole of more than half a step counts.
export function fillGaps(points: VmMetricPoint[], stepSeconds: number): VmMetricPoint[] {
  const stepMs = stepSeconds * 1000
  const sorted = [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const filled: VmMetricPoint[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const previous = Date.parse(sorted[i - 1].at)
      const next = Date.parse(sorted[i].at)
      for (let t = previous + stepMs; t < next - stepMs / 2; t += stepMs) {
        filled.push(emptyPoint(new Date(t).toISOString()))
      }
    }
    filled.push(sorted[i])
  }
  return filled
}
