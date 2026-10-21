import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VmCreateModal } from './VmCreateModal'

const activeNetwork = { id: 'n1', name: 'default', currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, cidr: null, gateway: null, zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' }
const zone = { id: 'z1', name: 'Zone 1' }
const template = { id: 't1', name: 'Ubuntu 22.04', os: 'Ubuntu' }
const offering = { id: 'm', name: 'Medium', cpu: 1, vcpu: 2, memoryMb: 4096, pricePerHour: 311.256 }
const zoneTwoNetwork = { ...activeNetwork, id: 'n2', name: 'far-away', zoneId: 'z2' }

// The form refuses to send until zone, network, template and size are chosen; a test about what the server answers
// picks whatever it did not pick itself: the first option of each choice still empty.
async function chooseTheRest() {
  for (const name of ['Network', 'Template', 'Size']) {
    const select = await screen.findByRole('combobox', { name }) as HTMLSelectElement
    if (select.value === '') {
      const first = select.querySelectorAll('option')[1]
      await userEvent.selectOptions(select, first.getAttribute('value')!)
    }
  }
}

describe('VmCreateModal', () => {
  beforeEach(() => {
    server.use(http.get('*/v1/vm-offerings', () => HttpResponse.json([offering])))
  })

  it('shows validation error when name is empty', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])))
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    expect(screen.getByText('Name is required')).toBeInTheDocument()
  })

  it('speaks Vietnamese: title, fields, buttons and the validation error', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])))
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })
    expect(screen.getByRole('heading', { name: 'Tạo máy ảo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tạo VM' }))
    expect(screen.getByText('Vui lòng nhập tên')).toBeInTheDocument()
  })

  // A request without zone, template or size is a 400 the form showed as "Something went wrong".
  it('asks for every choice and sends nothing while one is missing', async () => {
    let posted = false
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.post('*/v1/tenant/vms', () => {
        posted = true
        return HttpResponse.json({ vmId: 'vm-1' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(screen.getByText('Choose a zone, network, template and size.')).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('shows validation error when name exceeds 64 chars', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])))
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'a'.repeat(65))
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    expect(screen.getByText('Name must be 64 characters or less')).toBeInTheDocument()
  })

  it('shows "no active networks" when network list is empty', async () => {
    server.use(http.get('*/v1/tenant/networks', () => HttpResponse.json([])))
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/no active networks/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /create vm/i })).toBeDisabled()
  })

  it('calls POST API with correct body on submit', async () => {
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    const onOpenChange = vi.fn()
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    // The zone comes first: the network and template lists only open once a zone is chosen.
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')

    // Template option label pulls the `os` field from the API DTO — regression guard
    // against the `osTypeName` mismatch that rendered "<name> — undefined".
    expect(await screen.findByRole('option', { name: 'Ubuntu 22.04 — Ubuntu' })).toBeInTheDocument()

    const selects = screen.getAllByRole('combobox')
    for (const s of selects) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')

    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect((requestBody as { name: string }).name).toBe('my-vm')
    expect((requestBody as { zoneId: string; networkId: string }).zoneId).toBe('z1')
    expect((requestBody as { zoneId: string; networkId: string }).networkId).toBe('n1')
    expect((requestBody as { templateId: string }).templateId).toBe('t1')
  })

  // docs/features/vm/design.md#ssh-key — picked keys travel as sshKeyIds; with none saved the form points to the
  // SSH keys page instead.
  const laptopKey = { id: 'k1', name: 'laptop', type: 'ssh-ed25519', fingerprint: 'SHA256:iruZOXrf', createdAt: '2026-10-13T00:00:00Z' }
  const desktopKey = { id: 'k2', name: 'desktop', type: 'ssh-rsa', fingerprint: 'SHA256:k7BYeTgd', createdAt: '2026-10-13T00:00:00Z' }

  it('sends the picked SSH keys with the create', async () => {
    let requestBody: { sshKeyIds?: string[] } = {}
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey, desktopKey])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json() as { sshKeyIds?: string[] }
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    const onOpenChange = vi.fn()
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')
    await screen.findByRole('option', { name: 'Ubuntu 22.04 — Ubuntu' })
    for (const s of screen.getAllByRole('combobox')) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')

    await userEvent.click(await screen.findByRole('checkbox', { name: /desktop/ }))
    expect(screen.getByText('Picked keys are added for the user ubuntu.')).toBeInTheDocument()
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(requestBody.sshKeyIds).toEqual(['k2'])
  })

  it('points to the SSH keys page when none is saved, in Vietnamese too', async () => {
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })

    const link = await screen.findByRole('link', { name: 'Thêm một key' })
    expect(link.getAttribute('href')).toBe('/ssh-keys')
    expect(screen.getByText('SSH key')).toBeInTheDocument()
  })

  it('says so when a picked key was deleted meanwhile', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 404, title: 'SSH key not found.', code: 'SSH_KEY_NOT_FOUND' }, { status: 404 })),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')
    await screen.findByRole('option', { name: 'Ubuntu 22.04 — Ubuntu' })
    for (const s of screen.getAllByRole('combobox')) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(await screen.findByText('A picked SSH key no longer exists — pick again')).toBeInTheDocument()
  })

  // docs/features/catalog/design.md#template-per-zone — each zone's cluster holds its own copy of a template; the
  // form offers only the ones synced in the zone picked.
  const zoneTwo = { id: 'z2', name: 'Zone 2' }
  const debian = { id: 't2', name: 'Debian 12', os: 'Debian' }
  const templatesByZone = http.get('*/v1/templates', ({ request }) => {
    const zoneId = new URL(request.url).searchParams.get('zoneId')
    if (zoneId === 'z1') {
      return HttpResponse.json([template])
    }
    if (zoneId === 'z2') {
      return HttpResponse.json([debian])
    }
    return HttpResponse.json([template, debian])
  })

  it('lists only the templates synced in the picked zone', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, zoneTwoNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone, zoneTwo])),
      templatesByZone,
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

    await waitFor(() => expect(screen.getAllByText(/select a zone first/i)).toHaveLength(2)) // network + template
    const zoneSelect = await screen.findByRole('combobox', { name: 'Zone' })

    await userEvent.selectOptions(zoneSelect, 'z1')
    expect(await screen.findByRole('option', { name: 'Ubuntu 22.04 — Ubuntu' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Debian 12 — Debian' })).not.toBeInTheDocument()

    await userEvent.selectOptions(zoneSelect, 'z2')
    expect(await screen.findByRole('option', { name: 'Debian 12 — Debian' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Ubuntu 22.04 — Ubuntu' })).not.toBeInTheDocument()
  })

  it('drops the chosen template when the new zone does not offer it', async () => {
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, zoneTwoNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone, zoneTwo])),
      templatesByZone,
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    const zoneSelect = await screen.findByRole('combobox', { name: 'Zone' })
    await userEvent.selectOptions(zoneSelect, 'z1')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Template' }), 't1')

    await userEvent.selectOptions(zoneSelect, 'z2')
    await screen.findByRole('option', { name: 'Debian 12 — Debian' })

    // Network and size chosen, template not: a template still chosen from z1 would let the form send. The select
    // alone would read '' either way (a value outside the options).
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'n2')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Size' }), 'm')
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    expect(await screen.findByText('Choose a zone, network, template and size.')).toBeInTheDocument()
    expect(requestBody).toBeUndefined()
  })

  it('keeps the chosen template when the new zone offers it too', async () => {
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, zoneTwoNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone, zoneTwo])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    const zoneSelect = await screen.findByRole('combobox', { name: 'Zone' })
    await userEvent.selectOptions(zoneSelect, 'z1')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Template' }), 't1')

    await userEvent.selectOptions(zoneSelect, 'z2')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Template' })).toHaveValue('t1'))

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(requestBody).toBeDefined())
    expect((requestBody as { templateId: string }).templateId).toBe('t1')
  })

  it('asks for another template on 422 TEMPLATE_NOT_SYNCED', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () => HttpResponse.json({ status: 422, title: 'x', code: 'TEMPLATE_NOT_SYNCED' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(await screen.findByText(/not available in this zone yet/i)).toBeInTheDocument()
  })

  // docs/features/catalog/design.md#zone-is-a-real-choice — a VM lands on its network's cluster, so the form
  // offers only the networks of the zone the customer picked.
  it('opens the network list only after a zone is picked, and lists only that zone’s networks', async () => {
    const otherZoneNetwork = { ...activeNetwork, id: 'n2', name: 'far-away', zoneId: 'z2' }
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, otherZoneNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone, { id: 'z2', name: 'Zone 2' }])),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText(/select a zone first/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Network' })).not.toBeInTheDocument()

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')

    const network = screen.getByRole('combobox', { name: 'Network' })
    expect(Array.from(network.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Select a network', 'default'])
  })

  // Same rule as Network.BeginVmDeployment: Incus reports it Created and nothing waits on it. A network whose delete
  // waits still reads Created on Incus.
  it('lists only the networks a VM can be created on', async () => {
    const usable = (id: string, name: string, extra = {}) => ({ ...activeNetwork, id, name, ...extra })
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([
        activeNetwork,
        usable('n2', 'leaving', { desiredExistence: 'Deleted', transition: 'Deleting' }),
        usable('n3', 'being-made', { currentState: null, currentExistence: 'NotCreated', transition: 'Creating' }),
        usable('n4', 'errored', { currentState: 'Errored' }),
        usable('n5', 'pending', { currentState: 'Pending' }),
        usable('n6', 'gone', { currentState: null, currentExistence: 'NotFound' }),
      ])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')

    const network = screen.getByRole('combobox', { name: 'Network' })
    expect(Array.from(network.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Select a network', 'default'])
  })

  it('drops the chosen network when the zone changes to one it is not in', async () => {
    const otherZoneNetwork = { ...activeNetwork, id: 'n2', name: 'far-away', zoneId: 'z2' }
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, otherZoneNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone, { id: 'z2', name: 'Zone 2' }])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    const zoneSelect = await screen.findByRole('combobox', { name: 'Zone' })
    await userEvent.selectOptions(zoneSelect, 'z1')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'n1')

    await userEvent.selectOptions(zoneSelect, 'z2')

    const network = screen.getByRole('combobox', { name: 'Network' })
    expect(Array.from(network.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Select a network', 'far-away'])
    // Template and size chosen, network not: z1's network still chosen would let the form send. The select alone
    // would read '' either way (its value is not among the options).
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Template' }), 't1')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Size' }), 'm')
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    expect(await screen.findByText('Choose a zone, network, template and size.')).toBeInTheDocument()
    expect(requestBody).toBeUndefined()
  })

  it('says the zone has no networks when the picked zone has none', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone, { id: 'z2', name: 'Zone 2' }])),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z2')

    expect(screen.getByText(/no active networks in this zone/i)).toBeInTheDocument()
  })

  it('asks for another zone on 404 ZONE_NOT_FOUND', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () => HttpResponse.json({ status: 404, title: 'x', code: 'ZONE_NOT_FOUND' }, { status: 404 })),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Zone' }), 'z1')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'n1')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(await screen.findByText(/selected zone is no longer available/i)).toBeInTheDocument()
  })

  it('shows quota exceeded error from API', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 422, title: 'Quota exceeded', code: 'VM_QUOTA_EXCEEDED' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    const selects = screen.getAllByRole('combobox')
    for (const s of selects) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByText('VM quota exceeded')).toBeInTheDocument())
  })

  // S3 — suspended tenant gets a clear message in the VM modal too (parity with the network
  // modal, which already handled it; the VM modal previously fell through to generic).
  it('shows a clear suspended message on 403 TENANT_SUSPENDED — S3', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 403, title: 'Suspended', code: 'TENANT_SUSPENDED' }, { status: 403 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    const selects = screen.getAllByRole('combobox')
    for (const s of selects) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByText(/account is suspended/i)).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  // A template that went into Error after it synced is hidden from the list, but a modal opened before
  // that still offers it; retrying the same template never succeeds, so the message names the fix.
  it('asks for another template on 422 TEMPLATE_UNAVAILABLE', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 422, title: 'Unavailable', code: 'TEMPLATE_UNAVAILABLE' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    const selects = screen.getAllByRole('combobox')
    for (const s of selects) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByText('Selected template is not available right now — pick another')).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  // S3 — a tenant awaiting admin approval (US-SL-02 signup gate) gets a clear message,
  // not the misleading "Please try again" (retry never succeeds while pending).
  it('shows a clear pending-approval message on 403 TENANT_PENDING_APPROVAL — S3', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 403, title: 'Pending approval', code: 'TENANT_PENDING_APPROVAL' }, { status: 403 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    const selects = screen.getAllByRole('combobox')
    for (const s of selects) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByText(/awaiting admin approval/i)).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })
})
