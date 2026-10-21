import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MemoryRouter } from 'react-router-dom'
import { NetworkListPage } from './NetworkListPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))
import { toast } from 'sonner'

// A network's or a rule's state (lib/networkState.ts): the Incus word, null while Incus holds nothing, and an
// existence of its own.
const st = (currentState: string | null, extra = {}) => ({
  currentState, currentExistence: currentState === null ? 'NotCreated' : 'Exists', desiredExistence: 'Exists',
  transition: null as string | null, requestFailureReason: null as string | null, requestFailedAt: null as string | null,
  ...extra,
})
const creating = () => st(null, { transition: 'Creating' })
const deleting = (currentState = 'Created') => st(currentState, { desiredExistence: 'Deleted', transition: 'Deleting' })
const failedCreate = () => st(null, { requestFailureReason: 'Network creation failed due to a system error. Please try again or contact support.' })
const notFound = () => st(null, { currentExistence: 'NotFound' })
const rule = (id: string, cidr: string, externalId: string | null, state: object) => ({
  id, direction: 'Ingress', protocol: 'TCP', startPort: 22, endPort: 22, cidr, externalId, ...state,
  createdAt: '2026-01-01T00:00:00Z',
})
// A VM's state (lib/vmState.ts): the Incus status, null while Incus has no instance, and an existence of its own.
const vmSt = (currentState: string | null, currentExistence = 'Exists') =>
  ({ currentState, desiredState: 'Running', transition: null, currentExistence, desiredExistence: 'Exists', requestFailureReason: null })

const net = (overrides = {}) => ({
  id: 'net-1', name: 'prod-net', ...st('Created'), cidr: '10.0.0.0/24',
  gateway: '10.0.0.1', publicIpv6Subnet: null as string | null, zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('NetworkListPage', () => {
  beforeEach(() => vi.clearAllMocks())
  it('shows empty state when no networks', async () => {
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No networks')).toBeInTheDocument())
  })

  it('shows only networks matching ?q from the top-bar search, and Clear shows all again', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net(), net({ id: 'n2', name: 'staging-net' })])))
    renderWithProviders(<MemoryRouter initialEntries={['/networks?q=PROD']}><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.queryByText('staging-net')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('staging-net')).toBeInTheDocument()
  })

  it('shows network row with name and status badge', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    const row = screen.getByText('prod-net').closest('li') as HTMLElement
    expect(within(row).getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument()
  })

  it('shows the public /64 of a network that has one, and nothing for one that has none', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([
      net({ publicIpv6Subnet: '2001:db8:0:1::/64' }),
      net({ id: 'n2', name: 'private-net', cidr: '10.1.0.0/24' }),
    ])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    const withIpv6 = screen.getByText('prod-net').closest('li') as HTMLElement
    expect(within(withIpv6).getByTitle('Public IPv6')).toHaveTextContent('2001:db8:0:1::/64')
    const without = screen.getByText('private-net').closest('li') as HTMLElement
    expect(within(without).queryByTitle('Public IPv6')).not.toBeInTheDocument()
  })

  it('shows dash for null CIDR and Gateway', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net({ cidr: null, gateway: null })])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('delete button disabled while the create waits', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net(creating())])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  // The delete follows Incus: whatever it reports, even not found, Incus answers; a failed create goes at once.
  it('shows the Incus word or why there is none, and offers Delete for each', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([
      net({ id: 'n-err', name: 'errored-net', ...st('Errored') }),
      net({ id: 'n-una', name: 'unavailable-net', ...st('Unavailable') }),
      net({ id: 'n-pen', name: 'pending-net', ...st('Pending') }),
      net({ id: 'n-gone', name: 'gone-net', ...notFound() }),
      net({ id: 'n-fail', name: 'failed-net', ...failedCreate() }),
    ])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('errored-net')).toBeInTheDocument())

    const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement
    const shown: Record<string, string> = {
      'errored-net': 'Errored', 'unavailable-net': 'Unavailable', 'pending-net': 'Pending',
      'gone-net': 'Not found', 'failed-net': 'Failed',
    }
    for (const [name, label] of Object.entries(shown)) {
      expect(within(rowOf(name)).getByText(label)).toBeInTheDocument()
      expect(within(rowOf(name)).getByRole('button', { name: /^delete$/i })).toBeEnabled()
    }
  })

  it('shows confirmation dialog on delete click', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByText(/delete prod-net/i)).toBeInTheDocument()
  })

  it('calls DELETE API on confirm', async () => {
    let deleted = false
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.delete('*/v1/tenant/networks/net-1', () => { deleted = true; return HttpResponse.json(null, { status: 202 }) }),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  // ── Rename (B-N02) ──────────────────────────────────────────────────────
  // WHY: rename is CP-only metadata, so the row must show the new name without a provider
  // round-trip. These pin the affordance the backend PATCH exists to serve.

  it('rename dialog prefills the current name', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /rename/i }))
    expect(screen.getByLabelText('Name')).toHaveValue('prod-net')
  })

  // AC-P1.4 — the case the old reset-in-effect existed for: a SECOND open, on a different row.
  // The first open is covered above; only this one distinguishes "field is initialised per network"
  // from "field is initialised once". A refactor that drops the effect without remounting the dialog
  // passes the test above and fails this one.
  it('rename dialog prefills the current name on a second, different network', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([
      net(), net({ id: 'net-2', name: 'staging-net' }),
    ])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())

    const renameButtons = screen.getAllByRole('button', { name: /rename/i })
    await userEvent.click(renameButtons[0])
    expect(screen.getByLabelText('Name')).toHaveValue('prod-net')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /rename/i })[1])
    expect(screen.getByLabelText('Name')).toHaveValue('staging-net')
  })

  it('calls PATCH with the new name and shows it in the row', async () => {
    let patched: { name?: string } | null = null
    server.use(
      http.get('*/v1/tenant/networks', () =>
        HttpResponse.json([net({ name: patched?.name ?? 'prod-net' })])),
      http.patch('*/v1/tenant/networks/net-1', async ({ request }) => {
        patched = (await request.json()) as { name: string }
        return new HttpResponse(null, { status: 204 }) // docs/architecture/http-contract.md#commands-return-no-data: the list is re-read
      }),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /rename/i }))
    const input = screen.getByLabelText('Name')
    await userEvent.clear(input)
    await userEvent.type(input, 'staging-net')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(patched?.name).toBe('staging-net'))
    // Cache invalidated → the row reflects the rename without a page reload.
    await waitFor(() => expect(screen.getByText('staging-net')).toBeInTheDocument())
  })

  it('save is disabled while the name is unchanged or empty', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /rename/i }))
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).toBeDisabled()                       // unchanged — no wasted round-trip
    await userEvent.clear(screen.getByLabelText('Name'))
    expect(save).toBeDisabled()                       // empty — validator would 400
  })

  it('surfaces NETWORK_NAME_TAKEN with an actionable message', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.patch('*/v1/tenant/networks/net-1', () =>
        HttpResponse.json({ status: 409, title: 'Conflict', code: 'NETWORK_NAME_TAKEN' }, { status: 409 })),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /rename/i }))
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'taken-net')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already exists/i)))
  })

  it('rename button disabled once the network is Deleting', async () => {
    // WHY: the backend rejects rename from Deleting/Deleted (NETWORK_INVALID_STATE) — the UI must
    // not offer an action the API will refuse.
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net(deleting())])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /rename/i })).toBeDisabled()
  })

  // A waiting delete reads Deleting (Incus still shows the network Created) and is not offered again.
  it('shows a waiting delete as Deleting and does not offer Delete again', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net(deleting())])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByText('Deleting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  // A delete Incus refused: the network is back as Incus reports it, and Delete is a new request.
  it('offers Delete again after a delete failed', async () => {
    const refused = st('Created', { requestFailureReason: 'Network deletion failed due to a system error. Please try again or contact support.' })
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net(refused)])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    const row = screen.getByText('prod-net').closest('li') as HTMLElement
    expect(within(row).getByText('Created')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
  })

  // AT-P29 — VM attachment check
  it('delete button disabled when a Running VM is attached to the network', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'vm-1', name: 'web-01', networkId: 'net-1', ...vmSt('Running'),
          ipAddress: '10.0.0.5', vmOfferingId: 'so-1', templateId: 't-1',
          zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' },
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    expect(deleteBtn).toBeDisabled()
    expect(deleteBtn.title).toBe('Remove all VMs first')
  })

  // Same rule as the server: a VM holds its network while Incus has its instance, whatever the status.
  it('delete button disabled when an Error VM is on the network: its qemu process still uses it', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'vm-2', name: 'err-vm', networkId: 'net-1', ...vmSt('Error'),
          ipAddress: null, vmOfferingId: 'so-1', templateId: 't-1',
          zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' },
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  it('delete button enabled when the VMs on the network have no instance (not found, create refused)', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'vm-1', name: 'lost-vm', networkId: 'net-1', ...vmSt(null, 'NotFound'),
          ipAddress: null, vmOfferingId: 'so-1', templateId: 't-1',
          zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'vm-2', name: 'refused-vm', networkId: 'net-1', ...vmSt(null, 'NotCreated'), requestFailureReason: 'refused',
          ipAddress: null, vmOfferingId: 'so-1', templateId: 't-1',
          zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' },
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
  })

  // AT-P11-N — error state when API fails
  it('shows error banner and hides table when GET networks returns 500', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json(null, { status: 500 })))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/failed to load networks/i)).toBeInTheDocument())
    expect(screen.queryByRole('list', { name: 'Networks' })).not.toBeInTheDocument()
  })

  // AT-P30 — delete success toast
  it('shows success toast after network deleted', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.delete('*/v1/tenant/networks/net-1', () => HttpResponse.json(null, { status: 202 })),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Network deleted'))
  })

  // The server refuses a network that still has a load balancer not yet Deleted (NETWORK_NOT_EMPTY); the button
  // follows the same rule as for a VM that holds it.
  it('holds Delete back while a load balancer of the network is not deleted', async () => {
    const lb = (id: string, networkId: string, currentExistence: string) => ({
      id, name: id, networkId, vip: null, currentExistence, desiredExistence: 'Exists', transition: null,
      requestFailureReason: null, listeners: [], backendVmIds: [], createdAt: '2026-01-01T00:00:00Z',
    })
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net(), net({ id: 'net-2', name: 'free-net' })])),
      http.get('*/v1/tenant/load-balancers', () => HttpResponse.json([lb('lb-1', 'net-1', 'Exists'), lb('lb-2', 'net-2', 'Deleted')])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())

    const held = screen.getByText('prod-net').closest('li') as HTMLElement
    await waitFor(() => expect(within(held).getByRole('button', { name: /delete/i })).toBeDisabled())
    const free = screen.getByText('free-net').closest('li') as HTMLElement
    expect(within(free).getByRole('button', { name: /delete/i })).toBeEnabled()
  })

  // AT-P31 — delete error toast: NETWORK_NOT_EMPTY
  it('shows specific error toast when NETWORK_NOT_EMPTY', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.delete('*/v1/tenant/networks/net-1', () =>
        HttpResponse.json({ code: 'NETWORK_NOT_EMPTY' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot delete: the network still has VMs or load balancers'))
    expect(screen.queryByText(/cannot delete/i)).not.toBeInTheDocument()
  })

  // AT-P31 — delete error toast: generic
  it('shows generic error toast on delete failure', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.delete('*/v1/tenant/networks/net-1', () => HttpResponse.json(null, { status: 500 })),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete network. Please try again.'))
    expect(screen.queryByText(/failed to delete network/i)).not.toBeInTheDocument()
  })

  // FAILURE-REASON-UI (docs/features/network/design.md): after a refused delete the badge goes back to the Incus word, so
  // the reason is the only thing on the row that says the delete did not happen.
  it('shows why a request on a network was refused, and not while another request waits', async () => {
    const refused = 'The network could not be deleted. Please try again or contact support.'
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([
      net({ ...st('Created', { requestFailureReason: refused }) }),
      net({ id: 'net-2', name: 'retrying-net', ...deleting(), requestFailureReason: refused }),
    ])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())

    const refusedRow = screen.getByText('prod-net').closest('li') as HTMLElement
    expect(within(refusedRow).getByText(refused)).toBeInTheDocument()
    const retryingRow = screen.getByText('retrying-net').closest('li') as HTMLElement
    expect(within(retryingRow).queryByText(refused)).not.toBeInTheDocument()
  })

  it('shows why a request on a firewall rule was refused', async () => {
    const refused = 'The firewall rule could not be deleted. Please try again or contact support.'
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([
        rule('rule-1', '10.1.0.0/16', 'acl/rule-1', st('enabled', { requestFailureReason: refused })),
        rule('rule-2', '10.2.0.0/16', 'acl/rule-2', { ...deleting('enabled'), requestFailureReason: refused }),
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByText('10.1.0.0/16')).toBeInTheDocument())

    const row = (cidr: string) => screen.getByText(cidr).closest('[data-testid="firewall-rule-row"]') as HTMLElement
    expect(within(row('10.1.0.0/16')).getByText(refused)).toBeInTheDocument()
    expect(within(row('10.2.0.0/16')).queryByText(refused)).not.toBeInTheDocument()
  })

  // One port typed, End Port left empty: the rule is that one port, not a null the server refuses.
  it('sends a single port as start and end when End Port is left empty', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([])),
      http.post('*/v1/tenant/networks/net-1/firewall-rules', async ({ request }) => {
        body = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ruleId: 'r-1' }, { status: 201 })
      }),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add Rule' }))
    await userEvent.type(screen.getByPlaceholderText(/0\.0\.0\.0\/0/), '10.0.0.0/8')
    await userEvent.type(screen.getByLabelText('Start Port'), '22')
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body!.startPort).toBe(22)
    expect(body!.endPort).toBe(22)
  })

  it('asks for Start Port on a TCP rule and sends nothing without it', async () => {
    let posted = false
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([])),
      http.post('*/v1/tenant/networks/net-1/firewall-rules', () => {
        posted = true
        return HttpResponse.json({ ruleId: 'r-1' }, { status: 201 })
      }),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add Rule' }))
    await userEvent.type(screen.getByPlaceholderText(/0\.0\.0\.0\/0/), '10.0.0.0/8')
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByText('Start Port is required for TCP and UDP.')).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('says the rule quota is reached on FIREWALL_QUOTA_EXCEEDED', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([])),
      http.post('*/v1/tenant/networks/net-1/firewall-rules', () =>
        HttpResponse.json({ status: 422, title: 'x', code: 'FIREWALL_QUOTA_EXCEEDED' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add Rule' }))
    await userEvent.type(screen.getByPlaceholderText(/0\.0\.0\.0\/0/), '10.0.0.0/8')
    await userEvent.type(screen.getByLabelText('Start Port'), '22')
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByText('This network has reached its firewall rule limit.')).toBeInTheDocument()
  })

  // Firewall — panel expands
  it('expands firewall panel when Firewall button clicked', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([
        { id: 'rule-1', direction: 'Ingress', protocol: 'TCP', startPort: 80, endPort: 80, cidr: '0.0.0.0/0', externalId: 'ext-r1', ...st('enabled'), createdAt: '2026-01-01T00:00:00Z' },
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByText('0.0.0.0/0')).toBeInTheDocument())
    expect(screen.getAllByText('Ingress').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('TCP')).toBeInTheDocument()
  })

  // Firewall — empty state
  it('shows empty firewall state when no rules', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByText(/no firewall rules/i)).toBeInTheDocument())
  })

  // Firewall — create rule
  it('creates firewall rule and shows success toast', async () => {
    let posted = false
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([])),
      http.post('*/v1/tenant/networks/net-1/firewall-rules', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>
        if (body.cidr === '10.0.0.0/8') posted = true
        return HttpResponse.json({ id: 'rule-new', direction: 'Ingress', protocol: 'TCP', startPort: 443, endPort: 443, cidr: '10.0.0.0/8', externalRuleId: null, createdAt: '2026-01-01T00:00:00Z' }, { status: 201 })
      }),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /add rule/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/e\.g\. 0\.0\.0\.0\/0/i)).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. 0\.0\.0\.0\/0/i), '10.0.0.0/8')
    // TCP needs a port: the server's validator refuses a TCP rule without StartPort.
    await userEvent.type(screen.getByLabelText('Start Port'), '443')
    await userEvent.click(screen.getByRole('button', { name: /^add rule$/i }))
    await waitFor(() => expect(posted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Firewall rule created'))
  })

  // Firewall — delete rule
  it('deletes firewall rule and shows success toast', async () => {
    let deleted = false
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([
        { id: 'rule-1', direction: 'Egress', protocol: 'All', startPort: null, endPort: null, cidr: '0.0.0.0/0', externalId: 'ext-r1', ...st('enabled'), createdAt: '2026-01-01T00:00:00Z' },
      ])),
      http.delete('*/v1/tenant/networks/net-1/firewall-rules/rule-1', () => {
        deleted = true
        return HttpResponse.json(null, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByText('0.0.0.0/0')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete rule/i }))
    await waitFor(() => expect(deleted).toBe(true))
    // docs/architecture/desired-and-current.md#forget-on-provider-confirm: the rule is removed when the provider confirms, not when the button is pressed.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rule deletion requested'))
  })

  // A rule shows the Incus ACL rule state as Incus spells it, or why Incus has none.
  it('shows the status of each firewall rule', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([
        rule('rule-1', '10.1.0.0/16', null, creating()),
        rule('rule-2', '10.2.0.0/16', null, st(null, { requestFailureReason: 'Firewall rule creation failed due to a system error. Please try again or contact support.' })),
        rule('rule-3', '10.3.0.0/16', 'acl/rule-3', deleting('enabled')),
        rule('rule-4', '10.4.0.0/16', 'acl/rule-4', st('disabled')),
        rule('rule-5', '10.5.0.0/16', 'acl/rule-5', st('logged')),
        rule('rule-6', '10.6.0.0/16', 'acl/rule-6', notFound()),
        rule('rule-7', '10.7.0.0/16', 'acl/rule-7', st('enabled')),
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByText('10.1.0.0/16')).toBeInTheDocument())

    const row = (cidr: string) => screen.getByText(cidr).closest('[data-testid="firewall-rule-row"]') as HTMLElement
    expect(within(row('10.1.0.0/16')).getByText('Creating')).toBeInTheDocument()
    expect(within(row('10.2.0.0/16')).getByText('Failed')).toBeInTheDocument()
    expect(within(row('10.3.0.0/16')).getByText('Deleting')).toBeInTheDocument()
    expect(within(row('10.4.0.0/16')).getByText('disabled')).toBeInTheDocument()
    expect(within(row('10.5.0.0/16')).getByText('logged')).toBeInTheDocument()
    expect(within(row('10.6.0.0/16')).getByText('Not found')).toBeInTheDocument()
    expect(within(row('10.7.0.0/16')).getByText('enabled')).toBeInTheDocument()
  })

  // Whatever Incus reports, even not found, a rule can be deleted; a failed create goes at once. While its create or
  // its delete waits there is nothing a second press could do.
  it('lets a firewall rule be deleted unless a request waits on it', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/networks/net-1/firewall-rules', () => HttpResponse.json([
        rule('rule-1', '10.1.0.0/16', null, creating()),
        rule('rule-2', '10.2.0.0/16', null, st(null, { requestFailureReason: 'Firewall rule creation failed due to a system error. Please try again or contact support.' })),
        rule('rule-3', '10.3.0.0/16', 'acl/rule-3', deleting('enabled')),
        rule('rule-4', '10.4.0.0/16', 'acl/rule-4', st('enabled')),
        rule('rule-5', '10.5.0.0/16', 'acl/rule-5', st('disabled')),
        rule('rule-6', '10.6.0.0/16', 'acl/rule-6', notFound()),
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /firewall/i }))
    await waitFor(() => expect(screen.getByText('10.1.0.0/16')).toBeInTheDocument())

    const deleteIn = (cidr: string) => {
      const row = screen.getByText(cidr).closest('[data-testid="firewall-rule-row"]') as HTMLElement
      return within(row).getByRole('button', { name: /delete rule/i })
    }
    expect(deleteIn('10.1.0.0/16')).toBeDisabled()
    expect(deleteIn('10.2.0.0/16')).toBeEnabled()
    expect(deleteIn('10.3.0.0/16')).toBeDisabled()
    expect(deleteIn('10.4.0.0/16')).toBeEnabled()
    expect(deleteIn('10.5.0.0/16')).toBeEnabled()
    expect(deleteIn('10.6.0.0/16')).toBeEnabled()
  })

  it('delete button enabled when VMs belong to a different network', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'vm-3', name: 'other-vm', networkId: 'net-2', ...vmSt('Running'),
          ipAddress: '10.0.1.5', vmOfferingId: 'so-1', templateId: 't-1',
          zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' },
      ])),
    )
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
  })

  it('shows the list in Vietnamese, with the date in Vietnamese format', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([net({ createdAt: '2026-01-05T12:00:00Z' })])))
    renderWithProviders(<MemoryRouter><NetworkListPage /></MemoryRouter>, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Mạng' })).toBeInTheDocument()
    expect(screen.getByText('1 mạng')).toBeInTheDocument()
    expect(screen.getByText(/tạo ngày 05\/01\/2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo mạng' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đổi tên' })).toBeInTheDocument()
    // The state badge stays the Incus word in both languages.
    expect(screen.getByText('Created')).toBeInTheDocument()
  })
})
