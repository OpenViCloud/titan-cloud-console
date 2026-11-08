// A VM has one status: it counts while its create waits or Incus holds its instance, until its delete is asked
// (titan-ops features/vm/design.md#counting-and-billing). A network and a volume have one status too, with the same four
// outside.
const STATUSES_OUTSIDE_QUOTA = new Set(['Deleting', 'Deleted', 'NotFound', 'Failed'])

export function vmOccupiesQuota(vm: { status: string }): boolean {
  return !STATUSES_OUTSIDE_QUOTA.has(vm.status)
}

// Network.OccupiesQuota: status not in Deleting, Deleted, NotFound, Failed.
export function networkOccupiesQuota(network: { status: string }): boolean {
  return !STATUSES_OUTSIDE_QUOTA.has(network.status)
}

// Volume.OccupiesQuota: Creating, Available, and Attaching or Detaching while Incus holds it — the portal cannot see
// whether Incus holds it (the server keeps that in the operation), so it counts the two as held: attach and detach
// start only on a volume Incus holds. Accepted risk: a volume the reconciler saw vanish mid-attach counts here one
// poll too long.
export function volumeOccupiesQuota(volume: { status: string }): boolean {
  return !STATUSES_OUTSIDE_QUOTA.has(volume.status)
}
