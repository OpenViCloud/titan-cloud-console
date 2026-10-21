import { Link } from 'react-router-dom'
import { useT } from '@/i18n/LanguageContext'

function Message({ title, body }: { title: string; body: string }) {
  const t = useT()
  return (
    <div className="max-w-xl mx-auto py-24 text-center">
      <h1 className="text-xl font-semibold text-foreground mb-2">{title}</h1>
      <p className="text-[13px] text-muted-foreground mb-6">{body}</p>
      <Link to="/" className="text-[13px] font-medium text-foreground underline underline-offset-4">
        {t.routeErrors.backHome}
      </Link>
    </div>
  )
}

/** A path no route of the portal matches. */
export function NotFoundPage() {
  const t = useT()
  return <Message title={t.routeErrors.notFoundTitle} body={t.routeErrors.notFoundBody} />
}

/** A page threw while rendering or loading: the portal's own words instead of react-router's English default. */
export function RouteErrorPage() {
  const t = useT()
  return <Message title={t.routeErrors.failedTitle} body={t.routeErrors.failedBody} />
}
