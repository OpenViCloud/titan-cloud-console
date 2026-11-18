import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { useSshKeys } from '@/hooks/useSshKeys'
import { useCreateKeyAddition, useVmKeyAddition } from '@/hooks/useVmKeyAdditions'
import { useT } from '@/i18n/LanguageContext'
import { canAddVmKeys } from '@/lib/vmState'
import type { Vm } from '@/hooks/useVms'

type ApiError = AxiosError<{ code?: string }>

// titan-ops features/vm/design.md#vm-key-addition — 1 to 10 ids per request.
const MAX_PICKED = 10

const additionStateVariant: Record<string, BadgeProps['variant']> = {
  Adding: 'blue',
  Added:  'success',
  Failed: 'destructive',
}

/** Add SSH key (titan-ops features/vm/design.md#vm-key-addition): pick keys, submit, then follow the addition by id. */
export function AddSshKeyAction({ vm }: { vm: Vm }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [followId, setFollowId] = useState<string | null>(null)

  const { data: sshKeys = [] } = useSshKeys()
  const create = useCreateKeyAddition(vm.id)
  const { data: addition } = useVmKeyAddition(vm.id, followId)

  function toggle(id: string, picked: boolean) {
    setPickedIds(picked ? [...pickedIds, id] : pickedIds.filter(existing => existing !== id))
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setPickedIds([])
      setError('')
      setFollowId(null)
    }
  }

  async function handleSubmit() {
    setError('')
    try {
      const result = await create.mutateAsync(pickedIds)
      setFollowId(result.keyAdditionId)
    } catch (err) {
      const res = (err as ApiError).response
      if (res?.status === 422 && res.data?.code === 'VM_INVALID_STATUS') {
        setError(t.vmKeyAddition.invalidStatus)
      } else if (res?.status === 404 && res.data?.code === 'SSH_KEY_NOT_FOUND') {
        setError(t.vmKeyAddition.keyNotFound)
      } else {
        setError(t.vmKeyAddition.submitFailed)
      }
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        disabled={!canAddVmKeys(vm)}
        onClick={() => setOpen(true)}
      >
        {t.vmKeyAddition.addKey}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.vmKeyAddition.dialogTitle}</DialogTitle>
            <DialogDescription>{t.vmKeyAddition.dialogDescription}</DialogDescription>
          </DialogHeader>

          {followId === null ? (
            <>
              {sshKeys.length === 0 ? (
                <p className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">
                  {t.vmKeyAddition.noKeys}
                </p>
              ) : (
                <fieldset className="max-h-64 space-y-1.5 overflow-y-auto">
                  <legend className="sr-only">{t.vmKeyAddition.dialogTitle}</legend>
                  {sshKeys.map(key => (
                    <div key={key.id} className="flex items-center gap-2.5">
                      <input
                        id={`add-ssh-key-${key.id}`}
                        type="checkbox"
                        checked={pickedIds.includes(key.id)}
                        onChange={e => toggle(key.id, e.target.checked)}
                        disabled={create.isPending}
                        className="w-4 h-4 rounded accent-primary"
                      />
                      <label
                        htmlFor={`add-ssh-key-${key.id}`}
                        className="cursor-pointer select-none text-[13px] text-soft-foreground"
                      >
                        {key.name} <span className="font-mono text-xs text-faint">{key.fingerprint}</span>
                      </label>
                    </div>
                  ))}
                </fieldset>
              )}
              {error !== '' && <p className="text-xs text-bad">{error}</p>}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" disabled={create.isPending}>{t.common.cancel}</Button>
                </DialogClose>
                <Button
                  type="button"
                  disabled={pickedIds.length === 0 || pickedIds.length > MAX_PICKED || create.isPending}
                  onClick={handleSubmit}
                >
                  {create.isPending ? t.vmKeyAddition.submitting : t.vmKeyAddition.submit}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-2">
              {addition !== undefined && (
                <div className="flex items-center gap-2">
                  <Badge variant={additionStateVariant[addition.status] ?? 'default'}>{addition.status}</Badge>
                  {addition.status === 'Adding' && (
                    <span className="text-[13px] text-faint">{t.vmKeyAddition.adding}</span>
                  )}
                </div>
              )}
              {addition?.status === 'Added' && (
                <>
                  <p className="text-[13px] text-ok">{t.vmKeyAddition.added}</p>
                  {addition.restartNeeded && (
                    <p className="text-[13px] text-soft-foreground">{t.vmKeyAddition.restartNeeded}</p>
                  )}
                </>
              )}
              {addition?.status === 'Failed' && (
                <>
                  <p className="text-[13px] text-bad">{t.vmKeyAddition.failed}</p>
                  {addition.requestFailureReason !== null && (
                    <p className="text-[13px] text-bad">{addition.requestFailureReason}</p>
                  )}
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                  {t.common.close}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
