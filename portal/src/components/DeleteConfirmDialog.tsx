import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/LanguageContext'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onConfirm: () => void
  loading?: boolean
  // What the delete does NOT undo, said before the click (an SSH key stays in the VMs that already have it).
  note?: string
}

export function DeleteConfirmDialog({ open, onOpenChange, name, onConfirm, loading, note }: Props) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.deleteDialog.title(name)}</DialogTitle>
          <DialogDescription>
            {t.deleteDialog.description}
          </DialogDescription>
          {note && <p className="text-[13px] text-soft-foreground">{note}</p>}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={loading}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? t.deleteDialog.deleting : t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
