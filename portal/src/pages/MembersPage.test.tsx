import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MembersPage } from './MembersPage'

const member = (overrides = {}) => ({
  id: 'mem-1',
  keycloakUserId: 'kc-user-abc-123',
  joinedAt: '2026-08-01T00:00:00Z',
  ...overrides,
})

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/members']}>
      <MembersPage />
    </MemoryRouter>,
  )
}

describe('MembersPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders member rows with id and joined date', async () => {
    server.use(http.get('*/v1/tenant/members', () => HttpResponse.json([member()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('kc-user-abc-123')).toBeInTheDocument())
    expect(screen.getByText('Aug 1, 2026')).toBeInTheDocument()
  })

  it('shows empty state when no members', async () => {
    server.use(http.get('*/v1/tenant/members', () => HttpResponse.json([])))
    renderPage()
    await waitFor(() => expect(screen.getByText('No members yet')).toBeInTheDocument())
    // There is no way to add a member: the hint must not promise one.
    expect(screen.queryByText(/identity provider/i)).not.toBeInTheDocument()
    expect(screen.getByText('Only the account that created this tenant is a member; adding members is not available yet.')).toBeInTheDocument()
  })

  it('shows error banner when API returns 500', async () => {
    server.use(http.get('*/v1/tenant/members', () => HttpResponse.json(null, { status: 500 })))
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load members/i)).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the list in Vietnamese, with the date in Vietnamese format', async () => {
    server.use(http.get('*/v1/tenant/members', () => HttpResponse.json([member({ joinedAt: '2026-08-01T12:00:00Z' })])))
    renderWithProviders(
      <MemoryRouter initialEntries={['/members']}>
        <MembersPage />
      </MemoryRouter>,
      { lang: 'vi' },
    )
    await waitFor(() => expect(screen.getByText('01/08/2026')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Thành viên')
    expect(screen.getByRole('columnheader', { name: 'Mã thành viên' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Ngày tham gia' })).toBeInTheDocument()
  })
})
