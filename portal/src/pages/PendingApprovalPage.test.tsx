import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingApprovalPage } from './PendingApprovalPage'
import { FixedLanguage } from '@/test/FixedLanguage'
import { LanguageProvider } from '@/i18n/LanguageProvider'

const signoutRedirect = vi.fn()
vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ signoutRedirect }),
}))

describe('PendingApprovalPage', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  // AC9 — the waiting screen must name the account and explain the wait, so a
  // just-signed-up user understands why the app is not usable yet.
  it('shows a pending message and the tenant name', () => {
    render(<PendingApprovalPage tenantName="alice" />)
    expect(screen.getByTestId('pending-approval')).toBeTruthy()
    expect(screen.getByText(/pending approval/i)).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('signs the user out when Sign out is clicked', async () => {
    render(<PendingApprovalPage tenantName="alice" />)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(signoutRedirect).toHaveBeenCalledTimes(1)
  })

  it('explains the wait in Vietnamese when Vietnamese is picked', () => {
    render(<FixedLanguage lang="vi"><PendingApprovalPage tenantName="alice" /></FixedLanguage>)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tài khoản đang chờ duyệt')
    expect(screen.getByTestId('pending-approval').textContent).toContain('Tài khoản alice đang chờ quản trị viên duyệt.')
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy()
  })

  it('lets the reader switch the waiting screen to Vietnamese', async () => {
    render(<LanguageProvider detectCountry={async () => null}><PendingApprovalPage tenantName="alice" /></LanguageProvider>)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Account pending approval')
    await userEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tài khoản đang chờ duyệt')
  })
})
