import { useAuth } from 'react-oidc-context'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/LanguageContext'
import { LanguageSwitch } from '@/components/LanguageSwitch'

// US-SL-01c — shown by TenantProvider when the signed-in user's tenant is still
// PendingApproval (US-SL-02 gate). Without it the user lands on the dashboard and
// every write op 403s with no explanation. Neutral/muted styling on purpose: waiting
// is not an error state.
export function PendingApprovalPage({ tenantName }: { tenantName: string }) {
  const auth = useAuth()
  const t = useT()
  return (
    <div
      data-testid="pending-approval"
      className="relative flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <LanguageSwitch className="absolute right-4 top-4" />
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold text-foreground">{t.pendingApproval.title}</h1>
        <p className="text-sm text-soft-foreground">
          {t.pendingApproval.before}
          <span className="font-medium text-foreground">{tenantName}</span>
          {t.pendingApproval.after}
        </p>
      </div>
      <Button variant="outline" onClick={() => auth.signoutRedirect()}>
        {t.pendingApproval.signOut}
      </Button>
    </div>
  )
}
