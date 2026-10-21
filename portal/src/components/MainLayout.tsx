import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Server,
  Network,
  Waypoints,
  HardDrive,
  BarChart3,
  FileText,
  Wallet,
  Users,
  KeyRound,
  KeySquare,
  User,
  LogOut,
} from 'lucide-react'
import { useAuth } from 'react-oidc-context'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useTenant } from '@/contexts/TenantContext'
import { AppShell, type Crumb, type NavGroup } from '@/components/shell/AppShell'
import { GlobalSearch } from '@/components/shell/GlobalSearch'
import { useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

function navGroups(t: Messages): NavGroup[] {
  return [
    { items: [{ to: '/', label: t.nav.overview, icon: LayoutDashboard, end: true }] },
    {
      title: t.nav.infrastructure,
      items: [
        { to: '/vms', label: t.nav.virtualMachines, icon: Server },
        { to: '/networks', label: t.nav.networks, icon: Network },
        { to: '/load-balancers', label: t.nav.loadBalancers, icon: Waypoints },
        { to: '/volumes', label: t.nav.volumes, icon: HardDrive },
      ],
    },
    {
      title: t.nav.billing,
      items: [
        { to: '/billing', label: t.nav.usage, icon: BarChart3, end: true },
        { to: '/billing/invoices', label: t.nav.invoices, icon: FileText },
        { to: '/wallet', label: t.nav.wallet, icon: Wallet },
      ],
    },
    {
      title: t.nav.account,
      items: [
        { to: '/members', label: t.nav.members, icon: Users },
        { to: '/ssh-keys', label: t.nav.sshKeys, icon: KeyRound },
        { to: '/api-tokens', label: t.nav.apiTokens, icon: KeySquare },
      ],
    },
  ]
}

function crumbsFor(pathname: string, t: Messages): Crumb[] {
  const overview: Crumb = { label: t.nav.overview, to: '/' }
  if (pathname === '/vms') return [overview, { label: t.nav.virtualMachines }]
  if (pathname.startsWith('/vms/')) return [overview, { label: t.nav.virtualMachines, to: '/vms' }, { label: t.nav.vmDetails }]
  if (pathname === '/networks') return [overview, { label: t.nav.networks }]
  if (pathname === '/load-balancers') return [overview, { label: t.nav.loadBalancers }]
  if (pathname === '/volumes') return [overview, { label: t.nav.volumes }]
  if (pathname === '/billing') return [overview, { label: t.nav.usage }]
  if (pathname === '/billing/invoices') return [overview, { label: t.nav.invoices }]
  if (pathname.startsWith('/billing/invoices/')) return [overview, { label: t.nav.invoices, to: '/billing/invoices' }, { label: t.nav.invoice }]
  if (pathname === '/wallet') return [overview, { label: t.nav.wallet }]
  if (pathname === '/members') return [overview, { label: t.nav.members }]
  if (pathname === '/ssh-keys') return [overview, { label: t.nav.sshKeys }]
  if (pathname === '/api-tokens') return [overview, { label: t.nav.apiTokens }]
  if (pathname === '/profile') return [overview, { label: t.nav.profile }]
  return []
}

function LogoutItem() {
  const auth = useAuth()
  const t = useT()
  return (
    <DropdownMenuItem destructive onSelect={() => auth.signoutRedirect()}>
      <LogOut className="h-3.5 w-3.5" />
      {t.shell.logOut}
    </DropdownMenuItem>
  )
}

export function MainLayout() {
  const { tenantName } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()
  const t = useT()

  const accountItems = (
    <>
      <DropdownMenuItem onSelect={() => navigate('/profile')}>
        <User className="h-3.5 w-3.5" />
        {t.nav.profile}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <LogoutItem />
    </>
  )

  // Legal link opens a new tab so the public route mounts fresh.
  const footer = (
    <a href="/legal/terms" target="_blank" rel="noreferrer" className="hover:text-foreground">
      {t.nav.termsOfService}
    </a>
  )

  return (
    <AppShell
      brand="OpenViCloud"
      groups={navGroups(t)}
      crumbs={crumbsFor(location.pathname, t)}
      accountLabel={tenantName}
      accountItems={accountItems}
      sidebarFooter={footer}
      search={<GlobalSearch />}
    >
      <Outlet />
    </AppShell>
  )
}
