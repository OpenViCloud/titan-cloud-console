import { useFormat, useT } from '@/i18n/LanguageContext'
import type { VmOfferingInfo } from '@/hooks/useVmOfferings'

// One row per size with what it is and what it costs an hour; none is picked for the customer, since the size sets
// the bill (titan-ops features/vm/design.md#vm-create-form).
export function VmSizePicker({ offerings, value, onChange, disabled }: {
  offerings: VmOfferingInfo[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const t = useT()
  const fmt = useFormat()
  return (
    <div className="space-y-1.5">
      <p id="vm-size-label" className="text-[13px] font-medium text-soft-foreground">{t.vmCreate.size}</p>
      {offerings.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">{t.vmCreate.noOptions}</div>
      ) : (
        <div role="radiogroup" aria-labelledby="vm-size-label" className="overflow-hidden rounded-md border border-border bg-card">
          {offerings.map(offering => (
            <label
              key={offering.id}
              className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-[13px] last:border-b-0 ${value === offering.id ? 'bg-primary-soft' : 'hover:bg-muted'}`}
            >
              <input
                type="radio"
                name="vm-size"
                value={offering.id}
                checked={value === offering.id}
                onChange={() => onChange(offering.id)}
                disabled={disabled}
                className="h-4 w-4 flex-shrink-0 accent-primary"
              />
              {/* On a phone the name takes its own line, vCPU and RAM go under it; from sm up, one aligned row. */}
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="w-full text-foreground sm:w-auto sm:flex-1">{offering.name}</span>{' '}
                <span className="w-[4.5rem] text-soft-foreground">{t.vmCreate.sizeVcpu(offering.vcpu)}</span>{' '}
                <span className="w-[5.5rem] text-soft-foreground">{t.vmCreate.sizeMemory(offering.memoryMb / 1024)}</span>
              </span>{' '}
              <span className="flex-shrink-0 text-right text-foreground">{t.vmCreate.perHour(fmt.rate(offering.pricePerHour))}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
