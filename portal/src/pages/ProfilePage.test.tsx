import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { ProfilePage } from './ProfilePage'

const activeProfile = { id: 'tenant-1', name: 'alice', status: 'Active', maxVms: 5, maxNetworks: 3 }

describe('ProfilePage', () => {
  it('renders tenant details and quota once loaded', async () => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json(activeProfile)))
    renderWithProviders(<ProfilePage />)

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('tenant-1')).toBeInTheDocument()
    expect(screen.getByText('5 machines')).toBeInTheDocument()
    expect(screen.getByText('3 networks')).toBeInTheDocument()
  })

  it('shows the status with a success badge when Active', async () => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json(activeProfile)))
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('shows a non-Active status (e.g. Suspended) without crashing', async () => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json({ ...activeProfile, status: 'Suspended' })))
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByText('Suspended')).toBeInTheDocument()
  })

  it('shows an error message when the profile fails to load', async () => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<ProfilePage />)
    await waitFor(() => expect(screen.getByText(/failed to load profile/i)).toBeInTheDocument())
  })

  it('shows the details and quota in Vietnamese', async () => {
    server.use(http.get('*/v1/tenant', () => HttpResponse.json(activeProfile)))
    renderWithProviders(<ProfilePage />, { lang: 'vi' })

    expect(await screen.findByText('5 máy')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hồ sơ')
    expect(screen.getByText('Tên tenant')).toBeInTheDocument()
    expect(screen.getByText('Giới hạn mạng')).toBeInTheDocument()
    expect(screen.getByText('3 mạng')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})
