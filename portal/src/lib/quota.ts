// A VM has one status: it counts while its create waits or Incus holds its instance, until its delete is asked
// (titan-ops features/vm/design.md#counting-and-billing). A network and a volume have one status too, with the same four
// outside. A VM or volume restored from a backup is the exception: it never counts.
const STATUSES_OUTSIDE_QUOTA = new Set(['Deleting', 'Deleted', 'NotFound', 'Failed'])

// Vm.OccupiesQuota: a VM restored from a backup never counts, in any status
// (titan-ops features/backup/design.md#restore-as-new-resource).
export function vmOccupiesQuota(vm: { status: string; restoredFromBackup?: boolean }): boolean {
  return vm.restoredFromBackup !== true && !STATUSES_OUTSIDE_QUOTA.has(vm.status)
}

// Network.OccupiesQuota: status not in Deleting, Deleted, NotFound, Failed.
export function networkOccupiesQuota(network: { status: string }): boolean {
  return !STATUSES_OUTSIDE_QUOTA.has(network.status)
}

// Volume.OccupiesQuota: Creating, Available, and Attaching or Detaching while Incus holds it — the portal cannot see
// whether Incus holds it (the server keeps that in the operation), so it counts the two as held: attach and detach
// start only on a volume Incus holds. Accepted risk: a volume the reconciler saw vanish mid-attach counts here until
// the attach or detach command reports. A volume restored from a backup never counts, in any status
// (titan-ops features/backup/design.md#restore-as-new-resource).
export function volumeOccupiesQuota(volume: { status: string; restoredFromBackup?: boolean }): boolean {
  return volume.restoredFromBackup !== true && !STATUSES_OUTSIDE_QUOTA.has(volume.status)
}
