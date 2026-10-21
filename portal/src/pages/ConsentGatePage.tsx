import { useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Button } from '@/components/ui/button'
import { useAcceptTerms } from '@/hooks/useLegal'
import { useT } from '@/i18n/LanguageContext'
import { LanguageSwitch } from '@/components/LanguageSwitch'

// US-LEGAL-01 — click-wrap consent gate. Shown by ConsentGate when the signed-in user has not yet accepted
// the current document version. Blocks the app until they tick the box and confirm (AC1/AC2/AC3), or
// decline and sign out (AC4). Checkbox is NOT pre-ticked and the confirm button stays disabled until it is
// checked — consent must be an explicit, deliberate act (not a dark pattern).
export function ConsentGatePage() {
  const [agreed, setAgreed] = useState(false)
  const auth = useAuth()
  const accept = useAcceptTerms()
  const t = useT()

  return (
    <div
      data-testid="consent-gate"
      className="relative flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center"
    >
      <LanguageSwitch className="absolute right-4 top-4" />
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold text-foreground">{t.legal.consentTitle}</h1>
        <p className="text-sm text-soft-foreground">
          {t.legal.consentIntro}
        </p>
      </div>

      <label className="flex items-start gap-3 max-w-md text-left cursor-pointer">
        <input
          type="checkbox"
          data-testid="consent-checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0"
        />
        <span className="text-sm text-soft-foreground">
          {t.legal.agreeBefore}
          <a
            href="/legal/terms"
            target="_blank"
            rel="noreferrer"
            className="underline text-foreground hover:text-foreground"
          >
            {t.legal.agreeLink}
          </a>
          {t.legal.agreeAfter}
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button
          data-testid="consent-accept"
          disabled={!agreed || accept.isPending}
          onClick={() => accept.mutate()}
        >
          {t.legal.accept}
        </Button>
        <Button variant="outline" onClick={() => auth.signoutRedirect()}>
          {t.legal.decline}
        </Button>
      </div>
    </div>
  )
}
