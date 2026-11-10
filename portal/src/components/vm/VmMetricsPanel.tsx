import { useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { useVmMetrics, type VmMetricPoint, type VmMetricsRange } from '@/hooks/useVmMetrics'
import { useFormat, useLang, useT, type Format } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import type { Lang } from '@/i18n/lang'
import { fillGaps, formatByteRate, formatBytes, formatPercent, latestWith } from '@/lib/vmMetrics'
import { cn } from '@/lib/utils'

// titan-ops features/vm/design.md#vm-metrics — usage of one VM over 1h, 24h or 7d, asked again every minute while
// this tab is open.

const RANGES: VmMetricsRange[] = ['1h', '24h', '7d']

function rangeLabel(t: Messages, range: VmMetricsRange): string {
  if (range === '24h') {
    return t.vmMetrics.range24h
  }
  if (range === '7d') {
    return t.vmMetrics.range7d
  }
  return t.vmMetrics.range1h
}

// 7 days of times of day repeat; the axis shows the day instead.
function axisTick(f: Format, range: VmMetricsRange): (at: string) => string {
  if (range === '7d') {
    return at => f.shortDate(at)
  }
  return at => f.time(at)
}

function tooltipTime(f: Format): (label: ReactNode) => ReactNode {
  return label => {
    if (typeof label === 'string') {
      return f.dateTime(label)
    }
    return label
  }
}

function tooltipRow(label: ReactNode, value: string, color: string) {
  return (
    <div className="flex w-full items-center gap-2">
      <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <div className="flex flex-1 items-center justify-between gap-3 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium text-foreground tabular-nums">{value}</span>
      </div>
    </div>
  )
}

function MetricCard({ title, header, children }: { title: string; header: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <div className="text-right">{header}</div>
      </div>
      {children !== undefined && <div className="px-3 pb-4 pt-3">{children}</div>}
    </section>
  )
}

function HeaderValue({ children }: { children: ReactNode }) {
  return <p className="text-[18px] font-bold tracking-tight tabular-nums">{children}</p>
}

function HeaderNote({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>
}

interface ChartProps {
  points: VmMetricPoint[]
  config: ChartConfig
  label: string
  range: VmMetricsRange
  yDomain: [number, number | 'auto']
  yTick: (value: number) => string
  value: (value: number) => string
}

// connectNulls stays off: a null step (no sample, no guest agent) is a gap in the line, never a zero.
function UsageChart({ points, config, label, range, yDomain, yTick, value }: ChartProps) {
  const f = useFormat()
  return (
    <ChartContainer config={config} role="figure" aria-label={label} className="aspect-auto h-48 w-full">
      <LineChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="at" tickFormatter={axisTick(f, range)} tickLine={false} axisLine={false} minTickGap={32} />
        <YAxis domain={yDomain} tickFormatter={yTick} tickLine={false} axisLine={false} width={72} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={tooltipTime(f)}
              formatter={(raw, name) => {
                const key = String(name)
                // A gap row carries null: say so, never 0.
                let shown = '—'
                if (typeof raw === 'number') {
                  shown = value(raw)
                }
                return tooltipRow(config[key]?.label ?? key, shown, `var(--color-${key})`)
              }}
            />
          }
        />
        {Object.keys(config).map(key => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

function CpuCard({ points, range }: { points: VmMetricPoint[]; range: VmMetricsRange }) {
  const t = useT()
  const { lang } = useLang()
  const latest = latestWith(points, p => p.cpuPercent)?.cpuPercent ?? null
  const percent = (v: number) => formatPercent(v, lang)
  return (
    <MetricCard
      title={t.vmMetrics.cpu}
      header={<HeaderValue>{latest !== null ? percent(latest) : '—'}</HeaderValue>}
    >
      <UsageChart
        points={points}
        config={{ cpuPercent: { label: t.vmMetrics.cpu, color: 'var(--color-primary)' } }}
        label={t.vmMetrics.cpuChart}
        range={range}
        yDomain={[0, 100]}
        yTick={v => `${v}%`}
        value={percent}
      />
    </MetricCard>
  )
}

function usedOf(t: Messages, lang: Lang, used: number, total: number | null): string {
  if (total === null) {
    return formatBytes(used, lang)
  }
  return t.vmMetrics.usedOf(formatBytes(used, lang), formatBytes(total, lang))
}

function MemoryCard({ points, range }: { points: VmMetricPoint[]; range: VmMetricsRange }) {
  const t = useT()
  const { lang } = useLang()
  const latest = latestWith(points, p => p.memoryUsedBytes)
  if (latest === undefined || latest.memoryUsedBytes === null) {
    return <MetricCard title={t.vmMetrics.memory} header={<HeaderNote>{t.vmMetrics.needsAgent}</HeaderNote>} />
  }
  const bytes = (v: number) => formatBytes(v, lang)
  return (
    <MetricCard
      title={t.vmMetrics.memory}
      header={<HeaderValue>{usedOf(t, lang, latest.memoryUsedBytes, latest.memoryTotalBytes)}</HeaderValue>}
    >
      <UsageChart
        points={points}
        config={{ memoryUsedBytes: { label: t.vmMetrics.used, color: 'var(--color-info)' } }}
        label={t.vmMetrics.memoryChart}
        range={range}
        yDomain={[0, latest.memoryTotalBytes ?? 'auto']}
        yTick={bytes}
        value={bytes}
      />
    </MetricCard>
  )
}

function DiskCard({ points, range }: { points: VmMetricPoint[]; range: VmMetricsRange }) {
  const t = useT()
  const { lang } = useLang()
  const latestFs = latestWith(points, p => p.rootFsUsedBytes)
  const latestRead = latestWith(points, p => p.diskReadBytesPerSecond)?.diskReadBytesPerSecond ?? null
  const latestWrite = latestWith(points, p => p.diskWriteBytesPerSecond)?.diskWriteBytesPerSecond ?? null
  const rate = (v: number) => formatByteRate(v, lang)

  // The read and write rates come from QEMU, so they are drawn even when the root filesystem needs the guest agent.
  let filesystem = <HeaderNote>{t.vmMetrics.needsAgent}</HeaderNote>
  if (latestFs !== undefined && latestFs.rootFsUsedBytes !== null) {
    filesystem = <HeaderValue>{usedOf(t, lang, latestFs.rootFsUsedBytes, latestFs.rootFsSizeBytes)}</HeaderValue>
  }
  let rates: ReactNode = null
  if (latestRead !== null || latestWrite !== null) {
    rates = (
      <HeaderNote>
        {t.vmMetrics.rates(latestRead !== null ? rate(latestRead) : '—', latestWrite !== null ? rate(latestWrite) : '—')}
      </HeaderNote>
    )
  }

  return (
    <MetricCard
      title={t.vmMetrics.disk}
      header={
        <>
          {filesystem}
          {rates}
        </>
      }
    >
      <UsageChart
        points={points}
        config={{
          diskReadBytesPerSecond: { label: t.vmMetrics.read, color: 'var(--color-info)' },
          diskWriteBytesPerSecond: { label: t.vmMetrics.write, color: 'var(--color-primary)' },
        }}
        label={t.vmMetrics.diskChart}
        range={range}
        yDomain={[0, 'auto']}
        yTick={rate}
        value={rate}
      />
    </MetricCard>
  )
}

export function VmMetricsPanel({ vmId }: { vmId: string }) {
  const t = useT()
  const [range, setRange] = useState<VmMetricsRange>('1h')
  const { data, isLoading, isError } = useVmMetrics(vmId, range)

  let body: ReactNode = null
  if (isLoading) {
    body = (
      <div className="flex flex-col gap-4" data-testid="vm-metrics-skeleton">
        {RANGES.map(r => (
          <div key={r} className="h-64 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  } else if (isError) {
    body = (
      <p className="rounded-lg border border-bad-border bg-bad-soft px-4 py-3 text-sm text-bad">
        {t.vmMetrics.loadFailed}
      </p>
    )
  } else if (data !== undefined && data.points.length === 0) {
    body = (
      <p className="rounded-xl border border-border bg-card px-6 py-10 text-center text-[13px] text-muted-foreground">
        {t.vmMetrics.noData}
      </p>
    )
  } else if (data !== undefined) {
    const points = fillGaps(data.points, data.stepSeconds)
    body = (
      <div className="flex flex-col gap-4">
        <CpuCard points={points} range={range} />
        <MemoryCard points={points} range={range} />
        <DiskCard points={points} range={range} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t.vmMetrics.range} className="inline-flex self-start rounded-lg border border-border bg-card p-0.5">
        {RANGES.map(r => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-semibold',
              range === r ? 'bg-primary-soft text-primary-ink' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {rangeLabel(t, r)}
          </button>
        ))}
      </div>
      {body}
    </div>
  )
}
