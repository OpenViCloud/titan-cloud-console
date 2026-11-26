import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VmCreateModal } from './VmCreateModal'

const activeNetwork = { id: 'n1', name: 'default', status: 'Created', requestFailureReason: null, cidr: null, gateway: null, clusterId: 'z1', createdAt: '2026-01-01T00:00:00Z' }
const cluster = { id: 'z1', name: 'Cluster 1' }
const template = { id: 't1', name: 'Ubuntu 22.04', description: 'Ubuntu 22.04 LTS', os: 'ubuntu/22.04' }
const offering = { id: 'm', name: 'Medium', vcpu: 2, memoryMb: 4096, pricePerHour: 311.256 }
const clusterTwoNetwork = { ...activeNetwork, id: 'n2', name: 'far-away', clusterId: 'z2' }

// The form refuses to send until cluster, network, template and size are chosen; a test about what the server answers
// picks whatever it did not pick itself: the first option of a select still empty, the first radio of a group with
// none checked.
async function chooseTheRest() {
  const network = screen.queryByRole('combobox', { name: 'Network' }) as HTMLSelectElement | null
  if (network !== null && network.value === '') {
    await userEvent.selectOptions(network, network.querySelectorAll('option')[1].getAttribute('value')!)
  }
  for (const name of ['Template', 'Size']) {
    const radios = within(await screen.findByRole('radiogroup', { name })).getAllByRole('radio') as HTMLInputElement[]
    if (!radios.some(radio => radio.checked)) {
      await userEvent.click(radios[0])
    }
  }
}

// The cluster select shows once Change is pressed, or by itself while there is a cluster to choose
// (titan-ops features/vm/design.md#vm-create-form).
async function chooseCluster(id: string) {
  await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
  let select = screen.queryByRole('combobox', { name: 'Cluster' })
  if (select === null) {
    await userEvent.click(await screen.findByRole('button', { name: 'Change' }))
    select = await screen.findByRole('combobox', { name: 'Cluster' })
  }
  await userEvent.selectOptions(select, id)
}

// Stop timeout and cloud-init user data sit in the Advanced section, closed until the reader opens it
// (titan-ops features/vm/design.md#vm-create-form).
async function openAdvanced(name: RegExp = /^Advanced/) {
  await userEvent.click(await screen.findByRole('button', { name }))
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

  // A request without cluster, template or size is a 400 the form showed as "Something went wrong".
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

    expect(screen.getByText('Choose a cluster, network, template and size.')).toBeInTheDocument()
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
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
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
    // The cluster comes first: the network and template lists only open once a cluster is chosen.
    await chooseCluster('z1')

    // The template list reads the cluster's templates; its family comes from their `os` (lib/templateFamily.ts).
    expect(await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })).toBeInTheDocument()

    await chooseTheRest()

    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect((requestBody as { name: string }).name).toBe('my-vm')
    expect((requestBody as { clusterId: string; networkId: string }).clusterId).toBe('z1')
    expect((requestBody as { clusterId: string; networkId: string }).networkId).toBe('n1')
    expect((requestBody as { templateId: string }).templateId).toBe('t1')
  })

  // titan-ops features/vm/design.md#ssh-key — picked keys travel as sshKeyIds; with none saved the form points to the
  // SSH keys page instead.
  const laptopKey = { id: 'k1', name: 'laptop', type: 'ssh-ed25519', fingerprint: 'SHA256:iruZOXrf', createdAt: '2026-10-13T00:00:00Z' }
  const desktopKey = { id: 'k2', name: 'desktop', type: 'ssh-rsa', fingerprint: 'SHA256:k7BYeTgd', createdAt: '2026-10-13T00:00:00Z' }

  it('sends the picked SSH keys with the create', async () => {
    let requestBody: { sshKeyIds?: string[] } = {}
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
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
    await chooseCluster('z1')
    await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })
    await chooseTheRest()

    await userEvent.click(screen.getByRole('button', { name: /^SSH keys/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /desktop/ }))
    expect(screen.getByText('Picked keys are added for the user ubuntu.')).toBeInTheDocument()
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(requestBody.sshKeyIds).toEqual(['k2'])
  })

  it('points to the SSH keys page when none is saved, as an option, not a requirement', async () => {
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: 'Add one' })
    expect(link.getAttribute('href')).toBe('/ssh-keys')
    expect(link.parentElement).toHaveTextContent('No SSH keys saved. Add one if you want to log in with SSH.')
  })

  it('points to the SSH keys page when none is saved, in Vietnamese too', async () => {
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })

    const link = await screen.findByRole('link', { name: 'Thêm một key' })
    expect(link.getAttribute('href')).toBe('/ssh-keys')
    expect(link.parentElement).toHaveTextContent('Chưa lưu SSH key nào. Thêm một key nếu muốn đăng nhập bằng SSH.')
    expect(screen.getByText('SSH key')).toBeInTheDocument()
  })

  it('says so when a picked key was deleted meanwhile', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 404, title: 'SSH key not found.', code: 'SSH_KEY_NOT_FOUND' }, { status: 404 })),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseCluster('z1')
    await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /^SSH keys/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /laptop/ }))
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(await screen.findByText('A picked SSH key no longer exists — pick again')).toBeInTheDocument()
  })

  // titan-ops features/vm/design.md#console-password — the password logs in as ubuntu on the Console tab; the server
  // keeps only its hash.
  // titan-ops features/vm/design.md#vm-create-form — SSH keys and the console password sit under Access (optional);
  // stop timeout and user data under Advanced, closed by default.
  describe('form sections', () => {
    let posts: Record<string, unknown>[]
    beforeEach(() => {
      posts = []
      server.use(
        http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
        http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
        http.get('*/v1/templates', () => HttpResponse.json([template])),
        http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey])),
        http.post('*/v1/tenant/vms', async ({ request }) => {
          posts.push(await request.json() as Record<string, unknown>)
          return HttpResponse.json({ vmId: 'vm-new' }, { status: 202 })
        }),
      )
    })

    async function fillTheForm() {
      await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
      await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
      await chooseCluster('z1')
      await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })
      await chooseTheRest()
    }

    it('groups SSH keys and the console password under Access (optional) and names the other ways in', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

      const access = await screen.findByRole('group', { name: 'Access (optional)' })
      expect(within(access).getByText('Without an SSH key, log in on the Console tab as ubuntu with the console password, which can’t be shown again, or add a key later on the VM page.')).toBeInTheDocument()
      await userEvent.click(await within(access).findByRole('button', { name: /^SSH keys/ }))
      expect(await within(access).findByRole('checkbox', { name: /laptop/ })).toBeInTheDocument()
      expect(within(access).getByLabelText('Console password')).toBeInTheDocument()
      expect(within(access).queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('says the same in Vietnamese', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })

      const access = await screen.findByRole('group', { name: 'Truy cập (không bắt buộc)' })
      expect(within(access).getByText('Không có SSH key thì đăng nhập user ubuntu ở tab Console bằng mật khẩu console (không xem lại được), hoặc thêm key sau ở trang VM.')).toBeInTheDocument()
      const advanced = screen.getByRole('button', { name: /^Nâng cao/ })
      expect(advanced).toHaveTextContent('Thời gian dừng, cloud-init user data')
      expect(advanced).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps stop timeout and user data closed under Advanced until it is opened', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

      const advanced = await screen.findByRole('button', { name: /^Advanced/ })
      expect(advanced).toHaveTextContent('Stop timeout, cloud-init user data')
      expect(advanced).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText('Stop timeout (seconds)')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Cloud-init user data')).not.toBeInTheDocument()

      await userEvent.click(advanced)
      expect(advanced).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('Stop timeout (seconds)')).toHaveValue('120')
      expect(screen.getByLabelText('Cloud-init user data')).toBeInTheDocument()
    })

    it('creates a VM with no SSH key, no console password and Advanced never opened', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({ name: 'my-vm', clusterId: 'z1', networkId: 'n1', templateId: 't1', vmOfferingId: 'm', sshKeyIds: [] })
      expect(posts[0]).not.toHaveProperty('consolePassword')
      expect(posts[0]).not.toHaveProperty('stopTimeoutSeconds')
      expect(posts[0]).not.toHaveProperty('userData')
    })

    it('keeps a value typed under Advanced after it is closed again, and sends it', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      await openAdvanced()
      const field = screen.getByLabelText('Stop timeout (seconds)')
      await userEvent.clear(field)
      await userEvent.type(field, '600')
      await openAdvanced()
      expect(screen.queryByLabelText('Stop timeout (seconds)')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts[0].stopTimeoutSeconds).toBe(600)
    })

    it('opens Advanced by itself to show a stop timeout error, and sends nothing', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
      await fillTheForm()
      await openAdvanced()
      const field = screen.getByLabelText('Stop timeout (seconds)')
      await userEvent.clear(field)
      await userEvent.type(field, '29')
      await openAdvanced()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      expect(await screen.findByText('The stop timeout must be a whole number of seconds from 30 to 1800.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Advanced/ })).toHaveAttribute('aria-expanded', 'true')
      expect(posts).toHaveLength(0)
    })

    it('opens Advanced by itself to show a user data error, and sends nothing', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
      await fillTheForm()
      await openAdvanced()
      fireEvent.change(screen.getByLabelText('Cloud-init user data'), { target: { value: 'á'.repeat(16385) } })
      await openAdvanced()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      expect(await screen.findByText('Cloud-init user data is 32770 bytes; the limit is 32768.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Advanced/ })).toHaveAttribute('aria-expanded', 'true')
      expect(posts).toHaveLength(0)
    })

    // The parent keeps `open` true here, so after Cancel the same dialog shows what a new one would.
    it('starts closed again after Cancel', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await openAdvanced()
      expect(screen.getByLabelText('Stop timeout (seconds)')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onOpenChange).toHaveBeenCalledWith(false)

      expect(await screen.findByRole('button', { name: /^Advanced/ })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText('Stop timeout (seconds)')).not.toBeInTheDocument()
    })
  })

  describe('console password', () => {
    let posts: Record<string, unknown>[]
    beforeEach(() => {
      posts = []
      server.use(
        http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
        http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
        http.get('*/v1/templates', () => HttpResponse.json([template])),
        http.post('*/v1/tenant/vms', async ({ request }) => {
          posts.push(await request.json() as Record<string, unknown>)
          return HttpResponse.json({ vmId: 'vm-new' }, { status: 202 })
        }),
      )
    })

    async function fillTheForm() {
      await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
      await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
      await chooseCluster('z1')
      await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })
      await chooseTheRest()
    }

    it('sends the console password with the create, typed in a hidden field', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      const field = screen.getByLabelText('Console password')
      expect(field.getAttribute('type')).toBe('password')
      expect(field.getAttribute('autocomplete')).toBe('new-password')
      expect(field.getAttribute('placeholder')).toBe('12 to 72 characters')
      await userEvent.type(field, 'correct horse battery')
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts.at(-1)?.consolePassword).toBe('correct horse battery')
    })

    it('sends no console password when the field is left empty', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts).toHaveLength(1)
      expect(posts[0]).not.toHaveProperty('consolePassword')
    })

    it.each([
      ['11', 'a'.repeat(11)],
      ['73', 'a'.repeat(73)],
    ])('refuses a console password of %s characters and sends nothing', async (_, password) => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
      await fillTheForm()
      await userEvent.type(screen.getByLabelText('Console password'), password)
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      expect(await screen.findByText('The console password must be 12 to 72 characters.')).toBeInTheDocument()
      expect(posts).toHaveLength(0)
    })

    it('accepts 12 and 72 characters', async () => {
      for (const password of ['a'.repeat(12), 'a'.repeat(72)]) {
        const onOpenChange = vi.fn()
        const { unmount } = renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
        await fillTheForm()
        await userEvent.type(screen.getByLabelText('Console password'), password)
        await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
        expect(posts.at(-1)?.consolePassword).toBe(password)
        unmount()
      }
    })

    it('speaks Vietnamese: label, placeholder and the length error', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })
      await userEvent.type(await screen.findByLabelText('Mật khẩu console'), 'short')
      await userEvent.type(screen.getByPlaceholderText(/web/i), 'my-vm')
      await userEvent.click(screen.getByRole('button', { name: 'Tạo VM' }))

      expect(screen.getByLabelText('Mật khẩu console').getAttribute('placeholder')).toBe('12 đến 72 ký tự')
      expect(await screen.findByText('Mật khẩu console phải từ 12 đến 72 ký tự.')).toBeInTheDocument()
    })
  })

  // titan-ops features/vm/design.md#vm-stop-timeout — how long a stop waits for a clean shutdown; 30 to 1800 seconds,
  // and a VM that sets none gets the server's 120.
  describe('stop timeout', () => {
    let posts: Record<string, unknown>[]
    beforeEach(() => {
      posts = []
      server.use(
        http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
        http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
        http.get('*/v1/templates', () => HttpResponse.json([template])),
        http.post('*/v1/tenant/vms', async ({ request }) => {
          posts.push(await request.json() as Record<string, unknown>)
          return HttpResponse.json({ vmId: 'vm-new' }, { status: 202 })
        }),
      )
    })

    async function fillTheForm() {
      await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
      await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
      await chooseCluster('z1')
      await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })
      await chooseTheRest()
      await openAdvanced()
    }

    async function typeStopTimeout(text: string) {
      const field = screen.getByLabelText('Stop timeout (seconds)')
      await userEvent.clear(field)
      if (text !== '') {
        await userEvent.type(field, text)
      }
    }

    it('starts at 120 with its hint, and leaves the default to the server', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      expect(screen.getByLabelText('Stop timeout (seconds)')).toHaveValue('120')
      expect(screen.getByText('How long the VM gets to shut down cleanly when stopped, before its power is cut. 30 to 1800, default 120.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts).toHaveLength(1)
      expect(posts[0]).not.toHaveProperty('stopTimeoutSeconds')
    })

    it.each([
      { text: '600', seconds: 600 },
      { text: '30', seconds: 30 },
      { text: '1800', seconds: 1800 },
    ])('sends a stop timeout of $text seconds as a number', async ({ text, seconds }) => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      await typeStopTimeout(text)
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts.at(-1)?.stopTimeoutSeconds).toBe(seconds)
    })

    it.each(['29', '1801', '', '90.5', 'abc'])('refuses a stop timeout of %j and sends nothing', async (text) => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
      await fillTheForm()
      await typeStopTimeout(text)
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      expect(await screen.findByText('The stop timeout must be a whole number of seconds from 30 to 1800.')).toBeInTheDocument()
      expect(posts).toHaveLength(0)
    })

    it('speaks Vietnamese: label, hint and the range error', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })
      await openAdvanced(/^Nâng cao/)
      const field = await screen.findByLabelText('Thời gian dừng (giây)')
      await userEvent.clear(field)
      await userEvent.type(field, '5')
      await userEvent.type(screen.getByPlaceholderText(/web/i), 'my-vm')
      await userEvent.click(screen.getByRole('button', { name: 'Tạo VM' }))

      expect(screen.getByText('Khi dừng, VM có chừng này thời gian để tắt êm trước khi bị ngắt nguồn. Từ 30 đến 1800, mặc định 120.')).toBeInTheDocument()
      expect(await screen.findByText('Thời gian dừng phải là số giây nguyên, từ 30 đến 1800.')).toBeInTheDocument()
    })
  })

  // US-VM-USERDATA (titan-ops features/vm/design.md#vm-create-flow) — optional cloud-init user data, sent verbatim;
  // the byte limit is checked client-side like the server's CreateVmValidator (32768 bytes UTF-8).
  describe('cloud-init user data', () => {
    let posts: Record<string, unknown>[]
    beforeEach(() => {
      posts = []
      server.use(
        http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
        http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
        http.get('*/v1/templates', () => HttpResponse.json([template])),
        http.post('*/v1/tenant/vms', async ({ request }) => {
          posts.push(await request.json() as Record<string, unknown>)
          return HttpResponse.json({ vmId: 'vm-new' }, { status: 202 })
        }),
      )
    })

    async function fillTheForm() {
      await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
      await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
      await chooseCluster('z1')
      await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })
      await chooseTheRest()
      await openAdvanced()
    }

    it('shows the field with its monospace hint, and sends nothing while empty', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      const field = screen.getByLabelText('Cloud-init user data')
      expect(field.tagName).toBe('TEXTAREA')
      expect(field.className).toMatch(/font-mono/)
      expect(screen.getByText('Optional. Cloud-init user data, such as #cloud-config, run on first boot. Up to 32768 bytes.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts).toHaveLength(1)
      expect(posts[0]).not.toHaveProperty('userData')
    })

    it('sends pasted cloud-init content exactly as typed', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      const cloudConfig = '#cloud-config\nruncmd:\n  - echo hi'
      await userEvent.type(screen.getByLabelText('Cloud-init user data'), cloudConfig)
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts.at(-1)?.userData).toBe(cloudConfig)
    })

    it('sends content right at the 32768 byte limit', async () => {
      const onOpenChange = vi.fn()
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={onOpenChange} /></MemoryRouter>)
      await fillTheForm()
      const atLimit = 'a'.repeat(32768)
      const field = screen.getByLabelText('Cloud-init user data')
      // userEvent.type sends one keystroke per character — too slow for 32KB; a pasted value fires the same
      // onChange the component listens to.
      fireEvent.change(field, { target: { value: atLimit } })
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(posts.at(-1)?.userData).toBe(atLimit)
    })

    it('refuses content over the 32768 byte limit, reports the byte count, and sends nothing', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
      await fillTheForm()
      const overLimit = 'á'.repeat(16385) // 2 bytes each in UTF-8: 32770 bytes, over the 32768 limit
      const field = screen.getByLabelText('Cloud-init user data')
      fireEvent.change(field, { target: { value: overLimit } })
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      expect(await screen.findByText('Cloud-init user data is 32770 bytes; the limit is 32768.')).toBeInTheDocument()
      expect(posts).toHaveLength(0)
    })

    it('speaks Vietnamese: label, hint and the over-limit error', async () => {
      renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>, { lang: 'vi' })
      await openAdvanced(/^Nâng cao/)
      await screen.findByLabelText('Cloud-init user data')
      expect(screen.getByText('Không bắt buộc. Cloud-init user data, ví dụ #cloud-config, chạy lúc boot đầu. Tối đa 32768 byte.')).toBeInTheDocument()

      const field = screen.getByLabelText('Cloud-init user data')
      fireEvent.change(field, { target: { value: 'á'.repeat(16385) } })
      await userEvent.type(screen.getByPlaceholderText(/web/i), 'my-vm')
      await userEvent.click(screen.getByRole('button', { name: 'Tạo VM' }))

      expect(await screen.findByText('Cloud-init user data dài 32770 byte, vượt giới hạn 32768.')).toBeInTheDocument()
    })
  })

  // titan-ops features/catalog/design.md#template-per-cluster — each cluster holds its own copy of a template; the
  // form offers only the ones synced in the cluster picked.
  const clusterTwo = { id: 'z2', name: 'Cluster 2' }
  const debian = { id: 't2', name: 'Debian 12', description: 'Debian 12 bookworm', os: 'debian/12' }
  const templatesByCluster = http.get('*/v1/templates', ({ request }) => {
    const clusterId = new URL(request.url).searchParams.get('clusterId')
    if (clusterId === 'z1') {
      return HttpResponse.json([template])
    }
    if (clusterId === 'z2') {
      return HttpResponse.json([debian])
    }
    return HttpResponse.json([template, debian])
  })

  it('lists only the templates synced in the picked cluster', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, clusterTwoNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster, clusterTwo])),
      templatesByCluster,
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

    await waitFor(() => expect(screen.getAllByText(/select a cluster first/i)).toHaveLength(2)) // network + template
    const clusterSelect = await screen.findByRole('combobox', { name: 'Cluster' })

    await userEvent.selectOptions(clusterSelect, 'z1')
    expect(await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^Debian 12/ })).not.toBeInTheDocument()

    await userEvent.selectOptions(clusterSelect, 'z2')
    expect(await screen.findByRole('radio', { name: /^Debian 12/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^Ubuntu 22\.04/ })).not.toBeInTheDocument()
  })

  it('drops the chosen template when the new cluster does not offer it', async () => {
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, clusterTwoNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster, clusterTwo])),
      templatesByCluster,
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    const clusterSelect = await screen.findByRole('combobox', { name: 'Cluster' })
    await userEvent.selectOptions(clusterSelect, 'z1')
    await userEvent.click(await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ }))

    await userEvent.selectOptions(clusterSelect, 'z2')
    await screen.findByRole('radio', { name: /^Debian 12/ })

    // z2 offers one template, so that one is chosen; the template picked in z1 is never sent.
    expect(screen.getByRole('radio', { name: /^Debian 12/ })).toBeChecked()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'n2')
    await userEvent.click(screen.getByRole('radio', { name: /^Medium/ }))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(requestBody).toBeDefined())
    expect((requestBody as { templateId: string }).templateId).toBe('t2')
  })

  it('keeps the chosen template when the new cluster offers it too', async () => {
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, clusterTwoNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster, clusterTwo])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    const clusterSelect = await screen.findByRole('combobox', { name: 'Cluster' })
    await userEvent.selectOptions(clusterSelect, 'z1')
    await userEvent.click(await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ }))

    await userEvent.selectOptions(clusterSelect, 'z2')
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Ubuntu 22\.04/ })).toBeChecked())

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(requestBody).toBeDefined())
    expect((requestBody as { templateId: string }).templateId).toBe('t1')
  })

  it('asks for another template on 422 TEMPLATE_NOT_SYNCED', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () => HttpResponse.json({ status: 422, title: 'x', code: 'TEMPLATE_NOT_SYNCED' }, { status: 422 })),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseCluster('z1')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(await screen.findByText(/not available in this cluster yet/i)).toBeInTheDocument()
  })

  // titan-ops features/catalog/design.md#cluster-is-a-real-choice — a VM lands on its network's cluster, so the form
  // offers only the networks of the cluster the customer picked.
  it('opens the network list only after a cluster is picked, and lists only that cluster’s networks', async () => {
    const otherClusterNetwork = { ...activeNetwork, id: 'n2', name: 'far-away', clusterId: 'z2' }
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, otherClusterNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster, { id: 'z2', name: 'Cluster 2' }])),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText(/select a cluster first/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Network' })).not.toBeInTheDocument()

    await chooseCluster('z1')

    const network = screen.getByRole('combobox', { name: 'Network' })
    expect(Array.from(network.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Select a network', 'default'])
  })

  // Same rule as Network.ProviderIdForVm: Incus reports it Created and nothing waits on it. A network whose delete
  // waits is Deleting.
  it('lists only the networks a VM can be created on', async () => {
    const usable = (id: string, name: string, extra = {}) => ({ ...activeNetwork, id, name, ...extra })
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([
        activeNetwork,
        usable('n2', 'leaving', { status: 'Deleting' }),
        usable('n3', 'being-made', { status: 'Creating' }),
        usable('n4', 'errored', { status: 'Errored' }),
        usable('n5', 'pending', { status: 'Pending' }),
        usable('n6', 'gone', { status: 'NotFound' }),
      ])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await chooseCluster('z1')

    const network = screen.getByRole('combobox', { name: 'Network' })
    expect(Array.from(network.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Select a network', 'default'])
  })

  it('drops the chosen network when the cluster changes to one it is not in', async () => {
    const otherClusterNetwork = { ...activeNetwork, id: 'n2', name: 'far-away', clusterId: 'z2' }
    // Two in z2, so the form picks none there (a cluster's only network is picked for the customer).
    const secondOtherClusterNetwork = { ...activeNetwork, id: 'n3', name: 'farther', clusterId: 'z2' }
    let requestBody: unknown
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, otherClusterNetwork, secondOtherClusterNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster, { id: 'z2', name: 'Cluster 2' }])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 'vm-new' }, { status: 202 })
      }),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    const clusterSelect = await screen.findByRole('combobox', { name: 'Cluster' })
    await userEvent.selectOptions(clusterSelect, 'z1')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'n1')

    await userEvent.selectOptions(clusterSelect, 'z2')

    const network = screen.getByRole('combobox', { name: 'Network' })
    expect(Array.from(network.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Select a network', 'far-away', 'farther'])
    // Template and size chosen, network not: z1's network still chosen would let the form send. The select alone
    // would read '' either way (its value is not among the options).
    await userEvent.click(await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ }))
    await userEvent.click(screen.getByRole('radio', { name: /^Medium/ }))
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    expect(await screen.findByText('Choose a cluster, network, template and size.')).toBeInTheDocument()
    expect(requestBody).toBeUndefined()
  })

  it('says the cluster has no networks when the picked cluster has none', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster, { id: 'z2', name: 'Cluster 2' }])),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await chooseCluster('z2')

    expect(screen.getByText(/no active networks in this cluster/i)).toBeInTheDocument()
  })

  it('asks for another cluster on 404 CLUSTER_NOT_FOUND', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () => HttpResponse.json({ status: 404, title: 'x', code: 'CLUSTER_NOT_FOUND' }, { status: 404 })),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseCluster('z1')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'n1')
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

    expect(await screen.findByText(/selected cluster is no longer available/i)).toBeInTheDocument()
  })

  it('shows quota exceeded error from API', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 422, title: 'Quota exceeded', code: 'VM_QUOTA_EXCEEDED' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseTheRest()
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByText('VM quota exceeded')).toBeInTheDocument())
  })

  // S3 — suspended tenant gets a clear message in the VM modal too (parity with the network
  // modal, which already handled it; the VM modal previously fell through to generic).
  it('shows a clear suspended message on 403 TENANT_SUSPENDED — S3', async () => {
    server.use(
      http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 403, title: 'Suspended', code: 'TENANT_SUSPENDED' }, { status: 403 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseTheRest()
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
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 422, title: 'Unavailable', code: 'TEMPLATE_UNAVAILABLE' }, { status: 422 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseTheRest()
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
      http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
      http.get('*/v1/templates', () => HttpResponse.json([template])),
      http.post('*/v1/tenant/vms', () =>
        HttpResponse.json({ status: 403, title: 'Pending approval', code: 'TENANT_PENDING_APPROVAL' }, { status: 403 })
      ),
    )
    renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText(/no active networks/i)).not.toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
    await chooseTheRest()
    await chooseTheRest()
    await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
    await waitFor(() => expect(screen.getByText(/awaiting admin approval/i)).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  // titan-ops features/vm/design.md#vm-create-form — where the VM goes sits on one line under the title; templates are
  // grouped by OS family; sizes are rows with their hourly price; the footer sums up the choice.
  describe('layout', () => {
    const small = { id: 's', name: 'Small', vcpu: 1, memoryMb: 2048, pricePerHour: 170 }
    const ubuntu24 = { id: 't3', name: 'Ubuntu 24.04', description: 'Ubuntu 24.04 LTS', os: 'ubuntu/24.04' }
    const rocky = { id: 't4', name: 'Rocky 9', description: 'Rocky Linux 9 application server', os: 'rockylinux/9' }
    let posts: Record<string, unknown>[]

    beforeEach(() => {
      posts = []
      server.use(
        http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork])),
        http.get('*/v1/clusters', () => HttpResponse.json([cluster])),
        http.get('*/v1/templates', () => HttpResponse.json([template])),
        http.get('*/v1/vm-offerings', () => HttpResponse.json([small, offering])),
        http.post('*/v1/tenant/vms', async ({ request }) => {
          posts.push(await request.json() as Record<string, unknown>)
          return HttpResponse.json({ vmId: 'vm-new' }, { status: 202 })
        }),
      )
    })

    function render() {
      return renderWithProviders(<MemoryRouter><VmCreateModal open onOpenChange={vi.fn()} /></MemoryRouter>)
    }

    it('shows cluster and network on one line with Change, and opens their selects on Change', async () => {
      render()

      expect(await screen.findByText('Cluster 1 · default')).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Cluster' })).not.toBeInTheDocument()
      const change = screen.getByRole('button', { name: 'Change' })
      expect(change).toHaveAttribute('aria-expanded', 'false')

      await userEvent.click(change)
      expect(screen.getByRole('combobox', { name: 'Cluster' })).toHaveValue('z1')
      expect(screen.getByRole('combobox', { name: 'Network' })).toHaveValue('n1')
      expect(change).toHaveAttribute('aria-expanded', 'true')
    })

    it('shows the cluster and network selects when there is a choice to make', async () => {
      server.use(http.get('*/v1/clusters', () => HttpResponse.json([cluster, { id: 'z2', name: 'Cluster 2' }])))
      render()

      expect(await screen.findByRole('combobox', { name: 'Cluster' })).toHaveValue('')
      expect(screen.queryByText('Cluster 1 · default')).not.toBeInTheDocument()
    })

    it('keeps the cluster and network selects open once one is changed, until Change is pressed again', async () => {
      server.use(
        http.get('*/v1/tenant/networks', () => HttpResponse.json([activeNetwork, clusterTwoNetwork])),
        http.get('*/v1/clusters', () => HttpResponse.json([cluster, { id: 'z2', name: 'Cluster 2' }])),
      )
      render()

      await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Cluster' }), 'z1')
      expect(await screen.findByText('Cluster 1 · default')).toBeInTheDocument()
      const change = screen.getByRole('button', { name: 'Change' })
      expect(change).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('combobox', { name: 'Network' })).toHaveValue('n1')

      await userEvent.click(change)
      expect(change).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('combobox', { name: 'Cluster' })).not.toBeInTheDocument()
    })

    it('groups templates by OS family and shows the family column only with two families or more', async () => {
      server.use(http.get('*/v1/templates', () => HttpResponse.json([template, ubuntu24, rocky])))
      render()

      // Families in alphabetical order; the one with the most templates is open first.
      const ubuntuFamily = await screen.findByRole('button', { name: 'Ubuntu 2' })
      const rockyFamily = screen.getByRole('button', { name: 'Rocky Linux 1' })
      expect(rockyFamily.compareDocumentPosition(ubuntuFamily) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(ubuntuFamily).toHaveAttribute('aria-pressed', 'true')
      const radios = within(screen.getByRole('radiogroup', { name: 'Template' })).getAllByRole('radio')
      expect(radios.map(radio => radio.getAttribute('value'))).toEqual(['t1', 't3'])
      expect(screen.getByText('Ubuntu 24.04 LTS')).toBeInTheDocument()

      await userEvent.click(rockyFamily)
      expect(rockyFamily).toHaveAttribute('aria-pressed', 'true')
      expect(ubuntuFamily).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('radio', { name: /^Rocky 9/ })).toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: /^Ubuntu 22\.04/ })).not.toBeInTheDocument()
    })

    it('searches templates only when there are more than six', async () => {
      const six = [template, ubuntu24, rocky, debian, { ...debian, id: 't5', name: 'Debian 11' }, { ...ubuntu24, id: 't6', name: 'Ubuntu 20.04' }]
      server.use(http.get('*/v1/templates', () => HttpResponse.json(six)))
      const first = render()
      await screen.findByRole('radiogroup', { name: 'Template' })
      expect(screen.queryByRole('searchbox', { name: 'Search templates' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Ubuntu 3' })).toBeInTheDocument()
      first.unmount()

      server.use(http.get('*/v1/templates', () => HttpResponse.json([...six, { ...rocky, id: 't7', name: 'Rocky 8' }])))
      render()
      const search = await screen.findByRole('searchbox', { name: 'Search templates' })
      await userEvent.type(search, 'rocky')
      const radios = within(screen.getByRole('radiogroup', { name: 'Template' })).getAllByRole('radio')
      expect(radios.map(radio => radio.getAttribute('value'))).toEqual(['t4', 't7'])
    })

    it('picks the only template of the cluster', async () => {
      render()

      expect(await screen.findByRole('radio', { name: /^Ubuntu 22\.04/ })).toBeChecked()
      expect(screen.queryByRole('button', { name: 'Ubuntu 1' })).not.toBeInTheDocument()
      await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
      await userEvent.click(screen.getByRole('radio', { name: /^Small/ }))
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))

      await waitFor(() => expect(posts).toHaveLength(1))
      expect(posts[0]).toMatchObject({ clusterId: 'z1', networkId: 'n1', templateId: 't1', vmOfferingId: 's' })
    })

    it('lists sizes with vCPU, RAM and hourly price, none picked', async () => {
      render()

      const sizes = await screen.findByRole('radiogroup', { name: 'Size' })
      const smallRow = within(sizes).getByRole('radio', { name: /^Small/ })
      expect(within(sizes).getAllByRole('radio').some(radio => (radio as HTMLInputElement).checked)).toBe(false)
      expect(smallRow).toHaveAccessibleName('Small 1 vCPU 2 GB RAM 170 ₫/hour')
      expect(within(sizes).getByRole('radio', { name: /^Medium/ })).toHaveAccessibleName('Medium 2 vCPU 4 GB RAM 311.256 ₫/hour')
    })

    it('sums up template, size and hourly price in the footer', async () => {
      render()

      const summary = await screen.findByRole('status')
      await waitFor(() => expect(summary).toHaveTextContent('Ubuntu 22.04'))
      expect(summary).not.toHaveTextContent('₫')
      await userEvent.click(screen.getByRole('radio', { name: /^Medium/ }))
      expect(summary).toHaveTextContent('Ubuntu 22.04 · Medium · 311.256 ₫/hour')
    })

    it('opens the SSH key list from its button and counts the picked keys', async () => {
      server.use(http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([laptopKey, desktopKey])))
      render()

      const button = await screen.findByRole('button', { name: /^SSH keys/ })
      await waitFor(() => expect(button).toHaveTextContent('None picked'))
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

      await userEvent.click(button)
      await userEvent.click(screen.getByRole('checkbox', { name: /laptop/ }))
      await userEvent.click(screen.getByRole('checkbox', { name: /desktop/ }))
      expect(button).toHaveTextContent('2 picked')

      await userEvent.type(screen.getByPlaceholderText(/e\.g\. web/i), 'my-vm')
      await userEvent.click(screen.getByRole('radio', { name: /^Small/ }))
      await userEvent.click(screen.getByRole('button', { name: /create vm/i }))
      await waitFor(() => expect(posts).toHaveLength(1))
      expect(posts[0].sshKeyIds).toEqual(['k1', 'k2'])
    })
  })
})
