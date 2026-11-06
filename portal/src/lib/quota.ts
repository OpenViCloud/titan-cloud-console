// What the quota card counts as used. A copy of the server rules Vm.OccupiesQuota, Network.OccupiesQuota and
// Volume.OccupiesQuota (OpenViCloud/titan-control-plane, Titan.Domain). A network or volume counts when it is wanted
// (desired Exists) and Incus holds it, or its create still waits. The server keys "waits" on a pending request id the API does not
// expose; `transition` is non-null exactly while a request waits. Accepted risk: this copy can drift from the
// server's.
export interface QuotaFields {
  desiredExistence: string
  currentExistence: string
  transition: string | null
}

export function occupiesQuota(resource: QuotaFields): boolean {
  if (resource.desiredExistence !== 'Exists') {
    return false
  }
  if (resource.currentExistence === 'Exists') {
    return true
  }
  return resource.currentExistence === 'NotCreated' && resource.transition !== null
}

// A VM has one status: it counts while its create waits or Incus holds its instance, until its delete is asked
// (titan-ops features/vm/design.md#counting-and-billing).
const VM_STATUSES_OUTSIDE_QUOTA = new Set(['Deleting', 'Deleted', 'NotFound', 'Failed'])

export function vmOccupiesQuota(vm: { status: string }): boolean {
  return !VM_STATUSES_OUTSIDE_QUOTA.has(vm.status)
}
