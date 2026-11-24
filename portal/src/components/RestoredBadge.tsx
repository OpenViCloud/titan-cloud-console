import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n/LanguageContext'

/**
 * Marks a VM or volume the platform restored from a backup (titan-ops features/backup/design.md#restore-as-new-resource).
 * The explanation is text inside the badge, hidden only visually, so a screen reader reads it wherever the badge is;
 * `describe={false}` where the page already says it next to the badge.
 */
export function RestoredBadge({ restoredFromBackup, describe = true }: { restoredFromBackup?: boolean; describe?: boolean }) {
  const t = useT()
  if (restoredFromBackup !== true) {
    return null
  }
  return (
    <Badge variant="blue">
      {t.restored.badge}
      {describe && <span className="sr-only"> {t.restored.description}</span>}
    </Badge>
  )
}
