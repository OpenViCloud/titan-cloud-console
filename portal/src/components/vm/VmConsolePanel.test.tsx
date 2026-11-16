import { useState } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VmConsolePanel } from './VmConsolePanel'

// jsdom draws no canvas, so the terminal is a stand-in that records what the panel wrote to it and lets the test type
// and resize; the websocket is a stand-in the test opens, feeds and closes as the server would.
const xterm = vi.hoisted(() => {
  class FakeTerminal {
    cols = 80
    rows = 24
    written: (string | Uint8Array)[] = []
    parent: HTMLElement | null = null
    focused = false
    disposed = false
    private dataListeners: ((data: string) => void)[] = []
    private resizeListeners: ((size: { cols: number; rows: number }) => void)[] = []
    loadAddon() {}
    parentWasShown = false
    open(parent: HTMLElement) {
      this.parent = parent
      this.parentWasShown = !parent.classList.contains('hidden')
    }
    write(data: string | Uint8Array) {
      this.written.push(data)
    }
    focus() {
      this.focused = true
    }
    dispose() {
      this.disposed = true
    }
    onData(listener: (data: string) => void) {
      this.dataListeners.push(listener)
      return { dispose() {} }
    }
    onResize(listener: (size: { cols: number; rows: number }) => void) {
      this.resizeListeners.push(listener)
      return { dispose() {} }
    }
    type(data: string) {
      this.dataListeners.forEach(listener => listener(data))
    }
    resizeTo(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      this.resizeListeners.forEach(listener => listener({ cols, rows }))
    }
  }
  const terminals: FakeTerminal[] = []
  return { FakeTerminal, terminals }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class extends xterm.FakeTerminal {
    constructor() {
      super()
      xterm.terminals.push(this)
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static sockets: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  sent: (string | Uint8Array)[] = []
  closedBy: number | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.sockets.push(this)
  }
  send(data: string | Uint8Array) {
    this.sent.push(data)
  }
  // The answer to a client close is the server's: a test that needs one calls serverClose.
  close(code?: number) {
    this.closedBy = code ?? 1005
    this.readyState = FakeWebSocket.CLOSING
  }
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  receive(data: string | ArrayBuffer) {
    this.onmessage?.({ data })
  }
  serverClose(code: number, reason: string) {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return
    }
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

const runningVm = { id: 'vm-1', status: 'Running', requestFailureReason: null }

let tickets: unknown[] = []

// The page re-renders the panel with each VM list refresh; this stands in for a VM whose status the test moves.
function VmWhoseStatusChanges() {
  const [status, setStatus] = useState('Running')
  return (
    <>
      <button type="button" onClick={() => setStatus('Stopped')}>VM stops</button>
      <button type="button" onClick={() => setStatus('Running')}>VM runs</button>
      <VmConsolePanel vm={{ ...runningVm, status }} />
    </>
  )
}

function acceptTickets() {
  server.use(http.post('*/v1/tenant/vms/vm-1/console-tickets', async ({ request }) => {
    tickets.push(await request.json())
    return new HttpResponse(null, { status: 204 })
  }))
}

async function connect() {
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(FakeWebSocket.sockets).toHaveLength(1))
  return FakeWebSocket.sockets[0]
}

describe('VmConsolePanel', () => {
  beforeEach(() => {
    FakeWebSocket.sockets = []
    xterm.terminals.length = 0
    tickets = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('says how to log in and waits for Connect: a session counts toward the tenant\'s five', () => {
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    expect(screen.getByText(/Log in as ubuntu with the console password set when the VM was created/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
    expect(FakeWebSocket.sockets).toHaveLength(0)
  })

  it('gives the server a fresh ticket, then opens the console websocket with that ticket', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const socket = await connect()

    expect(tickets).toHaveLength(1)
    const { ticket } = tickets[0] as { ticket: string }
    expect(ticket).toMatch(/^ovct_[A-Za-z0-9_-]{43}$/)
    expect(socket.url).toBe(`ws://localhost:5299/v1/tenant/vms/vm-1/console?ticket=${ticket}`)
    expect(socket.binaryType).toBe('arraybuffer')
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
  })

  it('once open: sends the terminal size, shows what the VM writes, and sends keystrokes as bytes', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const socket = await connect()
    const terminal = xterm.terminals[0]
    expect(terminal.parentWasShown).toBe(true)

    act(() => socket.open())
    expect(JSON.parse(socket.sent[0] as string)).toEqual({ type: 'resize', cols: 80, rows: 24 })
    expect(terminal.focused).toBe(true)
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()

    act(() => socket.receive(new TextEncoder().encode('Ubuntu 24.04 LTS\r\nlogin: ').buffer))
    expect(new TextDecoder().decode(terminal.written[0] as Uint8Array)).toBe('Ubuntu 24.04 LTS\r\nlogin: ')

    act(() => terminal.type('ubuntu\r'))
    const keystrokes = socket.sent[1]
    expect(ArrayBuffer.isView(keystrokes)).toBe(true) // a binary frame; a string would go as a text frame
    expect(new TextDecoder().decode(keystrokes as Uint8Array)).toBe('ubuntu\r')

    act(() => terminal.resizeTo(132, 43))
    expect(JSON.parse(socket.sent[2] as string)).toEqual({ type: 'resize', cols: 132, rows: 43 })
  })

  it('says why the server closed the console, keeps the terminal, and offers Reconnect', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const socket = await connect()
    act(() => socket.open())

    act(() => socket.serverClose(4422, 'VM_CONSOLE_BUSY'))

    expect(screen.getByText('Another console session is open on this VM. Close it, then connect again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
    expect(xterm.terminals[0].disposed).toBe(false)
  })

  it('reconnects with a new ticket into the same terminal', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const first = await connect()
    act(() => first.open())
    act(() => first.serverClose(1000, 'idle'))
    expect(screen.getByText('The session closed after 30 minutes without activity.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(FakeWebSocket.sockets).toHaveLength(2))

    const [firstTicket, secondTicket] = tickets as { ticket: string }[]
    expect(secondTicket.ticket).not.toBe(firstTicket.ticket)
    expect(xterm.terminals).toHaveLength(1)
  })

  it('Disconnect closes the websocket and says the session ended', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const socket = await connect()
    act(() => socket.open())

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(socket.closedBy).toBe(1000)
    // The close that comes back need not be a clean 1000 once a proxy sits between: it still reads as ended.
    act(() => socket.serverClose(1005, ''))

    expect(screen.getByText('The session ended.')).toBeInTheDocument()
  })

  it('says the session could not open when the websocket closes before it opened', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const socket = await connect()

    act(() => socket.serverClose(1006, ''))

    expect(screen.getByText('The session could not open. Connect again.')).toBeInTheDocument()
  })

  it('says the session limit when the server refuses the ticket, and opens no websocket', async () => {
    server.use(http.post('*/v1/tenant/vms/vm-1/console-tickets', () =>
      HttpResponse.json({ code: 'VM_SESSION_LIMIT_REACHED', status: 422 }, { status: 422 })))
    renderWithProviders(<VmConsolePanel vm={runningVm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(
      screen.getByText('You already have 5 SSH or console sessions open. Close one, then connect again.'),
    ).toBeInTheDocument())
    expect(FakeWebSocket.sockets).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('closes the websocket and the terminal when the tab closes', async () => {
    acceptTickets()
    const { unmount } = renderWithProviders(<VmConsolePanel vm={runningVm} />)
    const socket = await connect()
    act(() => socket.open())

    unmount()

    expect(socket.closedBy).toBe(1000)
    expect(xterm.terminals[0].disposed).toBe(true)
  })

  it('after the VM stops and runs again, reconnects into the terminal the last session wrote to', async () => {
    acceptTickets()
    renderWithProviders(<VmWhoseStatusChanges />)
    const first = await connect()
    act(() => first.open())
    act(() => first.serverClose(1000, 'the session ended'))

    await userEvent.click(screen.getByRole('button', { name: 'VM stops' }))
    expect(screen.getByText('The console opens while the VM is running.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'VM runs' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(FakeWebSocket.sockets).toHaveLength(2))
    expect(xterm.terminals).toHaveLength(1)
    expect(screen.getByLabelText('VM console terminal')).toBe(xterm.terminals[0].parent)
  })

  it('offers no console while the VM does not run', () => {
    renderWithProviders(<VmConsolePanel vm={{ ...runningVm, status: 'Stopped' }} />)
    expect(screen.getByText('The console opens while the VM is running.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('speaks Vietnamese', async () => {
    acceptTickets()
    renderWithProviders(<VmConsolePanel vm={runningVm} />, { lang: 'vi' })
    expect(screen.getByText(/Đăng nhập bằng user ubuntu/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kết nối' }))
    await waitFor(() => expect(FakeWebSocket.sockets).toHaveLength(1))
    const socket = FakeWebSocket.sockets[0]
    act(() => socket.open())
    act(() => socket.serverClose(4422, 'VM_CONSOLE_UNAVAILABLE'))
    expect(screen.getByText('Console của VM này hiện không dùng được.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kết nối lại' })).toBeInTheDocument()
  })
})
