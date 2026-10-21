import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateVolume } from '@/hooks/useVolumes'
import { useVolumeOfferings } from '@/hooks/useVolumeOfferings'
import { useZones } from '@/hooks/useZones'
import { useT } from '@/i18n/LanguageContext'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function VolumeCreateModal({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('')
  const [volumeOfferingId, setVolumeOfferingId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [sizeGb, setSizeGb] = useState('')
  const [error, setError] = useState('')

  const createVolume = useCreateVolume()
  const { data: offerings = [] } = useVolumeOfferings()
  const { data: zones = [] } = useZones()
  const t = useT()

  const selectedOffering = offerings.find(o => o.id === volumeOfferingId)
  const needsCustomSize = selectedOffering?.isCustomized ?? true

  function reset() {
    setName(''); setVolumeOfferingId(''); setZoneId(''); setSizeGb(''); setError('')
  }

  async function handleCreate() {
    if (!name.trim() || !volumeOfferingId || !zoneId) return
    if (needsCustomSize && (!sizeGb || parseInt(sizeGb) <= 0)) {
      setError(t.volumeCreate.sizeRequired)
      return
    }
    setError('')
    try {
      await createVolume.mutateAsync({
        name: name.trim(),
        volumeOfferingId,
        zoneId,
        sizeGb: needsCustomSize ? parseInt(sizeGb) : (selectedOffering?.sizeGb ?? 0),
      })
      reset()
      onCreated()
      onOpenChange(false)
    } catch (e: unknown) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'VOLUME_QUOTA_EXCEEDED') {
        setError(t.volumeCreate.quotaExceeded)
      } else {
        setError(t.volumeCreate.createFailed)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.volumeCreate.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.volumeCreate.name}</label>
            <Input placeholder={t.volumeCreate.namePlaceholder} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.volumeCreate.zone}</label>
            <select
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
              value={zoneId}
              onChange={e => setZoneId(e.target.value)}
            >
              <option value="">{t.volumeCreate.selectZone}</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.volumeCreate.offering}</label>
            <select
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
              value={volumeOfferingId}
              onChange={e => setVolumeOfferingId(e.target.value)}
            >
              <option value="">{t.volumeCreate.selectOffering}</option>
              {offerings.map(o => (
                <option key={o.id} value={o.id}>
                  {o.name}{!o.isCustomized && o.sizeGb > 0 ? ` — ${o.sizeGb} GB` : ` — ${t.volumeCreate.customSize}`}
                </option>
              ))}
            </select>
          </div>
          {needsCustomSize && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.volumeCreate.size}</label>
              <Input
                type="number"
                placeholder={t.volumeCreate.sizePlaceholder}
                value={sizeGb}
                onChange={e => setSizeGb(e.target.value)}
                min={1}
              />
            </div>
          )}
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={createVolume.isPending}>{t.common.cancel}</Button>
          </DialogClose>
          <Button
            onClick={handleCreate}
            disabled={createVolume.isPending || !name.trim() || !volumeOfferingId || !zoneId}
          >
            {createVolume.isPending ? t.volumeCreate.creating : t.volumeCreate.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
