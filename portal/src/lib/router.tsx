import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { MainLayout } from '../components/MainLayout'
import { VmListPage } from '../pages/VmListPage'
import { VmDetailPage } from '../pages/VmDetailPage'
import { NetworkListPage } from '../pages/NetworkListPage'
import { LoadBalancerListPage } from '../pages/LoadBalancerListPage'
import { DashboardPage } from '../pages/DashboardPage'
import { ProfilePage } from '../pages/ProfilePage'
import { BillingPage } from '../pages/BillingPage'
import { InvoicesPage } from '../pages/InvoicesPage'
import { InvoiceDetailPage } from '../pages/InvoiceDetailPage'
import { VolumeListPage } from '../pages/VolumeListPage'
import { MembersPage } from '../pages/MembersPage'
import { SshKeysPage } from '@/pages/SshKeysPage'
import { ApiTokensPage } from '@/pages/ApiTokensPage'
import { WalletPage } from '../pages/WalletPage'
import { LegalTermsPage } from '../pages/LegalTermsPage'
import { NotFoundPage, RouteErrorPage } from '../pages/NotFoundPage'

export { RouterProvider }

// US-LEGAL-03 — public legal routes, rendered by App.tsx BEFORE the tenant/auth gate so a visitor can read
// the terms without logging in. No MainLayout chrome (no sidebar/nav for an anonymous reader).
export function createPublicRouter() {
  return createBrowserRouter([
    { path: '/legal/terms', element: <LegalTermsPage /> },
    // Only one document exists (OQ-2, gộp hẳn 1) — any other /legal path shows it.
    { path: '/legal/*', element: <LegalTermsPage /> },
  ])
}

export function createRouter() {
  return createBrowserRouter([
    {
      path: '/',
      element: <MainLayout />,
      errorElement: <RouteErrorPage />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'vms', element: <VmListPage /> },
        { path: 'vms/:vmId', element: <VmDetailPage /> },
        { path: 'networks', element: <NetworkListPage /> },
        { path: 'load-balancers', element: <LoadBalancerListPage /> },
        { path: 'volumes', element: <VolumeListPage /> },
        { path: 'billing', element: <BillingPage /> },
        { path: 'billing/invoices', element: <InvoicesPage /> },
        { path: 'billing/invoices/:invoiceId', element: <InvoiceDetailPage /> },
        { path: 'wallet', element: <WalletPage /> },
        { path: 'members', element: <MembersPage /> },
        { path: 'ssh-keys', element: <SshKeysPage /> },
        { path: 'api-tokens', element: <ApiTokensPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ])
}
