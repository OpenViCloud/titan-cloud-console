import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VmDetailPage } from './VmDetailPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

import { toast } from 'sonner'

const st = (currentState: string | null, desiredState: string = currentState ?? 'Running', transition: string | null = null) =>
  ({
    currentState, desiredState, transition,
    currentExistence: currentState === null ? 'NotCreated' : 'Exists',
    desiredExistence: 'Exists',
    requestFailureReason: null as string | null,
    requestFailedAt: null as string | null,
  })

const vm = (overrides = {}) => ({
  id: 'vm-1', name: 'web-01', ...st('Running'), ipAddress: '10.0.0.5',
  networkId: 'n1', vmOfferingId: 'm', templateId: 't1',
  zoneId: 'z1', diskSizeGb: 50, createdAt: '2026-01-01T00:00:00Z',
  publicIpv6Address: '2001:db8::11',
  ...overrides,
})

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vms/:vmId" element={<VmDetailPage />} />
        <Route path="/vms" element={<p>VM list page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('VmDetailPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the facts of my VM, its size and this month\'s cost', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/vm-offerings', () => HttpResponse.json([{ id: 'm', name: 'Medium', cpu: 1, vcpu: 2, memoryMb: 4096 }])),
      http.get('*/v1/tenant/networks', () => HttpResponse.json([{ id: 'n1', name: 'prod-net' }])),
      http.get('*/v1/tenant/billing/summary', () => HttpResponse.json({
        month: '2026-10', totalCost: 120000, currency: 'VND',
        perVm: [{ vmId: 'other', vmName: 'x', totalCost: 999 }, { vmId: 'vm-1', vmName: 'web-01', totalCost: 85907 }],
      })),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
    expect(screen.getByText('2001:db8::11')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/Medium · 2 vCPU · 4 GB RAM/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('vm-cost')).toHaveTextContent('85,907 ₫'))
  })

  it('shows the VM page in Vietnamese: labels, buttons, money and date', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm({ createdAt: '2026-01-05T12:00:00Z' })])),
      http.get('*/v1/tenant/billing/summary', () => HttpResponse.json({
        month: '2026-10', totalCost: 120000, currency: 'VND',
        perVm: [{ vmId: 'vm-1', vmName: 'web-01', totalCost: 85907 }],
      })),
    )
    renderWithProviders(
      <MemoryRouter initialEntries={['/vms/vm-1']}>
        <Routes>
          <Route path="/vms/:vmId" element={<VmDetailPage />} />
        </Routes>
      </MemoryRouter>,
      { lang: 'vi' },
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Chi tiết' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Chi phí tháng này' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tổng quan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tắt' })).toBeInTheDocument()
    expect(screen.getByText('Ngày tạo')).toBeInTheDocument()
    expect(screen.getByText('05/01/2026')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('vm-cost')).toHaveTextContent('85.907 ₫'))
  })

  function publicIpv6Fact() {
    return screen.getByText('Public IPv6').closest('div') as HTMLElement
  }

  it('says Not enabled when the VM\'s network has no public IPv6', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm({ publicIpv6Address: null })])),
      http.get('*/v1/tenant/networks', () => HttpResponse.json([{ id: 'n1', name: 'prod-net', publicIpv6Subnet: null }])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(within(publicIpv6Fact()).getByText('Not enabled')).toBeInTheDocument()
  })

  it('shows a dash while the VM on a network with public IPv6 has no address yet', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm({ publicIpv6Address: null })])),
      http.get('*/v1/tenant/networks', () => HttpResponse.json([{ id: 'n1', name: 'prod-net', publicIpv6Subnet: '2001:db8:0:1::/64' }])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(within(publicIpv6Fact()).getByText('—')).toBeInTheDocument()
    expect(within(publicIpv6Fact()).queryByText('Not enabled')).not.toBeInTheDocument()
  })

  it('offers Stop on a Running VM and Start on a Stopped one', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Stopped'))])))
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument()
  })

  it('shows VM not found, with a way back, for an id that is not mine', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])))
    renderAt('/vms/someone-else')
    await waitFor(() => expect(screen.getByText('VM not found')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /back to virtual machines/i })).toHaveAttribute('href', '/vms')
  })

  it('goes back to the VM list after deleting the VM from its page', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.delete('*/v1/tenant/vms/vm-1', () => new HttpResponse(null, { status: 202 })),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByText('VM list page')).toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Virtual machine deleted')
  })

  it('lists the VM snapshots in the Snapshots tab', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'before-deploy', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      ])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-deploy')).toBeInTheDocument())
    expect(screen.getByText('Available')).toBeInTheDocument()
  })

  // The badge shows the waiting request from the server's transition, and a snapshot with a request waiting offers
  // neither Revert nor Delete (a second press adds nothing).
  it('shows a waiting revert or delete from transition and hides the snapshot actions', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'reverting-snap', currentExistence: 'Exists', desiredExistence: 'Exists', transition: 'Reverting', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
        { id: 'snap-2', name: 'deleting-snap', currentExistence: 'Exists', desiredExistence: 'Deleted', transition: 'Deleting', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
        { id: 'snap-3', name: 'resting-snap', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      ])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('reverting-snap')).toBeInTheDocument())

    expect(screen.getByText('Reverting')).toBeInTheDocument()
    expect(screen.getByText('Deleting')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    // Only the resting snapshot offers its actions.
    expect(screen.getAllByRole('button', { name: /^revert$/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /delete snapshot/i })).toHaveLength(1)
  })

  // Delete follows Incus: a snapshot Incus no longer has, or whose create failed before Incus had it, is deletable,
  // never revertible.
  it.each([
    ['Not found', { currentExistence: 'NotFound' }],
    ['Failed', { currentExistence: 'NotCreated', requestFailureReason: 'Snapshot creation failed.' }],
  ])('shows a %s snapshot and offers Delete but not Revert', async (label, overrides) => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'lost-snap', desiredExistence: 'Exists', transition: null,
          requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z', ...overrides },
      ])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('lost-snap')).toBeInTheDocument())
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete snapshot/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^revert$/i })).not.toBeInTheDocument()
  })

  // US-VMSNAP — empty snapshot state
  it('shows empty snapshot state when no snapshots', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText(/no snapshots/i)).toBeInTheDocument())
  })

  // US-VMSNAP — create snapshot
  // Incus snapshots Running, Ready, Stopped and Frozen instances (docs/features/vm/design.md#requests-follow-incus), not Error.
  it.each([['Frozen', true], ['Stopped', true], ['Error', false]])('offers New Snapshot on a %s VM: %s', async (status, offered) => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st(status, 'Running'))])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText(/no snapshots/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /new snapshot/i }) !== null).toBe(offered)
  })

  it('creates VM snapshot and shows success toast', async () => {
    let posted = false
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([])),
      http.post('*/v1/tenant/vms/vm-1/snapshots', async ({ request }) => {
        const body = await request.json() as { name: string }
        if (body.name === 'my-snap') posted = true
        return HttpResponse.json({ id: 'snap-new', name: 'my-snap', status: 'Creating' }, { status: 202 })
      }),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /new snapshot/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /new snapshot/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/snapshot name/i)).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/snapshot name/i), 'my-snap')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(posted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Snapshot created'))
  })

  // US-VMSNAP — delete snapshot
  it('deletes VM snapshot and shows success toast', async () => {
    let deleted = false
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'before-deploy', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      ])),
      http.delete('*/v1/tenant/vms/vm-1/snapshots/snap-1', () => {
        deleted = true
        return HttpResponse.json(null, { status: 202 })
      }),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-deploy')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete snapshot/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Snapshot deleted'))
  })

  // US-VMSNAP — revert snapshot
  it('reverts VM snapshot and shows success toast', async () => {
    let reverted = false
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'before-deploy', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      ])),
      http.post('*/v1/tenant/vms/vm-1/snapshots/snap-1/revert', () => {
        reverted = true
        return HttpResponse.json(null, { status: 202 })
      }),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-deploy')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /revert/i }))
    await waitFor(() => expect(reverted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Revert started'))
  })

})
