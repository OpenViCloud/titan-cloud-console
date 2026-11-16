import { describe, expect, it } from 'vitest'
import { closeMessage, consoleSocketUrl, newConsoleTicket, resizeFrame, ticketErrorMessage } from './consoleSession'

describe('console ticket', () => {
  it('is ovct_ and 43 base64url characters, the shape the server accepts', () => {
    expect(newConsoleTicket()).toMatch(/^ovct_[A-Za-z0-9_-]{43}$/)
  })

  it('is new each time', () => {
    const tickets = new Set(Array.from({ length: 50 }, () => newConsoleTicket()))
    expect(tickets.size).toBe(50)
  })

  it('writes the 32 random bytes as base64url without padding', () => {
    const bytes = new Uint8Array(32).fill(0xff)
    expect(newConsoleTicket(bytes)).toBe(`ovct_${'_'.repeat(42)}8`)
    expect(newConsoleTicket(new Uint8Array(32))).toBe(`ovct_${'A'.repeat(43)}`)
  })
})

describe('console websocket address', () => {
  it('is wss for an https API and carries the ticket in the query', () => {
    expect(consoleSocketUrl('https://api.openvicloud.com', 'vm-1', 'ovct_abc'))
      .toBe('wss://api.openvicloud.com/v1/tenant/vms/vm-1/console?ticket=ovct_abc')
  })

  it('is ws for an http API, and a trailing slash adds no empty segment', () => {
    expect(consoleSocketUrl('http://api.localhost:8080/', 'vm-1', 'ovct_abc'))
      .toBe('ws://api.localhost:8080/v1/tenant/vms/vm-1/console?ticket=ovct_abc')
  })
})

describe('resize frame', () => {
  it('is the JSON text the server reads as a new terminal size', () => {
    expect(JSON.parse(resizeFrame(120, 40))).toEqual({ type: 'resize', cols: 120, rows: 40 })
  })
})

describe('message when the ticket is refused', () => {
  it('says the session limit, the VM status, or a general failure', () => {
    expect(ticketErrorMessage('VM_SESSION_LIMIT_REACHED')).toBe('sessionLimit')
    expect(ticketErrorMessage('VM_INVALID_STATUS')).toBe('notRunningNow')
    expect(ticketErrorMessage('INTERNAL_ERROR')).toBe('couldNotStart')
    expect(ticketErrorMessage(undefined)).toBe('couldNotStart')
  })
})

describe('message when the websocket closes', () => {
  it('says the session never opened when it closed before open', () => {
    expect(closeMessage(false, 1006, '')).toBe('notOpened')
  })

  it('names the reason the server refused the console with', () => {
    expect(closeMessage(true, 4422, 'VM_CONSOLE_BUSY')).toBe('busy')
    expect(closeMessage(true, 4422, 'VM_CONSOLE_UNAVAILABLE')).toBe('unavailable')
    expect(closeMessage(true, 4422, 'VM_SESSION_LIMIT_REACHED')).toBe('sessionLimit')
    expect(closeMessage(true, 4422, 'VM_INVALID_STATUS')).toBe('notRunningNow')
    expect(closeMessage(true, 4403, 'TENANT_SUSPENDED')).toBe('accountNotActive')
    expect(closeMessage(true, 4403, 'TENANT_PENDING_APPROVAL')).toBe('accountNotActive')
    expect(closeMessage(true, 4503, 'CLUSTER_UNREACHABLE')).toBe('clusterUnreachable')
  })

  it('says idle after 30 minutes without activity, and ended on a normal close', () => {
    expect(closeMessage(true, 1000, 'idle')).toBe('idle')
    expect(closeMessage(true, 1000, 'the session ended')).toBe('ended')
  })

  it('falls back to a general message for anything else', () => {
    expect(closeMessage(true, 4500, 'INTERNAL_ERROR')).toBe('closedUnexpectedly')
    expect(closeMessage(true, 4404, 'VM_NOT_FOUND')).toBe('closedUnexpectedly')
    expect(closeMessage(true, 1006, '')).toBe('closedUnexpectedly')
  })
})
