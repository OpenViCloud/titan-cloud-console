import * as React from 'react'
import * as RechartsPrimitive from 'recharts'
import type { LegendPayload } from 'recharts/types/component/DefaultLegendContent'
import type { NameType, Payload, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import type { TooltipContentProps } from 'recharts/types/component/Tooltip'
import { cn } from '@/lib/utils'

// shadcn/ui chart, adapted to this portal's theme: light and dark switch by redefining the --color-* variables
// (index.css), not by a `.dark` class, so a series takes one `color` — a theme token such as var(--color-info) — and
// reads in both themes. Upstream's `theme: { light, dark }` option is left out for that reason.
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (context === null) {
    throw new Error('useChart must be used within a <ChartContainer />')
  }
  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          'flex aspect-video justify-center text-xs',
          '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border',
          '[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-reference-line_line]:stroke-border',
          '[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden',
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

// Each series key becomes --color-<key> inside this chart, so a series is drawn with var(--color-<key>).
const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([, item]) => item.color !== undefined)
  if (colorConfig.length === 0) {
    return null
  }
  const lines = colorConfig.map(([key, item]) => `  --color-${key}: ${item.color};`).join('\n')
  return <style dangerouslySetInnerHTML={{ __html: `[data-chart=${id}] {\n${lines}\n}` }} />
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: Partial<TooltipContentProps<ValueType, NameType>> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: 'line' | 'dot' | 'dashed'
    nameKey?: string
    labelKey?: string
  }) {
  const { config } = useChart()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || payload === undefined || payload.length === 0) {
      return null
    }
    const [item] = payload
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`
    const itemConfig = getPayloadConfigFromPayload(config, item, key)
    let value: React.ReactNode = itemConfig?.label
    if (labelKey === undefined && typeof label === 'string') {
      value = config[label]?.label ?? label
    }
    if (labelFormatter !== undefined) {
      return <div className={cn('font-medium', labelClassName)}>{labelFormatter(value, payload)}</div>
    }
    if (value === undefined || value === null || value === '') {
      return null
    }
    return <div className={cn('font-medium', labelClassName)}>{value}</div>
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey])

  if (active !== true || payload === undefined || payload.length === 0) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== 'dot'

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter(item => item.type !== 'none')
          .map((item: Payload<ValueType, NameType>, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)
            const indicatorColor = color ?? item.payload?.fill ?? item.color

            return (
              <div
                key={`${item.dataKey ?? index}`}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
                  indicator === 'dot' && 'items-center',
                )}
              >
                {formatter !== undefined && item.value !== undefined && item.name !== undefined ? (
                  formatter(item.value, item.name, item, index, payload)
                ) : (
                  <>
                    {itemConfig?.icon !== undefined ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn('shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)', {
                            'h-2.5 w-2.5': indicator === 'dot',
                            'w-1': indicator === 'line',
                            'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                            'my-0.5': nestLabel && indicator === 'dashed',
                          })}
                          style={{ '--color-bg': indicatorColor, '--color-border': indicatorColor } as React.CSSProperties}
                        />
                      )
                    )}
                    <div
                      className={cn('flex flex-1 justify-between leading-none', nestLabel ? 'items-end' : 'items-center')}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value !== undefined && item.value !== null && (
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean
  payload?: ReadonlyArray<LegendPayload>
  verticalAlign?: 'top' | 'middle' | 'bottom'
  nameKey?: string
}) {
  const { config } = useChart()

  if (payload === undefined || payload.length === 0) {
    return null
  }

  return (
    <div
      className={cn('flex items-center justify-center gap-4', verticalAlign === 'top' ? 'pb-3' : 'pt-3', className)}
    >
      {payload
        .filter(item => item.type !== 'none')
        .map(item => {
          const key = `${nameKey ?? item.dataKey ?? 'value'}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)

          return (
            <div
              key={`${item.value}`}
              className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
            >
              {itemConfig?.icon !== undefined && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
              )}
              {itemConfig?.label}
            </div>
          )
        })}
    </div>
  )
}

// The config entry of a tooltip or legend item: by the key itself, or by a field of the item that names it.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }
  let inner: unknown = undefined
  if ('payload' in payload && typeof payload.payload === 'object' && payload.payload !== null) {
    inner = payload.payload
  }

  let configLabelKey: string = key
  if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    typeof inner === 'object' &&
    inner !== null &&
    key in inner &&
    typeof inner[key as keyof typeof inner] === 'string'
  ) {
    configLabelKey = inner[key as keyof typeof inner] as string
  }

  if (configLabelKey in config) {
    return config[configLabelKey]
  }
  return config[key]
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle }
