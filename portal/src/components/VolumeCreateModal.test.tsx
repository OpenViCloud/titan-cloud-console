import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VolumeCreateModal } from './VolumeCreateModal'

const zone = { id: 'z1', name: 'Zone 1' }
// isCustomized=true → user must type a size; isCustomized=false → size comes from the offering.
const customOffering = { id: 'vo-custom', name: 'Custom SSD', sizeGb: 0, isCustomized: true }
const fixedOffering = { id: 'vo-fixed', name: 'Standard', sizeGb: 100, isCustomized: false }

function mockCatalog(offerings = [customOffering, fixedOffering]) {
  server.use(
    http.get('*/v1/zones', () => HttpResponse.json([zone])),
    http.get('*/v1/volume-offerings', () => HttpResponse.json(offerings)),
  )
}

// combobox[0] = Zone, combobox[1] = Volume Offering (DOM order in the modal).
async function selectZoneAndOffering(offeringId: string) {
  const [zoneSelect, offeringSelect] = screen.getAllByRole('combobox')
  await userEvent.selectOptions(zoneSelect, zone.id)
  await userEvent.selectOptions(offeringSelect, offeringId)
}

describe('VolumeCreateModal', () => {
  it('blocks submit with a size error when a custom-size offering has no size', async () => {
    mockCatalog()
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Custom SSD/i })).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/data-vol/i), 'my-vol')
    await selectZoneAndOffering(customOffering.id)
    // size field is present for a custom offering but left empty
    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))

    expect(screen.getByText('Size is required for this disk offering.')).toBeInTheDocument()
  })

  it('hides the size field for a fixed offering and posts the offering size', async () => {
    mockCatalog()
    let body: unknown
    server.use(
      http.post('*/v1/tenant/volumes', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 'vol-new' }, { status: 202 })
      }),
    )
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    renderWithProviders(<VolumeCreateModal open onOpenChange={onOpenChange} onCreated={onCreated} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Standard/i })).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/data-vol/i), 'my-vol')
    await selectZoneAndOffering(fixedOffering.id)
    // fixed offering → no custom size input rendered
    expect(screen.queryByPlaceholderText(/e\.g\. 50/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onCreated).toHaveBeenCalled()
    expect(body).toEqual({ name: 'my-vol', volumeOfferingId: fixedOffering.id, zoneId: zone.id, sizeGb: 100 })
  })

  it('posts the typed size for a custom offering', async () => {
    mockCatalog()
    let body: unknown
    server.use(
      http.post('*/v1/tenant/volumes', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 'vol-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Custom SSD/i })).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/data-vol/i), 'my-vol')
    await selectZoneAndOffering(customOffering.id)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. 50/i), '50')

    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))
    await waitFor(() => expect(body).toEqual(
      { name: 'my-vol', volumeOfferingId: customOffering.id, zoneId: zone.id, sizeGb: 50 },
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
    await selectZoneAndOffering(fixedOffering.id)
    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))

    await waitFor(() => expect(screen.getByText('Volume quota exceeded (max 10).')).toBeInTheDocument())
  })

  it('shows the form in Vietnamese, including the custom-size option', async () => {
    mockCatalog()
    renderWithProviders(<VolumeCreateModal open onOpenChange={vi.fn()} onCreated={vi.fn()} />, { lang: 'vi' })
    expect(screen.getByRole('heading', { name: 'Tạo ổ đĩa dữ liệu' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Custom SSD — Dung lượng tuỳ chọn' })).toBeInTheDocument())
    expect(screen.getByText('Cấu hình ổ đĩa')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Chọn zone…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo ổ đĩa' })).toBeDisabled()
  })
})
