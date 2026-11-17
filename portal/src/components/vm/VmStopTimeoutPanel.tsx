import { useState } from 'react'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUpdateVm, type Vm } from '@/hooks/useVms'
import { useT } from '@/i18n/LanguageContext'
import { parseStopTimeout } from '@/lib/vmStopTimeout'

// titan-ops features/vm/design.md#vm-stop-timeout — changed in place, no provider command; a stop requested later
// carries the new value.
// The field starts from the VM, not from an effect: the page keys this panel by the saved value, so a saved change
// re-read from the server remounts it with the new number.
export function VmStopTimeoutPanel({ vm }: { vm: Pick<Vm, 'id'> & { stopTimeoutSeconds: number } }) {
  const t = useT()
  const [text, setText] = useState(String(vm.stopTimeoutSeconds))
  const [error, setError] = useState('')
  const update = useUpdateVm()

  const seconds = parseStopTimeout(text)
  const changed = text.trim() !== String(vm.stopTimeoutSeconds)

  async function handleSave() {
    if (seconds === null) {
      setError(t.vmDetail.stopTimeoutRange)
      return
    }
    setError('')
    try {
      await update.mutateAsync({ vmId: vm.id, stopTimeoutSeconds: seconds })
      toast.success(t.vmDetail.stopTimeoutSaved)
    } catch (err) {
      const code = (err as AxiosError<{ code?: string }>).response?.data?.code
      if (code === 'VM_INVALID_STATUS') {
        setError(t.vmDetail.stopTimeoutVmDeleted)
      } else if (code === 'VALIDATION_ERROR' || code === 'INVALID_VM_STOP_TIMEOUT') {
        setError(t.vmDetail.stopTimeoutRange)
      } else {
        setError(t.vmDetail.stopTimeoutSaveFailed)
      }
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4" aria-label={t.vmDetail.stopTimeout}>
      <h2 className="text-[15px] font-semibold">{t.vmDetail.stopTimeout}</h2>
      <p data-testid="vm-stop-timeout" className="mt-3 text-[20px] font-bold tracking-tight tabular-nums">
        {t.vmDetail.stopTimeoutValue(vm.stopTimeoutSeconds)}
      </p>
      <p className="mt-1 text-[12.5px] text-faint">{t.vmDetail.stopTimeoutHint}</p>
      <form
        onSubmit={e => { e.preventDefault(); handleSave() }}
        className="mt-3 flex items-start gap-2"
      >
        <div className="min-w-0 flex-1">
          <Input
            aria-label={t.vmDetail.stopTimeoutInput}
            type="text"
            inputMode="numeric"
            value={text}
            onChange={e => { setText(e.target.value); setError('') }}
            error={error}
            disabled={update.isPending}
          />
        </div>
        <Button type="submit" disabled={!changed || update.isPending}>
          {update.isPending ? t.common.saving : t.common.save}
        </Button>
      </form>
    </section>
  )
}
