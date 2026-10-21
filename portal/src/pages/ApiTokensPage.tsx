import { useState } from 'react'
import { Copy, KeySquare, Plus, Trash2 } from 'lucide-react'
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
import {
  API_TOKEN_LIFETIMES, useApiTokens, useCreateApiToken, useDeleteApiToken, type ApiToken,
} from '@/hooks/useApiTokens'
import { useFormat, useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

const MAX_NAME_LENGTH = 64
const DEFAULT_LIFETIME = '90'
const NEVER = 'never'

// The server's answer to a create, in words (docs/features/public-api/design.md#api-token).
function createErrorText(err: unknown, t: Messages): string {
  const res = (err as AxiosError<{ code?: string }>).response
  if (res === undefined) {
    return t.apiTokens.genericError
  }
  const code = res.data === undefined || res.data === null ? undefined : res.data.code
  if (code === 'API_TOKEN_NAME_TAKEN') {
    return t.apiTokens.nameTaken
  }
  if (code === 'API_TOKEN_QUOTA_EXCEEDED') {
    return t.apiTokens.quotaExceeded
  }
  return t.apiTokens.genericError
}

function lifetimeLabel(value: string, t: Messages): string {
  if (value === NEVER) {
    return t.apiTokens.never
  }
  return t.apiTokens.lifetimeDays(Number(value))
}

function CreateApiTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const createToken = useCreateApiToken()
  const [name, setName] = useState('')
  const [lifetime, setLifetime] = useState(DEFAULT_LIFETIME)
  const [formError, setFormError] = useState('')
  const [secret, setSecret] = useState<string | null>(null)

  function close() {
    setName('')
    setLifetime(DEFAULT_LIFETIME)
    setFormError('')
    setSecret(null)
    onOpenChange(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName === '') {
      setFormError(t.apiTokens.nameRequired)
      return
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setFormError(t.apiTokens.nameTooLong)
      return
    }
    setFormError('')
    let expiresInDays: number | null = null
    if (lifetime !== NEVER) {
      expiresInDays = Number(lifetime)
    }
    try {
      const created = await createToken.mutateAsync({ name: trimmedName, expiresInDays })
      setSecret(created.secret)
    } catch (err) {
      setFormError(createErrorText(err, t))
    }
  }

  function copySecret() {
    if (secret === null) {
      return
    }
    navigator.clipboard.writeText(secret).then(
      () => toast.success(t.apiTokens.copied),
      () => toast.error(t.apiTokens.copyFailed),
    )
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) { close() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{secret === null ? t.apiTokens.create : t.apiTokens.createdTitle}</DialogTitle>
          <DialogDescription>{secret === null ? t.apiTokens.createDescription : t.apiTokens.usageHint}</DialogDescription>
        </DialogHeader>
        {secret === null ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="api-token-name" className="text-[13px] font-medium text-soft-foreground">{t.apiTokens.name}</label>
              <Input
                id="api-token-name"
                placeholder={t.apiTokens.namePlaceholder}
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={createToken.isPending}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="api-token-lifetime" className="text-[13px] font-medium text-soft-foreground">{t.apiTokens.lifetime}</label>
              <select
                id="api-token-lifetime"
                value={lifetime}
                onChange={e => setLifetime(e.target.value)}
                disabled={createToken.isPending}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
              >
                {API_TOKEN_LIFETIMES.map(days => (
                  <option key={days} value={String(days)}>{lifetimeLabel(String(days), t)}</option>
                ))}
                <option value={NEVER}>{lifetimeLabel(NEVER, t)}</option>
              </select>
            </div>
            {formError && (
              <p className="text-xs text-bad bg-bad-soft border border-bad-border rounded-md px-3 py-2">{formError}</p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={createToken.isPending} onClick={close}>
                  {t.common.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={createToken.isPending}>
                {createToken.isPending ? t.apiTokens.creating : t.apiTokens.create}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-warn bg-warn-soft border border-warn-border rounded-md px-3 py-2">{t.apiTokens.showOnce}</p>
            <div className="flex gap-2">
              <Input readOnly value={secret} aria-label={t.apiTokens.secret} className="font-mono text-xs" onFocus={e => e.target.select()} />
              <Button type="button" variant="outline" onClick={copySecret}>
                <Copy className="w-4 h-4" />
                {t.apiTokens.copy}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={close}>{t.apiTokens.done}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ApiTokensPage() {
  const t = useT()
  const f = useFormat()
  const { data: tokens = [], isLoading, isError } = useApiTokens()
  const deleteToken = useDeleteApiToken()
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<ApiToken | null>(null)
  // Read once when the page opens: render stays pure, and a token that expires while the page is open shows as
  // expired on the next visit.
  const [openedAt] = useState(() => Date.now())

  async function confirmDelete() {
    if (toDelete === null) {
      return
    }
    try {
      await deleteToken.mutateAsync(toDelete.id)
      toast.success(t.apiTokens.deleted)
    } catch {
      toast.error(t.apiTokens.deleteFailed)
    }
    setToDelete(null)
  }

  function expiryText(token: ApiToken): string {
    if (token.expiresAt === null) {
      return t.apiTokens.never
    }
    const expired = new Date(token.expiresAt).getTime() <= openedAt
    if (expired) {
      return t.apiTokens.expiredOn(f.date(token.expiresAt))
    }
    return f.date(token.expiresAt)
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.apiTokens.title}</h1>
          <p className="text-[13px] text-faint mt-1">{t.apiTokens.subtitle}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4" />
          {t.apiTokens.create}
        </Button>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.apiTokens.loadFailed}
        </p>
      )}

      {!isError && (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.apiTokens.name}</TableHead>
                <TableHead>{t.apiTokens.token}</TableHead>
                <TableHead>{t.apiTokens.createdAt}</TableHead>
                <TableHead>{t.apiTokens.expiresAt}</TableHead>
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
              ) : tokens.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                        <KeySquare className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <p className="text-[13px] text-faint font-medium">{t.apiTokens.empty}</p>
                      <p className="text-xs text-faint">{t.apiTokens.emptyHint}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                tokens.map(token => (
                  <TableRow key={token.id}>
                    <TableCell className="text-[13px] font-medium text-foreground">{token.name}</TableCell>
                    <TableCell className="font-mono text-xs text-soft-foreground">{token.prefix}…</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.date(token.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{expiryText(token)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t.apiTokens.deleteToken(token.name)}
                        onClick={() => setToDelete(token)}
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

      <CreateApiTokenDialog open={creating} onOpenChange={setCreating} />
      <DeleteConfirmDialog
        open={toDelete !== null}
        onOpenChange={open => { if (!open) { setToDelete(null) } }}
        name={toDelete === null ? '' : toDelete.name}
        onConfirm={confirmDelete}
        loading={deleteToken.isPending}
        note={t.apiTokens.deleteNote}
      />
    </div>
  )
}
