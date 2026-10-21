import { describe, expect, it } from 'vitest'
import {
  canDeleteLoadBalancer,
  canEditLoadBalancer,
  isBackendCandidate,
  listenerLabel,
  loadBalancerLabel,
  pollWhileLoadBalancersWait,
  specProblem,
} from './loadBalancerState'

const lb = (extra = {}) => ({
  currentExistence: 'Exists', desiredExistence: 'Exists', transition: null as string | null,
  requestFailureReason: null as string | null, ...extra,
})

describe('loadBalancerLabel', () => {
  it('names the waiting request first, then why Incus has none, else Active', () => {
    expect(loadBalancerLabel(lb())).toBe('Active')
    expect(loadBalancerLabel(lb({ transition: 'Updating' }))).toBe('Updating')
    expect(loadBalancerLabel(lb({ currentExistence: 'NotCreated', transition: 'Creating' }))).toBe('Creating')
    expect(loadBalancerLabel(lb({ currentExistence: 'NotFound' }))).toBe('Not found')
    expect(loadBalancerLabel(lb({ currentExistence: 'NotCreated', requestFailureReason: 'x' }))).toBe('Failed')
    expect(loadBalancerLabel(lb({ currentExistence: 'Deleted', desiredExistence: 'Deleted' }))).toBe('Deleted')
  })
})

// LoadBalancer.RequestUpdate: on Incus, nothing waiting.
describe('canEditLoadBalancer', () => {
  it('is on only for a load balancer resting on Incus', () => {
    expect(canEditLoadBalancer(lb())).toBe(true)
    for (const transition of ['Creating', 'Updating', 'Deleting']) {
      expect(canEditLoadBalancer(lb({ transition }))).toBe(false)
    }
    expect(canEditLoadBalancer(lb({ currentExistence: 'NotFound' }))).toBe(false)
    expect(canEditLoadBalancer(lb({ currentExistence: 'NotCreated', requestFailureReason: 'x' }))).toBe(false)
  })
})

// LoadBalancer.RequestDelete: a delete replaces a waiting update; a waiting create or delete refuses it; a failed
// create is deleted where it stands.
describe('canDeleteLoadBalancer', () => {
  it('is off while a create or a delete waits, and once deleted', () => {
    expect(canDeleteLoadBalancer(lb())).toBe(true)
    expect(canDeleteLoadBalancer(lb({ transition: 'Updating' }))).toBe(true)
    expect(canDeleteLoadBalancer(lb({ currentExistence: 'NotFound' }))).toBe(true)
    expect(canDeleteLoadBalancer(lb({ currentExistence: 'NotCreated', requestFailureReason: 'x' }))).toBe(true)
    expect(canDeleteLoadBalancer(lb({ transition: 'Creating' }))).toBe(false)
    expect(canDeleteLoadBalancer(lb({ transition: 'Deleting' }))).toBe(false)
    expect(canDeleteLoadBalancer(lb({ currentExistence: 'Deleted', desiredExistence: 'Deleted' }))).toBe(false)
  })
})

describe('pollWhileLoadBalancersWait', () => {
  it('polls while any row has a request waiting, and stops after', () => {
    expect(pollWhileLoadBalancersWait(undefined)).toBe(false)
    expect(pollWhileLoadBalancersWait([lb(), lb()])).toBe(false)
    expect(pollWhileLoadBalancersWait([lb(), lb({ transition: 'Updating' })])).toBeGreaterThan(0)
  })
})

describe('listenerLabel', () => {
  it('reads protocol, port and target port', () => {
    expect(listenerLabel({ protocol: 'TCP', port: 80, targetPort: 8080 })).toBe('TCP 80 → 8080')
  })
})

// Vm.BeginLoadBalancerBackend: on the load balancer's network, on Incus, not being deleted.
describe('isBackendCandidate', () => {
  const vm = (extra = {}) => ({ networkId: 'net-6', currentExistence: 'Exists', desiredExistence: 'Exists', ...extra })
  it('takes a VM of the network that Incus holds and nobody is deleting', () => {
    expect(isBackendCandidate(vm(), 'net-6')).toBe(true)
    expect(isBackendCandidate(vm({ networkId: 'net-other' }), 'net-6')).toBe(false)
    expect(isBackendCandidate(vm({ currentExistence: 'NotCreated' }), 'net-6')).toBe(false)
    expect(isBackendCandidate(vm({ desiredExistence: 'Deleted' }), 'net-6')).toBe(false)
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
