import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VolumeCreateModal } from './VolumeCreateModal'

const cluster = { id: 'z1', name: 'Cluster 1' }
// A tier is a name: the customer always types the size.
const offering = { id: 'vo-standard', name: 'Standard' }

function mockCatalog(offerings = [offering]) {
  server.use(
    http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
    http.get('*/v1/volume-offerings', () => HttpResponse.json(offerings)),
  )
}

// combobox[0] = Cluster, combobox[1] = Volume Offering (DOM order in the modal).
async function selectClusterAndOffering(offeringId: string) {
  const [clusterSelect, offeringSelect] = screen.getAllByRole('combobox')
  await userEvent.selectOptions(clusterSelect, cluster.id)
  await userEvent.selectOptions(offeringSelect, offeringId)
}

describe('VolumeCreateModal', () => {
  it('blocks submit with a size error when no size is typed', async () => {
    mockCatalog()
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Standard/i })).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/data-vol/i), 'my-vol')
    await selectClusterAndOffering(offering.id)
    // the size field is left empty
    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))

    expect(screen.getByText('Size is required for this disk offering.')).toBeInTheDocument()
  })

  it('posts the typed size', async () => {
    mockCatalog()
    let body: unknown
    server.use(
      http.post('*/v1/tenant/volumes', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 'vol-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Standard/i })).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/data-vol/i), 'my-vol')
    await selectClusterAndOffering(offering.id)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. 50/i), '50')

    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))
    await waitFor(() => expect(body).toEqual(
      { name: 'my-vol', volumeOfferingId: offering.id, clusterId: cluster.id, sizeGb: 50 },
    ))
  })

  it('maps VOLUME_QUOTA_EXCEEDED to a readable error', async () => {
    mockCatalog()
    server.use(
      http.post('*/v1/tenant/volumes', () =>
        HttpResponse.json({ status: 422, title: 'Quota', code: 'VOLUME_QUOTA_EXCEEDED' }, { status: 422 }),
      ),
    )
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Standard/i })).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/data-vol/i), 'my-vol')
    await selectClusterAndOffering(offering.id)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. 50/i), '50')
    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))

    await waitFor(() => expect(screen.getByText('Volume quota exceeded (max 10).')).toBeInTheDocument())
  })

  it('shows the form in Vietnamese', async () => {
    mockCatalog()
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />, { lang: 'vi' })
    expect(screen.getByRole('heading', { name: 'Tạo ổ đĩa dữ liệu' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Standard' })).toBeInTheDocument())
    expect(screen.getByText('Cấu hình ổ đĩa')).toBeInTheDocument()
    expect(screen.getByText('Dung lượng (GB)')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Chọn cluster…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo ổ đĩa' })).toBeDisabled()
  })
})
