import { useLegalDocument } from '@/hooks/useLegal'
import { useFormat, useLang, useT } from '@/i18n/LanguageContext'
import { LanguageSwitch } from '@/components/LanguageSwitch'

// US-LEGAL-03 — the public legal document. Reachable WITHOUT login (routed before the auth gate in
// App.tsx), so a visitor can read the terms before authenticating and accepting them. Shows the version +
// effective date so an acceptance can be tied to exactly what was on screen (US-LEGAL-04).
//
// Content is rendered as pre-wrapped text: the MVP body is a git-tracked placeholder, and a full markdown
// renderer is YAGNI until real legal copy lands (Iteration 2, BLOCK-LEGAL-1).
export function LegalTermsPage() {
  const { lang } = useLang()
  const { data, isLoading, isError } = useLegalDocument(lang)
  const t = useT()
  const f = useFormat()

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <LanguageSwitch className="mb-6 justify-end" />
        {isLoading && <div data-testid="legal-loading" className="text-sm text-muted-foreground">{t.common.loading}</div>}
        {isError && (
          <div data-testid="legal-error" className="text-sm text-muted-foreground">
            {t.legal.loadFailed}
          </div>
        )}
        {data && (
          <article data-testid="legal-terms">
            <h1 className="text-2xl font-semibold text-foreground">{data.title}</h1>
            <p className="mt-1 text-xs text-faint" data-testid="legal-version">
              {t.legal.versionLine(data.version, f.date(data.effectiveAt))}
            </p>
            <div className="mt-8 whitespace-pre-wrap text-sm leading-relaxed text-soft-foreground">
              {data.content}
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
