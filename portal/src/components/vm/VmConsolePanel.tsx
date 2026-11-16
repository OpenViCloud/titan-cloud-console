import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/LanguageContext'
import { api } from '@/lib/api'
import { getConfig } from '@/lib/config'
import {
  closeMessage, consoleSocketUrl, newConsoleTicket, resizeFrame, ticketErrorMessage, type ConsoleMessage,
} from '@/lib/consoleSession'
import { runsAGuest, type VmStateFields } from '@/lib/vmState'

// titan-ops features/vm/design.md#console-tab — the VM's serial console in the browser. It never connects by itself:
// every session counts toward the tenant's five SSH and console sessions.

type Phase = 'idle' | 'connecting' | 'connected' | 'closed'

const NORMAL_CLOSURE = 1000

function sendWhenOpen(socket: WebSocket | null, data: string | Uint8Array<ArrayBuffer>) {
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(data)
  }
}

export function VmConsolePanel({ vm }: { vm: VmStateFields & { id: string } }) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<ConsoleMessage | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const disconnectedRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    const fitToWindow = () => fitRef.current?.fit()
    window.addEventListener('resize', fitToWindow)
    return () => {
      unmountedRef.current = true
      window.removeEventListener('resize', fitToWindow)
      const socket = socketRef.current
      if (socket !== null) {
        socket.onclose = null
        socket.close(NORMAL_CLOSURE)
        socketRef.current = null
      }
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [])

  // One terminal for the life of the tab: a reconnect keeps what the last session showed. It opens once its screen is
  // shown, since xterm measures the character size when it opens.
  useLayoutEffect(() => {
    if (phase === 'idle' || terminalRef.current !== null || screenRef.current === null) {
      return
    }
    const created = new Terminal({ cursorBlink: true })
    const fit = new FitAddon()
    created.loadAddon(fit)
    created.open(screenRef.current)
    const encoder = new TextEncoder()
    created.onData(data => sendWhenOpen(socketRef.current, encoder.encode(data)))
    created.onResize(({ cols, rows }) => sendWhenOpen(socketRef.current, resizeFrame(cols, rows)))
    terminalRef.current = created
    fitRef.current = fit
  }, [phase])

  async function connect() {
    setPhase('connecting')
    setMessage(null)
    disconnectedRef.current = false
    const ticket = newConsoleTicket()
    try {
      await api.post(`/v1/tenant/vms/${vm.id}/console-tickets`, { ticket })
    } catch (error) {
      let code: string | undefined
      if (isAxiosError(error)) {
        code = error.response?.data?.code
      }
      setMessage(ticketErrorMessage(code))
      setPhase(socketRef.current === null ? 'idle' : 'closed')
      return
    }

    // The tab closed while the ticket was on its way: a websocket opened now would hold a place nobody can close.
    if (unmountedRef.current) {
      return
    }
    const socket = new WebSocket(consoleSocketUrl(getConfig().apiBaseUrl, vm.id, ticket))
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    let opened = false
    socket.onopen = () => {
      opened = true
      setPhase('connected')
      const term = terminalRef.current
      if (term !== null) {
        fitRef.current?.fit()
        socket.send(resizeFrame(term.cols, term.rows))
        term.focus()
      }
    }
    socket.onmessage = event => {
      if (typeof event.data === 'string') {
        terminalRef.current?.write(event.data)
      } else {
        terminalRef.current?.write(new Uint8Array(event.data as ArrayBuffer))
      }
    }
    socket.onclose = event => {
      // After Disconnect the session ended by the customer's hand, whatever code the close comes back with.
      if (disconnectedRef.current) {
        setMessage('ended')
      } else {
        setMessage(closeMessage(opened, event.code, event.reason))
      }
      setPhase('closed')
    }
  }

  function disconnect() {
    disconnectedRef.current = true
    socketRef.current?.close(NORMAL_CLOSURE)
  }

  // A session already open keeps its terminal until the server ends it; the screen stays mounted so a reconnect after
  // the VM runs again writes into the same terminal.
  const offered = runsAGuest(vm) || phase === 'connecting' || phase === 'connected'

  let action = (
    <Button size="sm" onClick={() => void connect()}>
      {phase === 'closed' ? t.vmConsole.reconnect : t.vmConsole.connect}
    </Button>
  )
  if (phase === 'connecting') {
    action = <Button size="sm" disabled>{t.vmConsole.connecting}</Button>
  }
  if (phase === 'connected') {
    action = (
      <Button size="sm" variant="outline" onClick={disconnect}>
        {t.vmConsole.disconnect}
      </Button>
    )
  }

  return (
    <section aria-label={t.vmConsole.title} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{t.vmConsole.title}</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {offered ? t.vmConsole.loginHint : t.vmConsole.notRunning}
          </p>
          {message !== null && (
            <p role="status" className="mt-2 text-[13px] font-medium">{t.vmConsole[message]}</p>
          )}
        </div>
        {offered && action}
      </div>
      <div
        ref={screenRef}
        aria-label={t.vmConsole.terminal}
        className={phase === 'idle' ? 'hidden' : 'h-[480px] border-t border-border bg-terminal p-2'}
      />
    </section>
  )
}
