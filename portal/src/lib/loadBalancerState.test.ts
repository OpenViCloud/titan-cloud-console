import { describe, expect, it } from 'vitest'
import {
  canDeleteLoadBalancer,
  canEditLoadBalancer,
  isBackendCandidate,
  listenerLabel,
  loadBalancerLabel,
  loadBalancerRequestFailureNote,
  pollWhileLoadBalancersWait,
  specProblem,
} from './loadBalancerState'

const lb = (extra = {}) => ({
  status: 'Available', requestFailureReason: null as string | null, ...extra,
})

describe('loadBalancerLabel', () => {
  it('names each status the server sends; a load balancer at rest on Incus reads Active', () => {
    expect(loadBalancerLabel(lb())).toBe('Active')
    expect(loadBalancerLabel(lb({ status: 'Creating' }))).toBe('Creating')
    expect(loadBalancerLabel(lb({ status: 'Updating' }))).toBe('Updating')
    expect(loadBalancerLabel(lb({ status: 'Deleting' }))).toBe('Deleting')
    expect(loadBalancerLabel(lb({ status: 'NotFound' }))).toBe('Not found')
    expect(loadBalancerLabel(lb({ status: 'Failed', requestFailureReason: 'x' }))).toBe('Failed')
    expect(loadBalancerLabel(lb({ status: 'Deleted' }))).toBe('Deleted')
  })

  // A status this page does not know yet shows as the server spelled it rather than as Active.
  it('shows a status it does not know as the server spelled it', () => {
    expect(loadBalancerLabel(lb({ status: 'Quarantined' }))).toBe('Quarantined')
  })
})

// A request that gave up leaves the load balancer as Incus holds it; the reason shows only while nothing waits.
describe('loadBalancerRequestFailureNote', () => {
  it('is the server reason while nothing waits, and null while a request waits', () => {
    expect(loadBalancerRequestFailureNote(lb({ requestFailureReason: 'Load balancer change failed.' })))
      .toBe('Load balancer change failed.')
    expect(loadBalancerRequestFailureNote(lb({ requestFailureReason: 'old', status: 'Updating' }))).toBeNull()
    expect(loadBalancerRequestFailureNote(lb())).toBeNull()
  })
})

// LoadBalancer.RequestUpdate: on Incus, nothing waiting.
describe('canEditLoadBalancer', () => {
  it('is on only for a load balancer resting on Incus', () => {
    expect(canEditLoadBalancer(lb())).toBe(true)
    for (const status of ['Creating', 'Updating', 'Deleting', 'NotFound', 'Failed', 'Deleted']) {
      expect(canEditLoadBalancer(lb({ status }))).toBe(false)
    }
  })
})

// LoadBalancer.RequestDelete: a delete replaces a waiting update; a waiting create or delete refuses it; a failed
// create is deleted where it stands.
describe('canDeleteLoadBalancer', () => {
  it('is off while a create or a delete waits, and once deleted', () => {
    expect(canDeleteLoadBalancer(lb())).toBe(true)
    expect(canDeleteLoadBalancer(lb({ status: 'Updating' }))).toBe(true)
    expect(canDeleteLoadBalancer(lb({ status: 'NotFound' }))).toBe(true)
    expect(canDeleteLoadBalancer(lb({ status: 'Failed', requestFailureReason: 'x' }))).toBe(true)
    expect(canDeleteLoadBalancer(lb({ status: 'Creating' }))).toBe(false)
    expect(canDeleteLoadBalancer(lb({ status: 'Deleting' }))).toBe(false)
    expect(canDeleteLoadBalancer(lb({ status: 'Deleted' }))).toBe(false)
  })
})

describe('pollWhileLoadBalancersWait', () => {
  it('polls while any row has a request waiting, and stops after', () => {
    expect(pollWhileLoadBalancersWait(undefined)).toBe(false)
    expect(pollWhileLoadBalancersWait([lb(), lb()])).toBe(false)
    expect(pollWhileLoadBalancersWait([lb(), lb({ status: 'Updating' })])).toBeGreaterThan(0)
    expect(pollWhileLoadBalancersWait([lb(), lb({ status: 'NotFound' }), lb({ status: 'Failed' })])).toBe(false)
  })
})

describe('listenerLabel', () => {
  it('reads protocol, port and target port', () => {
    expect(listenerLabel({ protocol: 'TCP', port: 80, targetPort: 8080 })).toBe('TCP 80 → 8080')
  })
})

// Vm.EnsureLoadBalancerCanSendTo: on the load balancer's network, on Incus, not being deleted.
describe('isBackendCandidate', () => {
  const vm = (extra = {}) => ({ networkId: 'net-6' as string | null, status: 'Running', ...extra })
  it('takes a VM of the network that Incus holds and nobody is deleting', () => {
    for (const status of ['Running', 'Ready', 'Stopped', 'Frozen', 'Error', 'Starting', 'Stopping', 'Snapshotting']) {
      expect(isBackendCandidate(vm({ status }), 'net-6')).toBe(true)
    }
    for (const status of ['Creating', 'Deleting', 'Unknown', 'NotFound', 'Failed', 'Deleted']) {
      expect(isBackendCandidate(vm({ status }), 'net-6')).toBe(false)
    }
    expect(isBackendCandidate(vm({ networkId: 'net-other' }), 'net-6')).toBe(false)
    expect(isBackendCandidate(vm({ networkId: null }), 'net-6')).toBe(false)
  })
})

// The server's validators (Endpoints/LoadBalancer/LoadBalancerSpecRules.cs, CreateLoadBalancerValidator.cs).
describe('specProblem', () => {
  const http = { protocol: 'TCP', port: 80, targetPort: 8080 }
  const ok = { name: 'web-lb', listeners: [http], backendCount: 1 }

  it('accepts a valid configuration', () => {
    expect(specProblem(ok)).toBeNull()
    expect(specProblem({ ...ok, listeners: [http, { protocol: 'UDP', port: 80, targetPort: 80 }] })).toBeNull()
    expect(specProblem({ ...ok, name: 'a'.repeat(100) })).toBeNull()
  })

  it('names the first rule a configuration breaks', () => {
    expect(specProblem({ ...ok, name: '' })).toBe('nameRequired')
    expect(specProblem({ ...ok, name: '-web' })).toBe('nameInvalid')
    expect(specProblem({ ...ok, name: 'web lb' })).toBe('nameInvalid')
    expect(specProblem({ ...ok, name: 'a'.repeat(101) })).toBe('nameInvalid')
    expect(specProblem({ ...ok, listeners: [] })).toBe('listenerCount')
    expect(specProblem({ ...ok, listeners: Array.from({ length: 11 }, (_, i) => ({ ...http, port: i + 1 })) })).toBe('listenerCount')
    expect(specProblem({ ...ok, listeners: [{ ...http, port: 0 }] })).toBe('portRange')
    expect(specProblem({ ...ok, listeners: [{ ...http, targetPort: 65536 }] })).toBe('portRange')
    expect(specProblem({ ...ok, listeners: [{ ...http, port: Number.NaN }] })).toBe('portRange')
    expect(specProblem({ ...ok, listeners: [http, { ...http, targetPort: 9090 }] })).toBe('listenerRepeated')
    expect(specProblem({ ...ok, backendCount: 0 })).toBe('backendCount')
    expect(specProblem({ ...ok, backendCount: 21 })).toBe('backendCount')
  })

  it('does not check the name when editing, where it cannot change', () => {
    expect(specProblem({ ...ok, name: null })).toBeNull()
  })
})
