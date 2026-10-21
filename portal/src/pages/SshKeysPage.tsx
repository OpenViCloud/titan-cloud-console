import { useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { useAddSshKey, useDeleteSshKey, useSshKeys, type SshKey } from '@/hooks/useSshKeys'
import { useFormat, useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

const MAX_NAME_LENGTH = 64

// The server's answer to an add, in words (docs/features/vm/design.md#ssh-key).
function addErrorText(err: unknown, t: Messages): string {
  const res = (err as AxiosError<{ code?: string }>).response
  if (res === undefined) {
    return t.sshKeys.genericError
  }
  const code = res.data === undefined || res.data === null ? undefined : res.data.code
  if (code === 'SSH_KEY_EXISTS') {
    return t.sshKeys.exists
  }
  if (code === 'SSH_KEY_NAME_TAKEN') {
    return t.sshKeys.nameTaken
  }
  if (code === 'SSH_KEY_QUOTA_EXCEEDED') {
    return t.sshKeys.quotaExceeded
  }
  if (res.status === 400) {
    return t.sshKeys.invalidKey
  }
  return t.sshKeys.genericError
}

function AddSshKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const addKey = useAddSshKey()
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [formError, setFormError] = useState('')

  function close() {
    setName('')
    setPublicKey('')
    setFormError('')
    onOpenChange(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName === '') {
      setFormError(t.sshKeys.nameRequired)
      return
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setFormError(t.sshKeys.nameTooLong)
      return
    }
    if (publicKey.trim() === '') {
      setFormError(t.sshKeys.keyRequired)
      return
    }
    setFormError('')
    try {
      await addKey.mutateAsync({ name: trimmedName, publicKey: publicKey.trim() })
      toast.success(t.sshKeys.addedToast)
      close()
    } catch (err) {
      setFormError(addErrorText(err, t))
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) { close() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.sshKeys.add}</DialogTitle>
          <DialogDescription>{t.sshKeys.addDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="ssh-key-name" className="text-[13px] font-medium text-soft-foreground">{t.sshKeys.name}</label>
            <Input
              id="ssh-key-name"
              placeholder={t.sshKeys.namePlaceholder}
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={addKey.isPending}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ssh-key-public" className="text-[13px] font-medium text-soft-foreground">{t.sshKeys.publicKey}</label>
            <textarea
              id="ssh-key-public"
              rows={4}
              spellCheck={false}
              placeholder={t.sshKeys.publicKeyPlaceholder}
              value={publicKey}
              onChange={e => setPublicKey(e.target.value)}
              disabled={addKey.isPending}
              className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
            />
          </div>
          {formError && (
            <p className="text-xs text-bad bg-bad-soft border border-bad-border rounded-md px-3 py-2">{formError}</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={addKey.isPending} onClick={close}>
                {t.common.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={addKey.isPending}>
              {addKey.isPending ? t.sshKeys.adding : t.sshKeys.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SshKeysPage() {
  const t = useT()
  const f = useFormat()
  const { data: keys = [], isLoading, isError } = useSshKeys()
  const deleteKey = useDeleteSshKey()
  const [adding, setAdding] = useState(false)
  const [toDelete, setToDelete] = useState<SshKey | null>(null)

  async function confirmDelete() {
    if (toDelete === null) {
      return
    }
    try {
      await deleteKey.mutateAsync(toDelete.id)
      toast.success(t.sshKeys.deleted)
    } catch {
      toast.error(t.sshKeys.deleteFailed)
    }
    setToDelete(null)
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.sshKeys.title}</h1>
          <p className="text-[13px] text-faint mt-1">{t.sshKeys.subtitle}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" />
          {t.sshKeys.add}
        </Button>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.sshKeys.loadFailed}
        </p>
      )}

      {!isError && (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.sshKeys.name}</TableHead>
                <TableHead>{t.sshKeys.type}</TableHead>
                <TableHead>{t.sshKeys.fingerprint}</TableHead>
                <TableHead>{t.sshKeys.addedAt}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <div className="h-3 w-full bg-muted rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : keys.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                        <KeyRound className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <p className="text-[13px] text-faint font-medium">{t.sshKeys.empty}</p>
                      <p className="text-xs text-faint">{t.sshKeys.emptyHint}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                keys.map(key => (
                  <TableRow key={key.id}>
                    <TableCell className="text-[13px] font-medium text-foreground">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-soft-foreground">{key.type}</TableCell>
                    <TableCell className="font-mono text-xs text-soft-foreground break-all">{key.fingerprint}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.date(key.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t.sshKeys.deleteKey(key.name)}
                        onClick={() => setToDelete(key)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AddSshKeyDialog open={adding} onOpenChange={setAdding} />
      <DeleteConfirmDialog
        open={toDelete !== null}
        onOpenChange={open => { if (!open) { setToDelete(null) } }}
        name={toDelete === null ? '' : toDelete.name}
        onConfirm={confirmDelete}
        loading={deleteKey.isPending}
        note={t.sshKeys.deleteNote}
      />
    </div>
  )
}
