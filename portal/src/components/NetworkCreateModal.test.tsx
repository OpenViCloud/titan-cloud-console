import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { NetworkCreateModal } from './NetworkCreateModal'

const zone = { id: 'z1', name: 'Zone 1',  }

describe('NetworkCreateModal', () => {
  it('shows validation error when name is empty', async () => {
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    expect(screen.getByText('Name is required')).toBeInTheDocument()
  })

  // A request without a zone is a 400 the form showed as "Something went wrong"; the form asks for the zone itself.
  it('asks for a zone and sends nothing when none is chosen', async () => {
    let posted = false
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () => {
        posted = true
        return HttpResponse.json({ id: 'n-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'my-net')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))

    expect(screen.getByText('Choose a zone')).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('shows CIDR validation error for invalid format', async () => {
    server.use(http.get('*/v1/zones', () => HttpResponse.json([zone])))
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'my-net')
    await userEvent.type(screen.getByPlaceholderText(/10\.0\.0\.0/i), 'not-a-cidr')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    expect(screen.getByText(/must be valid cidr/i)).toBeInTheDocument()
  })

  it('calls POST without cidr when CIDR field is empty', async () => {
    let requestBody: unknown
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'n-new', name: 'staging-net', status: 'Creating' }, { status: 202 })
      }),
    )
    const onOpenChange = vi.fn()
    renderWithProviders(<NetworkCreateModal open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'staging-net')
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'z1')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect((requestBody as Record<string, unknown>).cidr).toBeUndefined()
  })

  it('shows CIDR overlap error from API', async () => {
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () =>
        HttpResponse.json({ status: 422, title: 'CIDR overlap', code: 'NETWORK_CIDR_OVERLAP' }, { status: 422 })
      ),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'net-1')
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'z1')
    await userEvent.type(screen.getByPlaceholderText(/10\.0\.0\.0/i), '10.0.0.0/24')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    await waitFor(() => expect(screen.getByText(/overlaps with an existing network/i)).toBeInTheDocument())
  })

  it('shows a clear suspended message on 403 TENANT_SUSPENDED — S4', async () => {
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () =>
        HttpResponse.json({ status: 403, title: 'Suspended', code: 'TENANT_SUSPENDED' }, { status: 403 }),
      ),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'net-1')
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'z1')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    await waitFor(() => expect(screen.getByText(/account is suspended/i)).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('shows a clear pending-approval message on 403 TENANT_PENDING_APPROVAL — S3', async () => {
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () =>
        HttpResponse.json({ status: 403, title: 'Pending approval', code: 'TENANT_PENDING_APPROVAL' }, { status: 403 }),
      ),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'net-1')
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'z1')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    await waitFor(() => expect(screen.getByText(/awaiting admin approval/i)).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('falls back to generic message on an unrecognized 403 code — S3 guard', async () => {
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () =>
        HttpResponse.json({ status: 403, title: 'Forbidden', code: 'SOME_OTHER_CODE' }, { status: 403 }),
      ),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'net-1')
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'z1')
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument())
    expect(screen.queryByText(/awaiting admin approval/i)).not.toBeInTheDocument()
  })

  async function fillAndSubmit(options: { cidr?: string; ipv6: boolean }) {
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. production/i), 'net-1')
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'z1')
    if (options.cidr !== undefined) {
      await userEvent.type(screen.getByPlaceholderText(/10\.0\.0\.0/i), options.cidr)
    }
    if (options.ipv6) {
      await userEvent.click(screen.getByLabelText('Enable public IPv6'))
    }
    await userEvent.click(screen.getByRole('button', { name: /create network/i }))
  }

  it('asks for public IPv6 only when the box is ticked, and it starts unticked', async () => {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', async ({ request }) => {
        bodies.push(await request.json() as Record<string, unknown>)
        return HttpResponse.json({ id: 'n-new' }, { status: 202 })
      }),
    )
    const onOpenChange = vi.fn()
    const { unmount } = renderWithProviders(<NetworkCreateModal open onOpenChange={onOpenChange} />)
    expect(screen.getByLabelText('Enable public IPv6')).not.toBeChecked()
    await fillAndSubmit({ ipv6: false })
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].enablePublicIpv6).toBeUndefined()
    unmount()

    renderWithProviders(<NetworkCreateModal open onOpenChange={onOpenChange} />)
    await fillAndSubmit({ cidr: '172.16.5.0/24', ipv6: true })
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].enablePublicIpv6).toBe(true)
    expect(bodies[1].cidr).toBe('172.16.5.0/24')
  })

  it.each(['100.64.0.0/24', '10.0.0.0/7', '172.16.0.0/11', '192.168.0.0/15', '172.32.0.0/24'])(
    'with public IPv6, refuses %s before sending: it is not inside a private range', async cidr => {
    let posted = false
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () => {
        posted = true
        return HttpResponse.json({ id: 'n-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await fillAndSubmit({ cidr, ipv6: true })
    expect(screen.getByText(/must be inside 10\.0\.0\.0\/8, 172\.16\.0\.0\/12 or 192\.168\.0\.0\/16/)).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it.each(['10.0.0.0/8', '172.16.0.0/12', '172.31.255.0/24', '192.168.0.0/16'])(
    'with public IPv6, sends %s: it is inside a private range', async cidr => {
    let requestBody: Record<string, unknown> = {}
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', async ({ request }) => {
        requestBody = await request.json() as Record<string, unknown>
        return HttpResponse.json({ id: 'n-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await fillAndSubmit({ cidr, ipv6: true })
    await waitFor(() => expect(requestBody.cidr).toBe(cidr))
    expect(requestBody.enablePublicIpv6).toBe(true)
  })

  it('without public IPv6, a CIDR outside the private ranges is sent', async () => {
    let requestBody: Record<string, unknown> = {}
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', async ({ request }) => {
        requestBody = await request.json() as Record<string, unknown>
        return HttpResponse.json({ id: 'n-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await fillAndSubmit({ cidr: '100.64.0.0/24', ipv6: false })
    await waitFor(() => expect(requestBody.cidr).toBe('100.64.0.0/24'))
  })

  it.each([
    [422, 'IPV6_NOT_AVAILABLE', 'Public IPv6 is not available in this zone'],
    [422, 'IPV6_QUOTA_EXCEEDED', 'Public IPv6 quota exceeded — delete a network with public IPv6 first'],
    [409, 'IPV6_ALLOCATION_CONFLICT', 'Another network took the same IPv6 range at the same moment — submit again'],
  ])('shows what %i %s means', async (status, code, message) => {
    server.use(
      http.get('*/v1/zones', () => HttpResponse.json([zone])),
      http.post('*/v1/tenant/networks', () => HttpResponse.json({ status, title: code, code }, { status })),
    )
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />)
    await fillAndSubmit({ ipv6: true })
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
    expect(screen.queryByText('A network with this name already exists')).not.toBeInTheDocument()
  })

  it('shows the form and its validation error in Vietnamese', async () => {
    renderWithProviders(<NetworkCreateModal open onOpenChange={vi.fn()} />, { lang: 'vi' })
    expect(screen.getByRole('heading', { name: 'Tạo mạng' })).toBeInTheDocument()
    expect(screen.getByText('tuỳ chọn')).toBeInTheDocument()
    expect(screen.getByLabelText('Bật IPv6 công khai')).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Tạo mạng' }))
    expect(screen.getByText('Vui lòng nhập tên')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument()
  })
})
