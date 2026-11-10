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

const st = (status: string) =>
  ({
    status,
    requestFailureReason: null as string | null,
    requestFailedAt: null as string | null,
  })

const vm = (overrides = {}) => ({
  id: 'vm-1', name: 'web-01', ...st('Running'), ipAddress: '10.0.0.5',
  networkId: 'n1', vmOfferingId: 'm', templateId: 't1',
  clusterId: 'z1', diskSizeGb: 50, createdAt: '2026-01-01T00:00:00Z',
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
      http.get('*/v1/vm-offerings', () => HttpResponse.json([{ id: 'm', name: 'Medium', vcpu: 2, memoryMb: 4096 }])),
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
        { id: 'snap-1', name: 'before-deploy', status: 'Available', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      ])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-deploy')).toBeInTheDocument())
    expect(screen.getByText('Available')).toBeInTheDocument()
  })

  // The badge shows the waiting request from the server's status, and a snapshot with a request waiting offers
  // neither Revert nor Delete (a second press adds nothing).
  it('shows a waiting revert or delete from the status and hides the snapshot actions', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'reverting-snap', status: 'Reverting', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
        { id: 'snap-2', name: 'deleting-snap', status: 'Deleting', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
        { id: 'snap-3', name: 'resting-snap', status: 'Available', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
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

  // A request that gave up (create, revert or delete) leaves the snapshot as Incus holds it; the line says why, as the
  // server sent it.
  it('shows why the last request of a snapshot gave up, and nothing while a request waits', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'gave-up-snap', status: 'Available',
          requestFailureReason: 'VM snapshot revert failed due to a system error.', requestFailedAt: '2026-01-03T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' },
        { id: 'snap-2', name: 'waiting-snap', status: 'Reverting',
          requestFailureReason: 'An older reason.', requestFailedAt: '2026-01-03T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' },
      ])),
    )
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('gave-up-snap')).toBeInTheDocument())
    expect(screen.getByText('VM snapshot revert failed due to a system error.')).toBeInTheDocument()
    expect(screen.queryByText('An older reason.')).not.toBeInTheDocument()
  })

  // Delete follows Incus: a snapshot Incus no longer has, or whose create failed before Incus had it, is deletable,
  // never revertible.
  it.each([
    ['Not found', { status: 'NotFound' }],
    ['Failed', { status: 'Failed', requestFailureReason: 'Snapshot creation failed.' }],
  ])('shows a %s snapshot and offers Delete but not Revert', async (label, overrides) => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/snapshots', () => HttpResponse.json([
        { id: 'snap-1', name: 'lost-snap',
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
  // Incus snapshots Running, Ready, Stopped and Frozen instances (titan-ops features/vm/design.md#requests-follow-incus);
  // not Error, not while a start, a stop or another snapshot waits.
  it.each([['Frozen', true], ['Stopped', true], ['Starting', false], ['Error', false], ['Stopping', false], ['Snapshotting', false]])('offers New Snapshot on a %s VM: %s', async (status, offered) => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st(status))])),
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
        { id: 'snap-1', name: 'before-deploy', status: 'Available', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
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
        { id: 'snap-1', name: 'before-deploy', status: 'Available', requestFailureReason: null, requestFailedAt: null, createdAt: '2026-01-02T00:00:00Z' },
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

  // titan-ops features/vm/design.md#vm-metrics — the Monitoring tab reads GET /v1/tenant/vms/{vmId}/metrics.
  const metricPoint = (overrides = {}) => ({
    at: '2026-11-10T14:01:00Z',
    cpuPercent: 3.2,
    memoryUsedBytes: 278491136,
    memoryTotalBytes: 2059284480,
    rootFsUsedBytes: 2018664448,
    rootFsSizeBytes: 10222313472,
    diskReadBytesPerSecond: 0,
    diskWriteBytesPerSecond: 40960,
    ...overrides,
  })

  async function openMonitoring() {
    renderAt('/vms/vm-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'web-01' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: 'Monitoring' }))
  }

  // UI-1: the card headers carry the latest number of each field, as the API sent it.
  it('shows the latest CPU, memory and disk numbers in the Monitoring tab', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/metrics', () => HttpResponse.json({
        range: '1h', stepSeconds: 60,
        points: [
          // The first sample has no earlier one: no CPU or rates yet.
          metricPoint({ at: '2026-11-10T14:00:00Z', cpuPercent: null, memoryUsedBytes: 104857600,
            rootFsUsedBytes: 1073741824, diskReadBytesPerSecond: null, diskWriteBytesPerSecond: null }),
          metricPoint(),
        ],
      })),
    )
    await openMonitoring()
    const cpu = await screen.findByRole('region', { name: 'CPU' })
    await waitFor(() => expect(within(cpu).getByText('3.2%')).toBeInTheDocument())
    expect(within(cpu).getByLabelText('CPU usage over time')).toBeInTheDocument()
    const memory = screen.getByRole('region', { name: 'Memory' })
    expect(within(memory).getByText('265.6 MiB of 1.9 GiB')).toBeInTheDocument()
    // The control for the guest-agent case: here the memory chart is drawn.
    expect(within(memory).getByLabelText('Memory used over time')).toBeInTheDocument()
    const disk = screen.getByRole('region', { name: 'Disk' })
    expect(within(disk).getByText('1.9 GiB of 9.5 GiB')).toBeInTheDocument()
    expect(within(disk).getByText('Read 0 B/s · Write 40 KiB/s')).toBeInTheDocument()
    expect(screen.queryByText('Needs the guest agent inside the VM.')).not.toBeInTheDocument()
  })

  // UI-2: without the guest agent Incus has no memory or filesystem numbers; CPU still comes from QEMU.
  it('says the guest agent is needed where memory and disk are null, and still shows CPU', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/metrics', () => HttpResponse.json({
        range: '1h', stepSeconds: 60,
        points: [
          metricPoint({ at: '2026-11-10T14:00:00Z', cpuPercent: 8, memoryUsedBytes: null, memoryTotalBytes: null,
            rootFsUsedBytes: null, rootFsSizeBytes: null }),
          metricPoint({ cpuPercent: 12.5, memoryUsedBytes: null, memoryTotalBytes: null,
            rootFsUsedBytes: null, rootFsSizeBytes: null }),
        ],
      })),
    )
    await openMonitoring()
    const cpu = await screen.findByRole('region', { name: 'CPU' })
    await waitFor(() => expect(within(cpu).getByText('12.5%')).toBeInTheDocument())
    const memory = screen.getByRole('region', { name: 'Memory' })
    expect(within(memory).getByText('Needs the guest agent inside the VM.')).toBeInTheDocument()
    // No memory chart drawn as zero.
    expect(within(memory).queryByLabelText('Memory used over time')).not.toBeInTheDocument()
    const disk = screen.getByRole('region', { name: 'Disk' })
    expect(within(disk).getByText('Needs the guest agent inside the VM.')).toBeInTheDocument()
    expect(within(cpu).queryByText('Needs the guest agent inside the VM.')).not.toBeInTheDocument()
  })

  // UI-3: the range buttons ask the API again with the range picked.
  it('asks for 1h first and for 24h after pressing 24h', async () => {
    const ranges: (string | null)[] = []
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/metrics', ({ request }) => {
        const range = new URL(request.url).searchParams.get('range')
        ranges.push(range)
        return HttpResponse.json({ range, stepSeconds: range === '24h' ? 300 : 60, points: [metricPoint()] })
      }),
    )
    await openMonitoring()
    await waitFor(() => expect(ranges).toEqual(['1h']))
    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: '24h' }))
    await waitFor(() => expect(ranges).toContain('24h'))
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'false')
  })

  // UI-4
  it('says no data yet when the VM has no usage points', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/metrics', () => HttpResponse.json({ range: '1h', stepSeconds: 60, points: [] })),
    )
    await openMonitoring()
    await waitFor(() => expect(
      screen.getByText('No data yet. Usage appears a few minutes after the VM starts.')).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'CPU' })).not.toBeInTheDocument()
  })

  it('shows a banner when the usage cannot be loaded', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/metrics', () => HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 })),
    )
    await openMonitoring()
    await waitFor(() => expect(
      screen.getByText('Failed to load usage. Please refresh the page.')).toBeInTheDocument())
  })

  it('shows the Monitoring tab in Vietnamese, numbers with a decimal comma', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenant/vms/vm-1/metrics', () => HttpResponse.json({ range: '1h', stepSeconds: 60, points: [metricPoint()] })),
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
    await userEvent.click(screen.getByRole('tab', { name: 'Giám sát' }))
    const cpu = await screen.findByRole('region', { name: 'CPU' })
    await waitFor(() => expect(within(cpu).getByText('3,2%')).toBeInTheDocument())
    const memory = screen.getByRole('region', { name: 'Bộ nhớ' })
    expect(within(memory).getByText('265,6 MiB trên 1,9 GiB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '24 giờ' })).toHaveAttribute('aria-pressed', 'false')
  })
})
