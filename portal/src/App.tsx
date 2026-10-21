import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter, createPublicRouter } from './lib/router'
import { TenantProvider } from './contexts/TenantContext'
import { Toaster } from 'sonner'
import { createAppQueryClient } from './lib/queryClient'
import { LanguageProvider } from './i18n/LanguageProvider'

const queryClient = createAppQueryClient()

export function App() {
  // US-LEGAL-03 — public legal pages are readable without auth, so route them BEFORE the tenant/auth gate
  // (TenantProvider forces a Keycloak redirect for anonymous visitors). Footer/consent-gate links open
  // these in a new tab, so this branch is (re-)evaluated on a fresh document load.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/legal')) {
    return (
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={createPublicRouter()} />
        </QueryClientProvider>
      </LanguageProvider>
    )
  }

  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <RouterProvider router={createRouter()} />
          <Toaster richColors position="bottom-right" />
        </TenantProvider>
      </QueryClientProvider>
    </LanguageProvider>
  )
}
