import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MemoryRouter } from 'react-router-dom'
import { VolumeListPage } from './VolumeListPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))
import { toast } from 'sonner'

// A volume Incus holds that no instance uses, nothing waiting (lib/storageState.ts).
const vol = (overrides = {}) => ({
  id: 'vol-1', name: 'data-vol-1', currentExistence: 'Exists', desiredExistence: 'Exists',
  currentAttachedVmId: null, currentAttachedElsewhere: false, desiredAttachedVmId: null, transition: null,
  requestFailureReason: null, requestFailedAt: null,
  zoneId: 'z1', volumeOfferingId: 'do1', sizeGb: 50,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const attached = (overrides = {}) => vol({ currentAttachedVmId: 'vm-1', desiredAttachedVmId: 'vm-1', ...overrides })

const snap = (overrides = {}) => ({
  id: 'snap-1', volumeId: 'vol-1', name: 'before-update', currentExistence: 'Exists', desiredExistence: 'Exists',
  transition: null, requestFailureReason: null, requestFailedAt: null,
  createdAt: '2026-01-02T00:00:00Z',
  ...overrides,
})

describe('VolumeListPage', () => {
  beforeEach(() => vi.clearAllMocks())

  // US-VOL-05 — empty state
  it('shows empty state when no volumes', async () => {
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No volumes')).toBeInTheDocument())
  })

  it('shows only volumes matching ?q from the top-bar search, and Clear shows all again', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol({ name: 'data-db' }), vol({ id: 'v2', name: 'backup-01' })])))
    renderWithProviders(<MemoryRouter initialEntries={['/volumes?q=data']}><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-db')).toBeInTheDocument())
    expect(screen.queryByText('backup-01')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('backup-01')).toBeInTheDocument()
  })

  // US-VOL-05 — shows volume row
  it('shows volume row with name and status badge', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('50 GB')).toBeInTheDocument()
  })

  // DESIRED-CURRENT-STATE PR-2 — the badge shows the waiting request, and no new request starts over it.
  it('shows the waiting detach as the badge and offers neither detach nor delete', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([
      attached({ desiredAttachedVmId: null, transition: 'Detaching' }),
    ])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText('Detaching')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^detach$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^attach$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  // Drift: detached outside Titan with nothing waiting while asked attached — the badge tells the truth, the row adds
  // what was requested.
  it('shows drift as what Incus shows plus what was requested', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([
      vol({ desiredAttachedVmId: 'vm-1' }),
    ])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('requested: attached to vm-1')).toBeInTheDocument()
  })

  // P3-1: an instance that is no Titan VM uses it — Titan does not edit that instance, so neither attach, detach
  // nor delete is offered.
  it('shows a volume attached outside Titan and offers no attach, detach or delete', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol({ currentAttachedElsewhere: true })])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText('Attached outside OpenViCloud')).toBeInTheDocument()
    expect(screen.getByText('outside OpenViCloud')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^attach$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^detach$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  // Delete follows Incus: a volume Incus no longer has, and one whose create failed before Incus had it, are
  // deletable; neither can be attached.
  it.each([
    ['Not found', { currentExistence: 'NotFound' }],
    ['Failed', { currentExistence: 'NotCreated', requestFailureReason: 'Volume creation failed.' }],
  ])('shows %s and offers Delete but not Attach', async (label, overrides) => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol(overrides)])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^attach$/i })).not.toBeInTheDocument()
  })

  // A snapshot whose delete is waiting shows it, and offers no restore or delete over it.
  it('shows a snapshot delete in flight and offers no action on it', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([
        snap({ desiredExistence: 'Deleted', transition: 'Deleting' }),
      ])),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^snapshots$/i }))
    await waitFor(() => expect(screen.getByText('before-update')).toBeInTheDocument())
    expect(screen.getByText('Deleting')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^restore$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete snapshot/i })).not.toBeInTheDocument()
  })

  // US-VOL-05 — error banner
  it('shows error banner when GET volumes fails', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json(null, { status: 500 })))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/failed to load volumes/i)).toBeInTheDocument())
    expect(screen.queryByRole('list', { name: 'Volumes' })).not.toBeInTheDocument()
  })

  // US-VOL-04 — delete button enabled for an available volume
  it('delete button enabled for an available volume', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
  })

  // US-VOL-04 — delete button disabled for an attached volume
  it('delete button disabled for Attached volume', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([attached()])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  // Incus has made the volume once its create command answers, so a create waits only seconds: the server refuses a
  // delete over it, and the page does not offer one.
  it('holds Delete back while the volume is being created', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol({ currentExistence: 'NotCreated', transition: 'Creating' })])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText('Creating')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  // On Incus a volume's delete takes its snapshots with it, so the control plane refuses it while one lives.
  it('says to delete the snapshots first when the volume still has some', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.delete('*/v1/tenant/volumes/vol-1', () => HttpResponse.json({ code: 'VOLUME_HAS_SNAPSHOTS' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This volume still has snapshots. Delete its snapshots first, then the volume.'),
    )
    // The toast says what to do next, and that happens on the page behind the dialog.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // The list is a few seconds old: Incus may show the volume attached by now, or a request may have started.
  it('says why the server refused the delete when the volume changed under the page', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.delete('*/v1/tenant/volumes/vol-1', () => HttpResponse.json({ code: 'VOLUME_INVALID_STATE' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Cannot delete yet: the volume is attached or a request is still waiting on it.')
    )
  })

  // US-VOL-04 — confirm dialog shown
  it('shows confirmation dialog on delete click', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByText(/delete data-vol-1/i)).toBeInTheDocument()
  })

  // US-VOL-04 — delete success toast
  it('shows success toast after volume deleted', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.delete('*/v1/tenant/volumes/vol-1', () => HttpResponse.json(null, { status: 202 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Volume deleted'))
  })

  // C2 (design sync 2026-08-23) — "Attached to" shows the VM name, not the raw id (mirrors design;
  // same shape as admin B-INV). Name resolved via useVms map, like zoneMap/offeringMap.
  it('shows attached VM name (not id) in Attached to column', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([attached()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'vm-1', name: 'api-gateway-01', currentState: 'Running', desiredState: 'Running', transition: null, zoneId: 'z1',
          currentExistence: 'Exists', desiredExistence: 'Exists', requestFailureReason: null,
          ipAddress: '10.0.0.5', networkId: 'n1', vmOfferingId: 'so1',
          templateId: 't1', createdAt: '2026-01-01T00:00:00Z',
          publicIpv6Address: null },
      ])),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByText('api-gateway-01')).toBeInTheDocument()
    expect(screen.queryByText('vm-1')).not.toBeInTheDocument()
  })

  // US-VOL-03 — detach button shown for Attached
  it('shows Detach button for Attached volume', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([attached()])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /detach/i })).toBeInTheDocument()
  })

  // US-VOL-03 — detach success toast
  it('shows success toast after volume detached', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([attached()])),
      http.post('*/v1/tenant/volumes/vol-1/detach', () => HttpResponse.json(null, { status: 202 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /detach/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Volume detached'))
  })

  // US-VOLSNAP-02 — snapshots panel expands
  it('expands snapshot panel when Snapshots button clicked', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([snap()])),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-update')).toBeInTheDocument())
    // The volume's badge and the snapshot's: both on Incus, nothing waiting.
    expect(screen.getAllByText('Available')).toHaveLength(2)
  })

  // US-VOLSNAP-02 — empty snapshots
  it('shows empty snapshot state when no snapshots', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([])),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText(/no snapshots/i)).toBeInTheDocument())
  })

  // US-VOLSNAP-01 — create snapshot via New Snapshot button
  it('creates snapshot and shows success toast', async () => {
    let posted = false
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([])),
      http.post('*/v1/tenant/volumes/vol-1/snapshots', async ({ request }) => {
        const body = await request.json() as { name: string }
        if (body.name === 'my-snap') posted = true
        return HttpResponse.json({ id: 'snap-new', name: 'my-snap', status: 'Creating' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /new snapshot/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /new snapshot/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/snapshot name/i)).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/snapshot name/i), 'my-snap')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(posted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Snapshot created'))
  })

  // US-VOLSNAP-03 — delete snapshot
  it('shows delete button for a snapshot on Incus and calls DELETE API', async () => {
    let deleted = false
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([snap()])),
      http.delete('*/v1/tenant/volumes/vol-1/snapshots/snap-1', () => {
        deleted = true
        return HttpResponse.json(null, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-update')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /delete snapshot/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Snapshot deleted'))
  })

  // Incus has made the snapshot once its create command answers: a create waits only seconds, and nothing is offered
  // over it.
  it('offers neither Delete nor Restore on a snapshot being created', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([
        snap({ currentExistence: 'NotCreated', transition: 'Creating' }),
      ])),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^snapshots$/i }))
    await waitFor(() => expect(screen.getByText('before-update')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /delete snapshot/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^restore$/i })).not.toBeInTheDocument()
  })

  // Delete follows Incus: a snapshot Incus no longer has is deletable, never restorable.
  it('offers Delete but not Restore on a snapshot Incus no longer has, and says why a refused delete was refused', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([
        snap({ currentExistence: 'NotFound' }),
      ])),
      http.delete('*/v1/tenant/volumes/vol-1/snapshots/snap-1', () =>
        HttpResponse.json({ code: 'VOLUME_SNAPSHOT_INVALID_STATE' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^snapshots$/i }))
    await waitFor(() => expect(screen.getByText('before-update')).toBeInTheDocument())
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^restore$/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /delete snapshot/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Cannot delete yet: a request is still waiting on this snapshot. Try again in a minute.')
    )
  })

  // US-VOLSNAP-04 — restore snapshot
  it('restores snapshot and shows success toast with new volume id', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([snap()])),
      http.post('*/v1/tenant/volumes/vol-1/snapshots/snap-1/restore', () =>
        HttpResponse.json({ newVolumeId: 'vol-new' }, { status: 202 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByText('before-update')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /restore/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/new volume name/i)).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/new volume name/i), 'restored-vol')
    await userEvent.click(screen.getByRole('button', { name: /^restore$/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Restore started')))
  })

  // US-VOL-01 — create volume opens modal and shows success toast
  it('opens Create Volume modal and creates volume successfully', async () => {
    let posted = false
    server.use(
      http.get('*/v1/volume-offerings', () => HttpResponse.json([{ id: 'do1', name: 'Fast SSD', sizeGb: 0, isCustomized: true }])),
      http.get('*/v1/zones', () => HttpResponse.json([{ id: 'z1', name: 'Zone 1' }])),
      http.post('*/v1/tenant/volumes', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>
        if (body.name === 'my-vol') posted = true
        return HttpResponse.json({ id: 'vol-new', name: 'my-vol', status: 'Allocating' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: /create volume/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))
    await waitFor(() => expect(screen.getByText('Create Data Volume')).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. data-vol/i), 'my-vol')
    const selects = screen.getAllByRole('combobox')
    for (const s of selects) await userEvent.selectOptions(s, s.querySelectorAll('option')[1]?.value ?? '')
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. 50/i), '20')
    await userEvent.click(screen.getByRole('button', { name: /create volume/i }))
    await waitFor(() => expect(posted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Volume created'))
  })

  // US-VOL-02 — attach volume shows dialog and calls API
  it('shows Attach button for an available volume and attaches successfully', async () => {
    let attachPosted = false
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        { id: 'vm-1', name: 'web-01', currentState: 'Running', desiredState: 'Running', transition: null, zoneId: 'z1',
          currentExistence: 'Exists', desiredExistence: 'Exists', requestFailureReason: null,
          ipAddress: '10.0.0.5', networkId: 'n1', vmOfferingId: 'so1',
          templateId: 't1', createdAt: '2026-01-01T00:00:00Z',
          publicIpv6Address: null },
      ])),
      http.post('*/v1/tenant/volumes/vol-1/attach', async ({ request }) => {
        const body = await request.json() as { vmId: string }
        if (body.vmId === 'vm-1') attachPosted = true
        return HttpResponse.json(null, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^attach$/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }))
    await waitFor(() => expect(screen.getByText('Attach volume')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /select vm/i }), 'vm-1')
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }))
    await waitFor(() => expect(attachPosted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Volume attaching'))
  })

  // Incus attaches a disk to a Running, Ready, Stopped or Frozen instance (docs/features/vm/design.md#requests-follow-incus); an Error VM, or a
  // VM Incus did not find, is not offered.
  it('offers Ready and Frozen VMs in the attach picker, not Error or not found ones', async () => {
    const pickerVm = (id: string, name: string, currentState: string | null, currentExistence = 'Exists') => ({
      id, name, currentState, desiredState: 'Running', transition: null, zoneId: 'z1',
      currentExistence, desiredExistence: 'Exists', requestFailureReason: null,
      ipAddress: null, networkId: 'n1', vmOfferingId: 'so1', templateId: 't1', createdAt: '2026-01-01T00:00:00Z',
      publicIpv6Address: null,
    })
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/vms', () => HttpResponse.json([
        pickerVm('vm-1', 'ready-vm', 'Ready'),
        pickerVm('vm-2', 'frozen-vm', 'Frozen'),
        pickerVm('vm-3', 'broken-vm', 'Error'),
        pickerVm('vm-4', 'lost-vm', null, 'NotFound'),
      ])),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }))
    const picker = await screen.findByRole('combobox', { name: /select vm/i })
    const offered = Array.from(picker.querySelectorAll('option')).map(o => o.textContent)
    expect(offered).toEqual(['Select VM…', 'ready-vm (Ready)', 'frozen-vm (Frozen)'])
  })

  // US-VOLSNAP-01 — VOLUME_SNAPSHOT_QUOTA_EXCEEDED in create form
  it('shows quota error when snapshot quota exceeded', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol()])),
      http.get('*/v1/tenant/volumes/vol-1/snapshots', () => HttpResponse.json([])),
      http.post('*/v1/tenant/volumes/vol-1/snapshots', () =>
        HttpResponse.json({ code: 'VOLUME_SNAPSHOT_QUOTA_EXCEEDED' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /snapshots/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /new snapshot/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /new snapshot/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/snapshot name/i)).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/snapshot name/i), 'snap-over-quota')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() => expect(screen.getByText(/snapshot quota exceeded/i)).toBeInTheDocument())
  })

  it('shows the list in Vietnamese, with the date in Vietnamese format', async () => {
    server.use(http.get('*/v1/tenant/volumes', () => HttpResponse.json([vol({ createdAt: '2026-01-05T12:00:00Z' })])))
    renderWithProviders(<MemoryRouter><VolumeListPage /></MemoryRouter>, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('data-vol-1')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Ổ đĩa dữ liệu' })).toBeInTheDocument()
    expect(screen.getByText('1 ổ đĩa')).toBeInTheDocument()
    expect(screen.getByText(/tạo ngày 05\/01\/2026/)).toBeInTheDocument()
    expect(screen.getByText('Dung lượng')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo ổ đĩa' })).toBeInTheDocument()
    // The state badge stays English in both languages.
    expect(screen.getByText('Available')).toBeInTheDocument()
  })
})
