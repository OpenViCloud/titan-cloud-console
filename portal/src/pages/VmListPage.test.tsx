import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MemoryRouter } from 'react-router-dom'
import { VmListPage } from './VmListPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

import { toast } from 'sonner'

// currentState is the Incus status word for word, null while Incus has no instance; existence and a
// refused create are fields of their own (lib/vmState.ts).
const st = (currentState: string | null, desiredState: string = currentState ?? 'Running', transition: string | null = null) =>
  ({
    currentState, desiredState, transition,
    currentExistence: currentState === null ? 'NotCreated' : 'Exists',
    desiredExistence: 'Exists',
    requestFailureReason: null as string | null,
    requestFailedAt: null as string | null,
  })
const deleting = (currentState: string) => ({ ...st(currentState, 'Running', 'Deleting'), desiredExistence: 'Deleted' })

const vm = (overrides = {}) => ({
  id: 'vm-1', name: 'web-01', ...st('Running'), ipAddress: '10.0.0.5',
  networkId: 'n1', vmOfferingId: 'so1', templateId: 't1',
  zoneId: 'z1', diskSizeGb: 50, createdAt: '2026-01-01T00:00:00Z',
  publicIpv6Address: null,
  ...overrides,
})

// The VM form sends only once zone, network, template and size are chosen, and network and template open after the
// zone: pick the first option of every choice, then again for the ones the zone opened.
async function chooseEveryFirstOption() {
  for (let pass = 0; pass < 2; pass++) {
    for (const select of screen.getAllByRole('combobox') as HTMLSelectElement[]) {
      const first = select.querySelectorAll('option')[1]
      if (select.value === '' && first !== undefined) {
        await userEvent.selectOptions(select, first.getAttribute('value')!)
      }
    }
  }
}

describe('VmListPage', () => {
  beforeEach(() => vi.clearAllMocks())
  it('shows empty state when no VMs', async () => {
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No virtual machines')).toBeInTheDocument())
  })

  it('shows the empty list in Vietnamese', async () => {
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('Chưa có máy ảo')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Máy ảo' })).toBeInTheDocument()
    expect(screen.getByText('Tạo VM đầu tiên để bắt đầu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo VM' })).toBeInTheDocument()
  })

  it('shows a VM row in Vietnamese, the status badge staying English', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('1 máy')).toBeInTheDocument()
    expect(screen.getByText('IPv4 riêng')).toBeInTheDocument()
    expect(screen.getByText('IPv6 công khai')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Quản lý' })).toHaveAttribute('href', expect.stringContaining('/vms/'))
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('shows VM row with name and status badge', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
  })

  it('shows dash for null IP', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm({ ipAddress: null })])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  // The server refuses a delete while the create waits and Incus has no instance yet (it may still instantiate), so the
  // button is held back like for every other waiting request (docs/features/vm/design.md#requests-follow-incus).
  it('holds Delete back while the create has no instance yet', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st(null, 'Running', 'Creating'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Creating')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  // Once Incus has the instance a VM that never comes up has a way out: Delete.
  it('offers Delete once the instance exists, even while the create still waits', async () => {
    server.use(http.get('*/v1/tenant/vms', () =>
      HttpResponse.json([vm({ ...st(null, 'Running', 'Creating'), currentExistence: 'Exists' })])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete/i })).toBeEnabled()
  })

  // Delete wins over a waiting stop or start (docs/features/vm/design.md#requests-follow-incus).
  it('offers Delete while a start waits', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Stopped', 'Running', 'Starting'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Starting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
  })

  // The list is a few seconds old: if the server still refuses, the toast says why.
  it('says a VM still being set up cannot be deleted yet', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () =>
        HttpResponse.json([vm({ ...st(null, 'Running', 'Creating'), currentExistence: 'Exists' })])),
      http.delete('*/v1/tenant/vms/vm-1', () => HttpResponse.json({ code: 'VM_INVALID_STATUS' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Cannot delete yet: the VM is still being set up. Try again in a minute.')
    )
  })

  // The reconciler did not find the instance: no status to show, so the badge says why, and Delete is the way out.
  it('shows a VM Incus did not find as Not found, with Delete and neither Stop nor Start', async () => {
    server.use(http.get('*/v1/tenant/vms', () =>
      HttpResponse.json([vm({ ...st(null, 'Running'), currentExistence: 'NotFound', ipAddress: null })])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument()
  })

  // A create the provider refused: the fixed reason is the tenant's to read, and Delete clears the row.
  it('shows a refused create as Failed with its reason, and offers Delete', async () => {
    server.use(http.get('*/v1/tenant/vms', () =>
      HttpResponse.json([vm({
        ...st(null, 'Running'), ipAddress: null,
        requestFailureReason: 'Public IPv6 is not available yet. Please create the VM without it.',
        requestFailedAt: '2026-10-10T08:00:00Z',
      })])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Public IPv6 is not available yet. Please create the VM without it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument()
  })

  it('shows confirmation dialog on delete click', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByText(/delete web-01/i)).toBeInTheDocument()
  })

  it('calls DELETE API and closes dialog on confirm', async () => {
    let deleted = false
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.delete('*/v1/tenant/vms/vm-1', () => { deleted = true; return HttpResponse.json(null, { status: 202 }) }),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  // AT-P11 — error state when API fails
  it('shows error banner and hides table when GET vms returns 500', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json(null, { status: 500 })))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/failed to load virtual machines/i)).toBeInTheDocument())
    expect(screen.queryByRole('list', { name: 'Virtual machines' })).not.toBeInTheDocument()
  })

  // AT-P20 — delete success toast
  it('shows success toast after VM deleted', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.delete('*/v1/tenant/vms/vm-1', () => HttpResponse.json(null, { status: 202 })),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Virtual machine deleted'))
  })

  // Delete refused while a load balancer sends to the VM (422 VM_IS_LOAD_BALANCER_BACKEND): the customer learns what
  // to change, not "try again".
  it('shows specific error toast when VM_IS_LOAD_BALANCER_BACKEND', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.delete('*/v1/tenant/vms/vm-1', () =>
        HttpResponse.json({ code: 'VM_IS_LOAD_BALANCER_BACKEND' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Cannot delete: a load balancer sends traffic to this VM — remove it from the load balancer first'))
  })

  // Delete blocked while a snapshot operation is in flight (422 VM_SNAPSHOT_IN_PROGRESS)
  it('shows specific error toast when VM_SNAPSHOT_IN_PROGRESS', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.delete('*/v1/tenant/vms/vm-1', () =>
        HttpResponse.json({ code: 'VM_SNAPSHOT_IN_PROGRESS' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Cannot delete: a snapshot operation is in progress for this VM')
    )
  })

  // AT-P22 — delete error toast (no inline banner)
  it('shows error toast when delete fails and no inline banner', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm()])),
      http.delete('*/v1/tenant/vms/vm-1', () => HttpResponse.json(null, { status: 500 })),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete VM. Please try again.'))
    expect(screen.queryByText(/failed to delete vm/i)).not.toBeInTheDocument()
  })

  // AT-P-IPv6-01-1 — shows IPv6 address in row
  it('shows publicIpv6Address when set', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm({ publicIpv6Address: '2001:db8::1' })])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('2001:db8::1')).toBeInTheDocument()
  })

  // AT-P-IPv6-01-2 — shows dash when IPv6 null
  it('shows dash for null publicIpv6Address', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm({ publicIpv6Address: null })])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  // Public IPv6 is asked for on the network (docs/features/network/design.md#ipv6-public): the VM form has no box for it
  it('the create VM form has no public IPv6 box and sends no enablePublicIpv6', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([{ id: 'n1', name: 'default', currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, cidr: null, gateway: null, publicIpv6Subnet: null, zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' }])),
      http.get('*/v1/zones', () => HttpResponse.json([{ id: 'z1', name: 'Zone 1' }])),
      http.get('*/v1/templates', () => HttpResponse.json([{ id: 't1', name: 'Ubuntu', os: 'Ubuntu' }])),
      http.get('*/v1/vm-offerings', () => HttpResponse.json([{ id: 'm', name: 'Medium', cpu: 1, vcpu: 2, memoryMb: 4096, pricePerHour: 311.256 }])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/e\.g\. web/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/public ipv6/i)).not.toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseEveryFirstOption()
    await userEvent.click(screen.getByRole('button', { name: /^create vm$/i }))
    await waitFor(() => expect(capturedBody.name).toBe('my-vm'))
    expect(capturedBody).not.toHaveProperty('enablePublicIpv6')
  })

  // AT-P15 — create success toast
  it('shows success toast after VM created', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([{ id: 'n1', name: 'default', currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, cidr: null, gateway: null, zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' }])),
      http.get('*/v1/zones', () => HttpResponse.json([{ id: 'z1', name: 'Zone 1' }])),
      http.get('*/v1/templates', () => HttpResponse.json([{ id: 't1', name: 'Ubuntu', os: 'Ubuntu' }])),
      http.get('*/v1/vm-offerings', () => HttpResponse.json([{ id: 'm', name: 'Medium', cpu: 1, vcpu: 2, memoryMb: 4096, pricePerHour: 311.256 }])),
      http.post('*/v1/tenant/vms', () => HttpResponse.json({ id: 'vm-new' }, { status: 202 })),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseEveryFirstOption()
    await userEvent.click(screen.getByRole('button', { name: /^create vm$/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Virtual machine created'))
  })

  // ── US-STOP-UI — stop/start actions ──────────────────────────────────────
  // UI-T1 — Stop shown for Running, Start hidden
  it('shows Stop button for Running VM and hides Start', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Running'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument()
  })

  // UI-T2 — Start shown for Stopped, Stop hidden
  it('shows Start button for Stopped VM and hides Stop', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Stopped'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument()
  })

  // Ready is a running guest that also told Incus it is ready: what Running asked for, so no drift, and Stop.
  it('shows a Ready VM as Ready with Stop, and not as drift', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Ready', 'Running'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText(/requested:/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument()
  })

  // Incus stops a frozen instance and `start` resumes it (docs/features/vm/design.md#requests-follow-incus): both are offered.
  it('shows a Frozen VM with Stop and Resume', async () => {
    let started = false
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Frozen', 'Running'))])),
      http.post('*/v1/tenant/vms/vm-1/start', () => { started = true; return HttpResponse.json(null, { status: 202 }) }),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Frozen')).toBeInTheDocument()
    expect(screen.getByText('requested: Running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    await waitFor(() => expect(started).toBe(true))
  })

  // Error: the qemu process is alive but Incus cannot drive it; stop and delete only.
  it('shows an Error VM with Stop and Delete, not Start', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Error', 'Running'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
  })

  // UI-T4 — Stop calls API; the pending affordance comes from the SERVER's `transition` (DESIRED-CURRENT-STATE),
  // not from the page remembering what it clicked. The handler flips what GET returns, as the CP does.
  it('calls POST /stop and shows Stopping pending once the server reports it', async () => {
    let stopped = false
    server.use(
      http.get('*/v1/tenant/vms', () =>
        HttpResponse.json([vm(stopped ? st('Running', 'Stopped', 'Stopping') : st('Running'))])),
      http.post('*/v1/tenant/vms/vm-1/stop', () => { stopped = true; return HttpResponse.json(null, { status: 202 }) }),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^stop$/i }))
    await waitFor(() => expect(stopped).toBe(true))
    await waitFor(() => expect(screen.getByRole('button', { name: /stopping/i })).toBeDisabled())
    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  // UI-T5 — Start calls API + pending affordance from the server
  it('calls POST /start and shows Starting pending once the server reports it', async () => {
    let started = false
    server.use(
      http.get('*/v1/tenant/vms', () =>
        HttpResponse.json([vm(started ? st('Stopped', 'Running', 'Starting') : st('Stopped'))])),
      http.post('*/v1/tenant/vms/vm-1/start', () => { started = true; return HttpResponse.json(null, { status: 202 }) }),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))
    await waitFor(() => expect(started).toBe(true))
    await waitFor(() => expect(screen.getByRole('button', { name: /starting/i })).toBeDisabled())
    expect(screen.getByText('Starting')).toBeInTheDocument()
  })

  // UI-T6 — pending clears once the reconciler observed the stop (transition gone, current Stopped)
  it('clears pending and shows Start once VM reaches Stopped', async () => {
    let state = st('Running')
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(state)])),
      http.post('*/v1/tenant/vms/vm-1/stop', () => { state = st('Stopped'); return HttpResponse.json(null, { status: 202 }) }),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^stop$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /stopping/i })).not.toBeInTheDocument()
  })

  // DCS-3 / DCS-12 — a VM stopped from inside its guest: the badge shows what it IS, marks it as not requested,
  // and offers Start (a new request, DCS-4) — not a "Starting…" that would wait forever.
  it('shows a VM stopped without being asked as Stopped, with what was requested, and Start offered', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Stopped', 'Running', null))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('requested: Running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^start$/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /starting/i })).not.toBeInTheDocument()
  })

  // A delete in flight: Deleting on the badge, and Delete not offered again.
  it('shows a waiting delete as Deleting and does not offer Delete again', async () => {
    server.use(http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(deleting('Running'))])))
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('Deleting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  // UI-T7 — VM_INVALID_STATUS surfaces toast, pending does not hang
  it('shows error toast when stop rejected with VM_INVALID_STATUS', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () => HttpResponse.json([vm(st('Running'))])),
      http.post('*/v1/tenant/vms/vm-1/stop', () => HttpResponse.json({ code: 'VM_INVALID_STATUS' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VmListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^stop$/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('VM is not in a valid state for this action'))
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument()
  })
})
