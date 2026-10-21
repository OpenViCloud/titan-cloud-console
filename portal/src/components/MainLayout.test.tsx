import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TenantContext } from '@/contexts/TenantContext'
import { THEME_STORAGE_KEY } from '@/lib/theme'
import { LANG_STORAGE_KEY } from '@/i18n/lang'
import { LanguageProvider } from '@/i18n/LanguageProvider'
import { MainLayout } from './MainLayout'

vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(() => ({ removeUser: vi.fn(), signinRedirect: vi.fn(), signoutRedirect: vi.fn(), isAuthenticated: true, isLoading: false })),
}))
import { useAuth } from 'react-oidc-context'

const defaultTenant = { tenantId: 't1', tenantName: 'alice', status: 'Active' }

function renderLayout(initialPath = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const signoutRedirect = vi.fn()
  vi.mocked(useAuth).mockReturnValue({ removeUser: vi.fn(), signinRedirect: vi.fn(), signoutRedirect, isAuthenticated: true, isLoading: false } as never)
  const result = render(
    <QueryClientProvider client={qc}>
      <TenantContext.Provider value={defaultTenant}>
        <LanguageProvider detectCountry={async () => null}>
          <MemoryRouter initialEntries={[initialPath]}>
            <MainLayout />
          </MemoryRouter>
        </LanguageProvider>
      </TenantContext.Provider>
    </QueryClientProvider>
  )
  return { ...result, signoutRedirect }
}

function mainNav() {
  return screen.getByRole('navigation', { name: 'Main' })
}

async function openAccountMenu() {
  await userEvent.click(screen.getByRole('button', { name: /account menu for alice/i }))
}

describe('MainLayout', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.lang = 'en'
  })

  it('shows the OpenViCloud brand', () => {
    renderLayout()
    expect(screen.getAllByText('OpenViCloud').length).toBeGreaterThan(0)
    expect(screen.queryByText(/titan cloud/i)).not.toBeInTheDocument()
  })

  it('shows tenant name in the account menu button', () => {
    renderLayout()
    expect(screen.getByRole('button', { name: /account menu for alice/i })).toHaveTextContent('alice')
  })

  it('groups every customer page under its section', () => {
    renderLayout()
    const nav = mainNav()
    const groups = within(nav).getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(groups).toEqual(['Infrastructure', 'Billing', 'Account'])
    const links = within(nav).getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([
      ['Overview', '/'],
      ['Virtual Machines', '/vms'],
      ['Networks', '/networks'],
      ['Load balancers', '/load-balancers'],
      ['Volumes', '/volumes'],
      ['Usage', '/billing'],
      ['Invoices', '/billing/invoices'],
      ['Wallet', '/wallet'],
      ['Members', '/members'],
      ['SSH keys', '/ssh-keys'],
      ['API tokens', '/api-tokens'],
    ])
  })

  it('marks the current page, and only that page', () => {
    renderLayout('/vms')
    const current = within(mainNav()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(current.map(a => a.textContent)).toEqual(['Virtual Machines'])
  })

  it('marks Invoices, not Usage, on an invoice detail route', () => {
    renderLayout('/billing/invoices/inv-1')
    const current = within(mainNav()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(current.map(a => a.textContent)).toEqual(['Invoices'])
  })

  it('shows crumbs above the page, with a link back to Overview', () => {
    renderLayout('/networks')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/')
    expect(crumbs).toHaveTextContent('Networks')
  })

  it('shows the load balancers crumb on its page', () => {
    renderLayout('/load-balancers')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs).toHaveTextContent('Load balancers')
  })

  it('marks Virtual Machines on a VM page and links back to the list', () => {
    renderLayout('/vms/vm-1')
    const current = within(mainNav()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(current.map(a => a.textContent)).toEqual(['Virtual Machines'])
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Virtual Machines' })).toHaveAttribute('href', '/vms')
  })

  it('shows no crumbs on Overview itself', () => {
    renderLayout('/')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  })

  it('has the search box in the top bar', () => {
    renderLayout()
    expect(screen.getByRole('combobox', { name: /search vms, networks and volumes/i })).toBeInTheDocument()
  })

  it('has no collapse button any more', () => {
    renderLayout()
    expect(screen.queryByTitle('Collapse')).not.toBeInTheDocument()
  })

  it('opens the drawer from the menu button and closes it when a page is chosen', async () => {
    renderLayout('/')
    const sidebar = document.getElementById('app-sidebar')!
    expect(sidebar).toHaveAttribute('data-open', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(sidebar).toHaveAttribute('data-open', 'true')
    await userEvent.click(within(mainNav()).getByRole('link', { name: 'Networks' }))
    expect(sidebar).toHaveAttribute('data-open', 'false')
  })

  it('switches to dark from the account menu and remembers it', async () => {
    renderLayout()
    await openAccountMenu()
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('goes back to the system setting when System is chosen', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderLayout()
    await openAccountMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'System' }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('switches the whole frame to Vietnamese from the account menu and remembers it', async () => {
    renderLayout('/vms')
    await openAccountMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Tiếng Việt' }))

    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' })
    expect(within(nav).getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Hạ tầng', 'Thanh toán', 'Tài khoản'])
    expect(within(nav).getByRole('link', { name: 'Máy ảo' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation', { name: 'Đường dẫn' }).textContent).toBe('Tổng quanMáy ảo')
    expect(screen.getByRole('link', { name: 'Điều khoản dịch vụ' })).toHaveAttribute('href', '/legal/terms')
    expect(document.documentElement.lang).toBe('vi')
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('vi')
  })

  it('starts in the saved language', async () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'vi')
    renderLayout()
    await userEvent.click(screen.getByRole('button', { name: /menu tài khoản của alice/i }))
    expect(await screen.findByRole('menuitemradio', { name: 'Tiếng Việt' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitem', { name: 'Hồ sơ' })).toBeInTheDocument()
  })

  it('opens Profile from the account menu', async () => {
    renderLayout()
    await openAccountMenu()
    expect(await screen.findByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()
  })

  // Log out wires to auth.signoutRedirect, which ends the Keycloak session server-side.
  it('calls auth.signoutRedirect when Log out is clicked', async () => {
    const { signoutRedirect } = renderLayout()
    await openAccountMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }))
    expect(signoutRedirect).toHaveBeenCalled()
  })
})
