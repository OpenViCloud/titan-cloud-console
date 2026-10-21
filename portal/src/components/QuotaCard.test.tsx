import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { QuotaCard } from './QuotaCard'

const live = { desiredExistence: 'Exists', currentExistence: 'Exists', transition: null as string | null }
const tenant = { id: 't1', name: 'alice', status: 'Active', maxVms: 5, maxNetworks: 3, maxVolumes: 10, maxPublicIpv6: 4 }

function row(label: string) {
  return screen.getByText(label).closest('[data-quota-row]') as HTMLElement
}

describe('QuotaCard', () => {
  it('counts what the server counts against each cap', async () => {
    server.use(
      http.get('*/v1/tenant', () => HttpResponse.json(tenant)),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'a', ...live },
        // a create still waiting counts
        { id: 'b', ...live, currentExistence: 'NotCreated', transition: 'Creating' },
        // a refused create and a VM whose delete was pressed do not count
        { id: 'c', ...live, currentExistence: 'NotCreated' },
        { id: 'd', ...live, desiredExistence: 'Deleted', transition: 'Deleting' },
      ])),
      // Public IPv6 counts networks holding a /64, the way Networks counts networks
      http.get('*/v1/tenant/networks', () => HttpResponse.json([
        { id: 'n', ...live, publicIpv6Subnet: '2001:db8:0:1::/64' },
        { id: 'n-creating', ...live, currentExistence: 'NotCreated', transition: 'Creating', publicIpv6Subnet: '2001:db8:0:2::/64' },
        { id: 'n-private', ...live, publicIpv6Subnet: null },
        { id: 'gone', ...live, currentExistence: 'NotFound', publicIpv6Subnet: '2001:db8:0:3::/64' },
        { id: 'deleting', ...live, desiredExistence: 'Deleted', transition: 'Deleting', publicIpv6Subnet: '2001:db8:0:4::/64' },
      ])),
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([{ id: 'v', ...live }])),
    )
    renderWithProviders(<QuotaCard />)
    await waitFor(() => expect(within(row('VMs')).getByText('2 / 5')).toBeInTheDocument())
    await waitFor(() => expect(within(row('Networks')).getByText('3 / 3')).toBeInTheDocument())
    await waitFor(() => expect(within(row('Volumes')).getByText('1 / 10')).toBeInTheDocument())
    expect(within(row('Public IPv6')).getByText('2 / 4')).toBeInTheDocument()
    expect(within(row('VMs')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  })

  it('counts no public IPv6 when the control plane is too old to send publicIpv6Subnet', async () => {
    server.use(
      http.get('*/v1/tenant', () => HttpResponse.json(tenant)),
      http.get('*/v1/tenant/networks', () => HttpResponse.json([{ id: 'n', ...live }, { id: 'm', ...live }])),
    )
    renderWithProviders(<QuotaCard />)
    await waitFor(() => expect(within(row('Networks')).getByText('2 / 3')).toBeInTheDocument())
    expect(within(row('Public IPv6')).getByText('0 / 4')).toBeInTheDocument()
  })

  it('shows the quota card in Vietnamese', async () => {
    server.use(
      http.get('*/v1/tenant', () => HttpResponse.json({ id: 't1', name: 'alice', status: 'Active', maxVms: 5, maxNetworks: 3 })),
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([{ id: 'v', ...live }])),
    )
    renderWithProviders(<QuotaCard />, { lang: 'vi' })
    expect(screen.getByRole('heading', { name: 'Hạn mức' })).toBeInTheDocument()
    expect(screen.getByText('do OpenViCloud đặt')).toBeInTheDocument()
    await waitFor(() => expect(within(row('Ổ đĩa')).getByText('đã dùng 1')).toBeInTheDocument())
    await waitFor(() => expect(within(row('VM')).getByRole('progressbar', { name: 'VM đã dùng' })).toBeInTheDocument())
  })

  it('shows the used count without a bar when the control plane does not send a cap yet', async () => {
    server.use(
      http.get('*/v1/tenant', () => HttpResponse.json({ id: 't1', name: 'alice', status: 'Active', maxVms: 5, maxNetworks: 3 })),
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([{ id: 'v', ...live }])),
    )
    renderWithProviders(<QuotaCard />)
    await waitFor(() => expect(within(row('Volumes')).getByText('1 used')).toBeInTheDocument())
    expect(within(row('Volumes')).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(row('VMs')).getByRole('progressbar')).toBeInTheDocument()
  })
})
