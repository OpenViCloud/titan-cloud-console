import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { LoadBalancerFormModal } from './LoadBalancerFormModal'
import type { LoadBalancer } from '@/hooks/useLoadBalancers'

// A network the way GET /v1/tenant/networks sends it; usable = Incus reports it Created, nothing waits.
const net = (id: string, name: string, extra = {}) => ({
  id, name, currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null,
  requestFailureReason: null, requestFailedAt: null, cidr: '10.0.0.0/24', gateway: '10.0.0.1',
  publicIpv6Subnet: '2001:db8:0:d401::/64' as string | null, zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z', ...extra,
})
const vm = (id: string, name: string, networkId: string, extra = {}) => ({
  id, name, networkId, currentState: 'Running', desiredState: 'Running', currentExistence: 'Exists',
  desiredExistence: 'Exists', transition: null, requestFailureReason: null, zoneId: 'z1', ...extra,
})

function serve(networks: object[], vms: object[]) {
  server.use(
    http.get('*/v1/tenant/networks', () => HttpResponse.json(networks)),
    http.get('*/v1/tenant/vms', () => HttpResponse.json(vms)),
  )
}

const lb = (extra: Partial<LoadBalancer> = {}): LoadBalancer => ({
  id: 'lb-1', name: 'web-lb', networkId: 'net-6', zoneId: 'z1', vip: '2001:db8:0:d401::1:1',
  listeners: [{ protocol: 'TCP', port: 80, targetPort: 8080 }], backends: [{ vmId: 'vm-a' }],
  currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null,
  requestFailedAt: null, createdAt: '2026-01-01T00:00:00Z', ...extra,
})

describe('LoadBalancerFormModal — create', () => {
  it('offers only networks with public IPv6 that are usable', async () => {
    serve([
      net('net-6', 'six'),
      net('net-4', 'four', { publicIpv6Subnet: null }),
      net('net-wait', 'waiting', { currentState: null, currentExistence: 'NotCreated', transition: 'Creating' }),
    ], [])
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'six' })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: 'four' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'waiting' })).not.toBeInTheDocument()
  })

  it('says to turn on public IPv6 when no network has it, and cannot submit', async () => {
    serve([net('net-4', 'four', { publicIpv6Subnet: null })], [])
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/no network has public ipv6 yet/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Create load balancer' })).toBeDisabled()
  })

  it('lists only VMs of the chosen network that Incus holds and nobody deletes, then posts the configuration', async () => {
    let body: unknown
    serve([net('net-6', 'six'), net('net-7', 'seven')], [
      vm('vm-a', 'web-a', 'net-6'),
      vm('vm-b', 'web-b', 'net-6'),
      vm('vm-other', 'other', 'net-7'),
      vm('vm-gone', 'going', 'net-6', { desiredExistence: 'Deleted', transition: 'Deleting' }),
      vm('vm-new', 'fresh', 'net-6', { currentState: null, currentExistence: 'NotCreated', transition: 'Creating' }),
    ])
    server.use(http.post('*/v1/tenant/load-balancers', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ loadBalancerId: 'lb-new' }, { status: 202 })
    }))
    const onOpenChange = vi.fn()
    const onDone = vi.fn()
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={onOpenChange} onDone={onDone} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'six' })).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText('e.g. web-lb'), 'web-lb')
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'net-6')
    expect(screen.getByLabelText('web-a')).toBeInTheDocument()
    expect(screen.queryByLabelText('other')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('going')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('fresh')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Target port'))
    await userEvent.type(screen.getByLabelText('Target port'), '8080')
    await userEvent.click(screen.getByLabelText('web-a'))
    await userEvent.click(screen.getByLabelText('web-b'))
    await userEvent.click(screen.getByRole('button', { name: 'Create load balancer' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(body).toEqual({
      name: 'web-lb', networkId: 'net-6',
      listeners: [{ protocol: 'TCP', port: 80, targetPort: 8080 }],
      backends: [{ vmId: 'vm-a' }, { vmId: 'vm-b' }],
    })
    expect(onDone).toHaveBeenCalledWith('created')
  })

  it('forgets the VMs ticked on a network when another network is chosen', async () => {
    serve([net('net-6', 'six'), net('net-7', 'seven')], [vm('vm-a', 'web-a', 'net-6'), vm('vm-c', 'web-c', 'net-7')])
    let posted = false
    server.use(http.post('*/v1/tenant/load-balancers', () => { posted = true; return HttpResponse.json({}, { status: 202 }) }))
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'six' })).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText('e.g. web-lb'), 'web-lb')
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'net-6')
    await userEvent.click(screen.getByLabelText('web-a'))
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'net-7')
    expect(screen.getByLabelText('web-c')).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Create load balancer' }))
    expect(screen.getByText('Pick 1 to 20 VMs')).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it.each([
    ['a repeated protocol and port', 'Each protocol and port can be used by one listener only'],
    ['a port outside 1-65535', 'Ports must be between 1 and 65535'],
  ])('refuses %s before sending', async (_, message) => {
    serve([net('net-6', 'six')], [vm('vm-a', 'web-a', 'net-6')])
    let posted = false
    server.use(http.post('*/v1/tenant/load-balancers', () => { posted = true; return HttpResponse.json({}, { status: 202 }) }))
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'six' })).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText('e.g. web-lb'), 'web-lb')
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'net-6')
    await userEvent.click(screen.getByLabelText('web-a'))
    if (message.startsWith('Each')) {
      await userEvent.click(screen.getByRole('button', { name: 'Add listener' }))
    } else {
      await userEvent.clear(screen.getByLabelText('Port'))
      await userEvent.type(screen.getByLabelText('Port'), '70000')
    }
    await userEvent.click(screen.getByRole('button', { name: 'Create load balancer' }))
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('refuses a name the server would refuse, before sending', async () => {
    serve([net('net-6', 'six')], [vm('vm-a', 'web-a', 'net-6')])
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'six' })).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText('e.g. web-lb'), '-web')
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'net-6')
    await userEvent.click(screen.getByLabelText('web-a'))
    await userEvent.click(screen.getByRole('button', { name: 'Create load balancer' }))
    expect(screen.getByText(/starting with a letter or digit/i)).toBeInTheDocument()
  })

  it('stops adding listeners at 10', async () => {
    serve([net('net-6', 'six')], [])
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} />)
    const add = screen.getByRole('button', { name: 'Add listener' })
    for (let i = 0; i < 9; i++) {
      await userEvent.click(add)
    }
    expect(screen.getAllByLabelText('Port')).toHaveLength(10)
    expect(add).toBeDisabled()
  })

  it.each([
    [409, 'LOAD_BALANCER_NAME_TAKEN', 'A load balancer with this name already exists'],
    [409, 'LOAD_BALANCER_VIP_CONFLICT', 'Another load balancer took the same address at the same moment — submit again'],
    [422, 'LOAD_BALANCER_QUOTA_EXCEEDED', 'Load balancer quota exceeded'],
    [422, 'LOAD_BALANCER_NEEDS_PUBLIC_IPV6', 'This network has no public IPv6'],
    [422, 'NETWORK_INVALID_STATE', 'This network is not ready yet — try again in a moment'],
    [422, 'LOAD_BALANCER_BACKEND_INVALID', 'A selected VM can no longer take traffic — refresh and pick again'],
    [403, 'TENANT_SUSPENDED', 'Your account is suspended — contact support to create resources'],
    [403, 'TENANT_PENDING_APPROVAL', 'Your account is awaiting admin approval — you can browse but can’t create resources yet'],
    [422, 'LOAD_BALANCER_INVALID_STATE', 'This network has no free load balancer address left'],
    [500, 'SOMETHING_ELSE', 'Something went wrong. Please try again.'],
  ])('shows the sentence of %i %s', async (status, code, message) => {
    serve([net('net-6', 'six')], [vm('vm-a', 'web-a', 'net-6')])
    server.use(http.post('*/v1/tenant/load-balancers', () => HttpResponse.json({ status, title: 'x', code }, { status })))
    const onOpenChange = vi.fn()
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'six' })).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText('e.g. web-lb'), 'web-lb')
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'net-6')
    await userEvent.click(screen.getByLabelText('web-a'))
    await userEvent.click(screen.getByRole('button', { name: 'Create load balancer' }))
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe('LoadBalancerFormModal — edit', () => {
  it('starts from the configuration, keeps name and network, and puts the whole new one', async () => {
    let body: unknown
    serve([net('net-6', 'six')], [vm('vm-a', 'web-a', 'net-6'), vm('vm-b', 'web-b', 'net-6')])
    server.use(http.put('*/v1/tenant/load-balancers/lb-1', async ({ request }) => {
      body = await request.json()
      return new HttpResponse(null, { status: 204 })
    }))
    const onDone = vi.fn()
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} loadBalancer={lb()} onDone={onDone} />)
    await waitFor(() => expect(screen.getByLabelText('web-b')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('e.g. web-lb')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Network')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Target port')).toHaveValue(8080)
    expect(screen.getByLabelText('web-a')).toBeChecked()
    await userEvent.click(screen.getByLabelText('web-b'))
    await userEvent.click(screen.getByRole('button', { name: 'Add listener' }))
    const protocols = screen.getAllByLabelText('Protocol')
    await userEvent.selectOptions(protocols[1], 'UDP')
    const ports = screen.getAllByLabelText('Port')
    await userEvent.clear(ports[1]); await userEvent.type(ports[1], '53')
    const targets = screen.getAllByLabelText('Target port')
    await userEvent.clear(targets[1]); await userEvent.type(targets[1], '53')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('updated'))
    expect(body).toEqual({
      listeners: [{ protocol: 'TCP', port: 80, targetPort: 8080 }, { protocol: 'UDP', port: 53, targetPort: 53 }],
      backends: [{ vmId: 'vm-a' }, { vmId: 'vm-b' }],
    })
  })

  it('still lists a backend that can no longer take traffic, so it can be unticked', async () => {
    let body: unknown
    serve([net('net-6', 'six')], [vm('vm-a', 'web-a', 'net-6'), vm('vm-b', 'web-b', 'net-6', { currentState: null, currentExistence: 'NotFound' })])
    server.use(http.put('*/v1/tenant/load-balancers/lb-1', async ({ request }) => {
      body = await request.json()
      return new HttpResponse(null, { status: 204 })
    }))
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()}
      loadBalancer={lb({ backends: [{ vmId: 'vm-a' }, { vmId: 'vm-b' }] })} />)
    await waitFor(() => expect(screen.getByLabelText('web-b')).toBeChecked())
    await userEvent.click(screen.getByLabelText('web-b'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toEqual({
      listeners: [{ protocol: 'TCP', port: 80, targetPort: 8080 }], backends: [{ vmId: 'vm-a' }],
    }))
  })

  it('shows the busy sentence when another change waits', async () => {
    serve([net('net-6', 'six')], [vm('vm-a', 'web-a', 'net-6'), vm('vm-b', 'web-b', 'net-6')])
    server.use(http.put('*/v1/tenant/load-balancers/lb-1', () =>
      HttpResponse.json({ status: 422, title: 'x', code: 'LOAD_BALANCER_INVALID_STATE' }, { status: 422 })))
    renderWithProviders(<LoadBalancerFormModal open onOpenChange={vi.fn()} loadBalancer={lb()} />)
    await waitFor(() => expect(screen.getByLabelText('web-b')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('web-b'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('The load balancer is busy with another change — try again in a moment')).toBeInTheDocument())
  })
})
