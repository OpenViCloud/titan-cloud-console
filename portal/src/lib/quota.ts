// What the quota card counts as used. A copy of the server rule in VmRepository / NetworkRepository /
// VolumeRepository.CountActiveByTenantAsync: the resource is wanted (desired Exists) and Incus holds it, or its
// create still waits. The server keys "waits" on a pending request id the API does not expose; `transition` is
// non-null exactly while a request waits. Accepted risk: this copy can drift from the server's.
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
