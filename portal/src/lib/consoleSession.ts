// titan-ops features/vm/design.md#vm-console — a browser cannot put a token on a websocket, so the portal makes a
// one-time ticket, gives it to the server with the token, then opens the websocket with the ticket in its address.

import type { Messages } from '@/i18n/en'

export type ConsoleMessage = keyof Messages['vmConsole']

const TICKET_BYTES = 32

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** `ovct_` and 43 base64url characters: 32 random bytes, the shape the server accepts. */
export function newConsoleTicket(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(TICKET_BYTES))): string {
  return `ovct_${base64Url(bytes)}`
}

export function consoleSocketUrl(apiBaseUrl: string, vmId: string, ticket: string): string {
  const url = new URL(`v1/tenant/vms/${encodeURIComponent(vmId)}/console`, apiBaseUrl.replace(/\/*$/, '/'))
  if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  } else {
    url.protocol = 'ws:'
  }
  url.searchParams.set('ticket', ticket)
  return url.toString()
}

/** The text frame the server reads as a new terminal size; keystrokes go as binary frames. */
export function resizeFrame(cols: number, rows: number): string {
  return JSON.stringify({ type: 'resize', cols, rows })
}

export function ticketErrorMessage(code: string | undefined): ConsoleMessage {
  if (code === 'VM_SESSION_LIMIT_REACHED') {
    return 'sessionLimit'
  }
  if (code === 'VM_INVALID_STATUS') {
    return 'notRunningNow'
  }
  return 'couldNotStart'
}

// A refusal after the upgrade closes with 4000 + its HTTP status and the error code as the reason; the relay ends a
// session with a normal close, `idle` after 30 minutes without activity.
const REFUSALS: Record<string, ConsoleMessage> = {
  VM_CONSOLE_BUSY: 'busy',
  VM_CONSOLE_UNAVAILABLE: 'unavailable',
  VM_SESSION_LIMIT_REACHED: 'sessionLimit',
  VM_INVALID_STATUS: 'notRunningNow',
  TENANT_SUSPENDED: 'accountNotActive',
  TENANT_PENDING_APPROVAL: 'accountNotActive',
}

const NORMAL_CLOSURE = 1000
// 4000 + 503: the server could not use the VM's cluster (every CLUSTER_* code but CLUSTER_NOT_FOUND).
const CLUSTER_UNAVAILABLE = 4503

export function closeMessage(opened: boolean, code: number, reason: string): ConsoleMessage {
  if (!opened) {
    return 'notOpened'
  }
  const refusal = REFUSALS[reason]
  if (refusal !== undefined) {
    return refusal
  }
  if (code === CLUSTER_UNAVAILABLE) {
    return 'clusterUnreachable'
  }
  if (code === NORMAL_CLOSURE && reason === 'idle') {
    return 'idle'
  }
  if (code === NORMAL_CLOSURE) {
    return 'ended'
  }
  return 'closedUnexpectedly'
}
