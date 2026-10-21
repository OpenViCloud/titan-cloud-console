import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { ApiTokensPage } from './ApiTokensPage'

const terraform = {
  id: 't1',
  name: 'terraform',
  prefix: 'ovc_q3v9',
  createdAt: '2026-10-18T09:00:00Z',
  expiresAt: '2027-01-16T09:00:00Z',
}
const ci = { id: 't2', name: 'ci', prefix: 'ovc_Ab12', createdAt: '2026-10-18T09:00:00Z', expiresAt: null }
const old = { id: 't3', name: 'old', prefix: 'ovc_Zz99', createdAt: '2025-01-01T09:00:00Z', expiresAt: '2025-01-31T09:00:00Z' }

function renderPage(lang: 'en' | 'vi' = 'en') {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/api-tokens']}>
      <ApiTokensPage />
    </MemoryRouter>,
    { lang },
  )
}

async function openCreate() {
  await userEvent.click(screen.getByRole('button', { name: 'Create token' }))
  return screen.findByRole('dialog')
}

describe('ApiTokensPage', () => {
  it('lists each token by name and prefix, with when it was made and when it expires', async () => {
    server.use(http.get('*/v1/tenant/api-tokens', () => HttpResponse.json([terraform, ci, old])))
    renderPage()
    await waitFor(() => expect(screen.getByText('terraform')).toBeInTheDocument())
    expect(screen.getByText('ovc_q3v9…')).toBeInTheDocument()
    expect(screen.getByText('Jan 16, 2027')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(screen.getByText('Expired Jan 31, 2025')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('No API tokens yet')).toBeInTheDocument())
  })

  it('shows an error banner, not a table, when the list fails', async () => {
    server.use(http.get('*/v1/tenant/api-tokens', () => HttpResponse.json(null, { status: 500 })))
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load api tokens/i)).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('creates a token for 90 days by default, then shows the very secret it sent, once', async () => {
    let body: { name: string; token: string; expiresInDays: number | null } | undefined
    let idempotencyKey: string | null = null
    server.use(http.post('*/v1/tenant/api-tokens', async ({ request }) => {
      body = await request.json() as typeof body
      idempotencyKey = request.headers.get('Idempotency-Key')
      return HttpResponse.json({ apiTokenId: 't1' }, { status: 201 })
    }))
    renderPage()
    const dialog = await openCreate()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'terraform')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body!.name).toBe('terraform')
    expect(body!.expiresInDays).toBe(90)
    expect(body!.token).toMatch(/^ovc_[A-Za-z0-9_-]{43}$/)
    expect(idempotencyKey).not.toBeNull()
    expect(await within(dialog).findByDisplayValue(body!.token)).toBeInTheDocument()
    expect(within(dialog).getByText("You won't be able to see this token again. Copy it now.")).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue(body!.token)).not.toBeInTheDocument()
  })

  it('retries a create whose answer never came with the same key and the same secret', async () => {
    const sent: { key: string | null; token: string }[] = []
    server.use(http.post('*/v1/tenant/api-tokens', async ({ request }) => {
      const body = await request.json() as { token: string }
      sent.push({ key: request.headers.get('Idempotency-Key'), token: body.token })
      if (sent.length === 1) {
        return HttpResponse.error()
      }
      return HttpResponse.json({ apiTokenId: 't1' }, { status: 201 })
    }))
    renderPage()
    const dialog = await openCreate()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'terraform')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }))
    await within(dialog).findByText('Something went wrong. Please try again.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }))

    await within(dialog).findByDisplayValue(sent[0].token)
    expect(sent).toHaveLength(2)
    expect(sent[1].key).toBe(sent[0].key)
    expect(sent[1].token).toBe(sent[0].token)
  })

  it('copies the token', async () => {
    server.use(http.post('*/v1/tenant/api-tokens', () => HttpResponse.json({ apiTokenId: 't1' }, { status: 201 })))
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'terraform')
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^ovc_[A-Za-z0-9_-]{43}$/))
  })

  it('sends no lifetime for a token that never expires', async () => {
    let body: { expiresInDays: number | null } | undefined
    server.use(http.post('*/v1/tenant/api-tokens', async ({ request }) => {
      body = await request.json() as typeof body
      return HttpResponse.json({ apiTokenId: 't1' }, { status: 201 })
    }))
    renderPage()
    const dialog = await openCreate()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'ci')
    await userEvent.selectOptions(within(dialog).getByLabelText('Expires after'), 'never')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body!.expiresInDays).toBeNull()
  })

  it.each([
    ['API_TOKEN_NAME_TAKEN', 409, 'A token with this name already exists'],
    ['API_TOKEN_QUOTA_EXCEEDED', 422, 'Token limit reached (20) — delete a token first'],
  ])('says why the server refused the token: %s', async (code, status, text) => {
    server.use(http.post('*/v1/tenant/api-tokens', () => HttpResponse.json({ status, title: 'refused', code }, { status })))
    renderPage()
    const dialog = await openCreate()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'terraform')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }))

    expect(await within(dialog).findByText(text)).toBeInTheDocument()
  })

  it('warns before a delete that whatever uses the token stops working, then deletes it', async () => {
    let deleted = ''
    server.use(
      http.get('*/v1/tenant/api-tokens', () => HttpResponse.json([terraform])),
      http.delete('*/v1/tenant/api-tokens/:id', ({ params }) => {
        deleted = String(params.id)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete API token terraform' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('CI jobs and scripts using this token stop working at once.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deleted).toBe('t1'))
  })

  it('speaks Vietnamese: heading, columns and a token that never expires', async () => {
    server.use(http.get('*/v1/tenant/api-tokens', () => HttpResponse.json([ci])))
    renderPage('vi')
    await waitFor(() => expect(screen.getByText('Không hết hạn')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Token API')
    expect(screen.getByRole('columnheader', { name: 'Hết hạn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xoá token API ci' })).toBeInTheDocument()
  })
})
