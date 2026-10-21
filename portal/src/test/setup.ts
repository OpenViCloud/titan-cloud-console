import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setConfig } from '@/lib/config'
import { server } from './server'

beforeAll(() => {
  setConfig({
    keycloakUrl: 'http://localhost:8080',
    keycloakRealm: 'titan',
    keycloakClientId: 'titan-portal',
    apiBaseUrl: 'http://localhost:5299',
  })
  server.listen({ onUnhandledRequest: 'warn' })
})
// docs/architecture/http-contract.md#idempotency-key guard: the server refuses a create without an Idempotency-Key, so a portal create that
// forgets it would work in every test (MSW answers anything) and fail on the real server. Every POST
// to one of the create routes seen during a test must carry the header, or the test fails.
const CREATE_ROUTES = [
  /\/v1\/tenant\/vms$/, /\/v1\/tenant\/networks$/, /\/v1\/tenant\/networks\/[^/]+\/firewall-rules$/,
  /\/v1\/tenant\/volumes$/, /\/v1\/tenant\/vms\/[^/]+\/snapshots$/, /\/v1\/tenant\/volumes\/[^/]+\/snapshots$/,
  /\/v1\/tenant\/volumes\/[^/]+\/snapshots\/[^/]+\/restore$/, /\/v1\/tenant\/topups$/, /\/v1\/admin\/topups\/grant$/,
  /\/v1\/tenant\/ssh-keys$/, /\/v1\/tenant\/load-balancers$/,
]
const createsWithoutKey: string[] = []
server.events.on('request:start', ({ request }) => {
  const path = new URL(request.url).pathname
  const isCreate = request.method === 'POST' && CREATE_ROUTES.some(route => route.test(path))
  const hasKey = request.headers.get('Idempotency-Key') !== null
  if (isCreate && !hasKey) {
    createsWithoutKey.push(path)
  }
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  const missed = createsWithoutKey.splice(0)
  if (missed.length > 0) {
    throw new Error(`create POST without Idempotency-Key (docs/architecture/http-contract.md#idempotency-key): ${missed.join(', ')}`)
  }
})
afterAll(() => server.close())
