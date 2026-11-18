import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { Vm } from '@/hooks/useVms'
import { AddSshKeyAction } from './AddSshKeyDialog'

const vm = (overrides: Partial<Vm> = {}): Vm => ({
  id: 'vm-1', name: 'web-01', status: 'Running',
  requestFailureReason: null, requestFailedAt: null,
  ipAddress: '10.0.0.5', publicIpv6Address: null,
  networkId: 'n1', vmOfferingId: 'm', templateId: 't1',
  clusterId: 'z1', diskSizeGb: 50, createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const laptopKey = { id: 'k1', name: 'laptop', type: 'ssh-ed25519', fingerprint: 'SHA256:iruZOXrf', createdAt: '2026-10-13T00:00:00Z' }
const desktopKey = { id: 'k2', name: 'desktop', type: 'ssh-rsa', fingerprint: 'SHA256:k7BYeTgd', createdAt: '2026-10-13T00:00:00Z' }

describe('AddSshKeyAction', () => {
  // titan-ops features/vm/design.md#vm-key-addition — AddKeys needs exactly Running, not any other status.
  it.each(['Stopped', 'Starting', 'Frozen', 'Ready'])('disables Add SSH key while the VM is %s', (status) => {
    renderWithProviders(<AddSshKeyAction vm={vm({ status: status as Vm['status'] })} />)
    expect(screen.getByRole('button', { name: 'Add SSH key' })).toBeDisabled()
  })

  it('enables Add SSH key on a Running VM', () => {
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    expect(screen.getByRole('button', { name: 'Add SSH key' })).toBeEnabled()
  })

  it('sends the picked ids with POST, idle until at least one is picked', async () => {
    let requestBody: { sshKeyIds?: string[] } = {}
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey, desktopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', async ({ request }) => {
        requestBody = await request.json() as { sshKeyIds?: string[] }
        return HttpResponse.json({ keyAdditionId: 'add-1' }, { status: 202 })
      }),
      http.get('*/v1/tenant/vms/vm-1/key-additions/add-1', () =>
        HttpResponse.json({ id: 'add-1', status: 'Adding', sshKeyIds: ['k2'], restartNeeded: false, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-11-18T00:00:00Z' })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))

    expect(await screen.findByRole('checkbox', { name: /desktop/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: /desktop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(requestBody.sshKeyIds).toEqual(['k2']))
  })

  it('follows the addition and shows Adding while the worker has not reported back', async () => {
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', () => HttpResponse.json({ keyAdditionId: 'add-1' }, { status: 202 })),
      http.get('*/v1/tenant/vms/vm-1/key-additions/add-1', () =>
        HttpResponse.json({ id: 'add-1', status: 'Adding', sshKeyIds: ['k1'], restartNeeded: false, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-11-18T00:00:00Z' })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Adding')).toBeInTheDocument()
    expect(screen.getByText('Adding the key to the VM…')).toBeInTheDocument()
  })

  it('shows Added with a restart note when restartNeeded is true', async () => {
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', () => HttpResponse.json({ keyAdditionId: 'add-1' }, { status: 202 })),
      http.get('*/v1/tenant/vms/vm-1/key-additions/add-1', () =>
        HttpResponse.json({ id: 'add-1', status: 'Added', sshKeyIds: ['k1'], restartNeeded: true, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-11-18T00:00:00Z' })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Key added')).toBeInTheDocument()
    expect(screen.getByText('The key takes effect once you stop the VM and start it again.')).toBeInTheDocument()
  })

  it('shows Added with no restart note when restartNeeded is false', async () => {
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', () => HttpResponse.json({ keyAdditionId: 'add-1' }, { status: 202 })),
      http.get('*/v1/tenant/vms/vm-1/key-additions/add-1', () =>
        HttpResponse.json({ id: 'add-1', status: 'Added', sshKeyIds: ['k1'], restartNeeded: false, requestFailureReason: null, requestFailedAt: null, createdAt: '2026-11-18T00:00:00Z' })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Key added')).toBeInTheDocument()
    expect(screen.queryByText('The key takes effect once you stop the VM and start it again.')).not.toBeInTheDocument()
  })

  it('shows Failed with the server\'s reason', async () => {
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', () => HttpResponse.json({ keyAdditionId: 'add-1' }, { status: 202 })),
      http.get('*/v1/tenant/vms/vm-1/key-additions/add-1', () =>
        HttpResponse.json({
          id: 'add-1', status: 'Failed', sshKeyIds: ['k1'], restartNeeded: false,
          requestFailureReason: 'Instance is not running.', requestFailedAt: '2026-11-18T00:01:00Z', createdAt: '2026-11-18T00:00:00Z',
        })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Could not add the key')).toBeInTheDocument()
    expect(screen.getByText('Instance is not running.')).toBeInTheDocument()
  })

  it('maps 422 VM_INVALID_STATUS to a readable message and sends nothing more', async () => {
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', () =>
        HttpResponse.json({ status: 422, title: 'x', code: 'VM_INVALID_STATUS' }, { status: 422 })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('The VM must be Running, with no other key addition in progress.')).toBeInTheDocument()
  })

  it('maps 404 SSH_KEY_NOT_FOUND to a readable message', async () => {
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms/vm-1/key-additions', () =>
        HttpResponse.json({ status: 404, title: 'x', code: 'SSH_KEY_NOT_FOUND' }, { status: 404 })),
    )
    renderWithProviders(<AddSshKeyAction vm={vm()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('A picked SSH key no longer exists — pick again.')).toBeInTheDocument()
  })
})
