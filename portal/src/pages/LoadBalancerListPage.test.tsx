import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { LoadBalancerListPage } from './LoadBalancerListPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))
import { toast } from 'sonner'

const lb = (extra = {}) => ({
  id: 'lb-1', name: 'web-lb', networkId: 'net-6', zoneId: 'z1', vip: '2001:db8:0:d401::1:1',
  listeners: [{ protocol: 'TCP', port: 80, targetPort: 8080 }, { protocol: 'UDP', port: 53, targetPort: 53 }],
  backends: [{ vmId: 'vm-a' }, { vmId: 'vm-b' }],
  currentExistence: 'Exists', desiredExistence: 'Exists', transition: null as string | null,
  requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-01T00:00:00Z', ...extra,
})
const net = {
  id: 'net-6', name: 'six', currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists',
  transition: null, requestFailureReason: null, requestFailedAt: null, cidr: '10.0.0.0/24', gateway: '10.0.0.1',
  publicIpv6Subnet: '2001:db8:0:d401::/64', zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z',
}

function serve(rows: object[]) {
  server.use(
    http.get('*/v1/tenant/load-balancers', () => HttpResponse.json(rows)),
    http.get('*/v1/tenant/networks', () => HttpResponse.json([net])),
  )
}

const page = () => renderWithProviders(<MemoryRouter><LoadBalancerListPage /></MemoryRouter>)

describe('LoadBalancerListPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the empty state', async () => {
    serve([])
    page()
    await waitFor(() => expect(screen.getByText('No load balancers yet')).toBeInTheDocument())
    expect(screen.getByText('No load balancers')).toBeInTheDocument()
  })

  it('shows each load balancer: name, state, VIP marked IPv6 only, network, listeners, VM count', async () => {
    serve([lb()])
    page()
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('web-lb')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getByText('2001:db8:0:d401::1:1')).toBeInTheDocument()
    expect(within(row).getByText('IPv6 only')).toBeInTheDocument()
    await waitFor(() => expect(within(row).getByText(/^six · created/)).toBeInTheDocument())
    expect(within(row).getByText('TCP 80 → 8080 · UDP 53 → 53')).toBeInTheDocument()
    expect(within(row).getByText('2 VMs')).toBeInTheDocument()
    expect(screen.getByText('1 load balancer')).toBeInTheDocument()
  })

  it('shows an error when the list cannot be read', async () => {
    server.use(http.get('*/v1/tenant/load-balancers', () => HttpResponse.json(null, { status: 500 })))
    page()
    await waitFor(() => expect(screen.getByText(/failed to load load balancers/i)).toBeInTheDocument())
  })

  it('edits only a load balancer resting on Incus', async () => {
    serve([lb({ transition: 'Updating' }), lb({ id: 'lb-2', name: 'api-lb' })])
    page()
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(within(rows[0]).getByText('Updating')).toBeInTheDocument()
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit load balancer' })).toBeInTheDocument()
  })

  it('refuses delete while a create waits, allows it while an update waits', async () => {
    serve([lb({ currentExistence: 'NotCreated', transition: 'Creating' }), lb({ id: 'lb-2', name: 'api-lb', transition: 'Updating' })])
    page()
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(rows[1]).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('deletes after the confirm', async () => {
    let deleted = false
    serve([lb()])
    server.use(http.delete('*/v1/tenant/load-balancers/lb-1', () => { deleted = true; return new HttpResponse(null, { status: 202 }) }))
    page()
    const row = await screen.findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(deleted).toBe(true))
    expect(toast.success).toHaveBeenCalledWith('Load balancer is being deleted')
  })

  it('says why a delete was refused', async () => {
    serve([lb()])
    server.use(http.delete('*/v1/tenant/load-balancers/lb-1', () =>
      HttpResponse.json({ status: 422, title: 'x', code: 'LOAD_BALANCER_INVALID_STATE' }, { status: 422 })))
    page()
    const row = await screen.findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'The load balancer is still being created or deleted — try again in a moment'))
  })

  it('opens the create form', async () => {
    serve([])
    page()
    await userEvent.click(screen.getByRole('button', { name: 'Create load balancer' }))
    expect(await screen.findByRole('heading', { name: 'Create load balancer' })).toBeInTheDocument()
  })
})
