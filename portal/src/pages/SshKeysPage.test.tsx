import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { SshKeysPage } from './SshKeysPage'

const laptop = {
  id: 'k1',
  name: 'laptop',
  type: 'ssh-ed25519',
  fingerprint: 'SHA256:iruZOXrfD+ZK21g+LvOgxbzdggbMluG+IMSJLD4JlN0',
  createdAt: '2026-10-13T12:00:00Z',
}
const ed25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJQIuvIctzZ61SoksnjJlkCRERFjIowWaKhlaoSOsHMB alice@laptop'

function renderPage(lang: 'en' | 'vi' = 'en') {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/ssh-keys']}>
      <SshKeysPage />
    </MemoryRouter>,
    { lang },
  )
}

describe('SshKeysPage', () => {
  it('lists each key with its type, fingerprint and date', async () => {
    server.use(http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptop])))
    renderPage()
    await waitFor(() => expect(screen.getByText('laptop')).toBeInTheDocument())
    expect(screen.getByText('ssh-ed25519')).toBeInTheDocument()
    expect(screen.getByText('SHA256:iruZOXrfD+ZK21g+LvOgxbzdggbMluG+IMSJLD4JlN0')).toBeInTheDocument()
    expect(screen.getByText('Oct 13, 2026')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('No SSH keys yet')).toBeInTheDocument())
  })

  it('shows an error banner, not a table, when the list fails', async () => {
    server.use(http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json(null, { status: 500 })))
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load ssh keys/i)).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('adds a key with its name and the pasted line', async () => {
    let body: unknown
    server.use(http.post('*/v1/tenant/ssh-keys', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 'k1' }, { status: 201 })
    }))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'laptop')
    await userEvent.type(within(dialog).getByLabelText('Public key'), ed25519)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add SSH key' }))

    await waitFor(() => expect(body).toEqual({ name: 'laptop', publicKey: ed25519 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    ['SSH_KEY_EXISTS', 409, 'This key is already saved'],
    ['SSH_KEY_NAME_TAKEN', 409, 'A key with this name already exists'],
    ['SSH_KEY_QUOTA_EXCEEDED', 422, 'SSH key limit reached — delete a key first'],
    ['VALIDATION_ERROR', 400, 'Not an accepted public key. Use ed25519, ecdsa, or RSA of at least 2048 bits.'],
  ])('says why the server refused the key: %s', async (code, status, text) => {
    server.use(http.post('*/v1/tenant/ssh-keys', () => HttpResponse.json({ status, title: 'refused', code }, { status })))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Add SSH key' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'laptop')
    await userEvent.type(within(dialog).getByLabelText('Public key'), ed25519)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add SSH key' }))

    expect(await within(dialog).findByText(text)).toBeInTheDocument()
  })

  it('warns before a delete that VMs keep the key, then deletes it', async () => {
    let deleted = ''
    server.use(
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptop])),
      http.delete('*/v1/tenant/ssh-keys/:id', ({ params }) => {
        deleted = String(params.id)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete SSH key laptop' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('VMs already created keep this key. Remove it inside the VM if you need to.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deleted).toBe('k1'))
  })

  it('speaks Vietnamese: heading, columns and the date', async () => {
    server.use(http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptop])))
    renderPage('vi')
    await waitFor(() => expect(screen.getByText('13/10/2026')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SSH key')
    expect(screen.getByRole('columnheader', { name: 'Ngày thêm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xoá SSH key laptop' })).toBeInTheDocument()
  })
})
