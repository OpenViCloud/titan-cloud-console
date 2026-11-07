import { describe, expect, it } from 'vitest'
import {
  canDeleteVmSnapshot,
  canRevertVmSnapshot,
  pollWhileVmSnapshotsWait,
  vmSnapshotFailureNote,
  vmSnapshotLabel,
  type VmSnapshotStateFields,
} from './vmSnapshotState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// A VM snapshot has one status (titan-ops features/vm/design.md#vm-snapshot); a command the provider gave up on is a
// request failure.

function row(status: string, requestFailureReason: string | null = null): VmSnapshotStateFields {
  return { status, requestFailureReason }
}

describe('vmSnapshotLabel', () => {
  it('shows the status as the server spells it, NotFound as Not found', () => {
    for (const word of ['Creating', 'Reverting', 'Deleting', 'Available', 'Failed', 'Deleted']) {
      expect(vmSnapshotLabel(row(word))).toBe(word)
    }
    expect(vmSnapshotLabel(row('NotFound'))).toBe('Not found')
  })
})

describe('vmSnapshotFailureNote', () => {
  it('says why the last request gave up while nothing waits, and nothing while one waits', () => {
    expect(vmSnapshotFailureNote(row('Available', 'Revert failed.'))).toBe('Revert failed.')
    expect(vmSnapshotFailureNote(row('Failed', 'Snapshot creation failed.'))).toBe('Snapshot creation failed.')
    expect(vmSnapshotFailureNote(row('Reverting', 'Revert failed.'))).toBeNull()
    expect(vmSnapshotFailureNote(row('Available'))).toBeNull()
  })
})

describe('buttons', () => {
  it('offers Revert only on a snapshot Incus holds with nothing waiting', () => {
    expect(canRevertVmSnapshot(row('Available'))).toBe(true)
    for (const word of ['Creating', 'Reverting', 'Deleting', 'NotFound', 'Failed', 'Deleted', 'SomethingNew']) {
      expect(canRevertVmSnapshot(row(word))).toBe(false)
    }
  })

  it('offers Delete whenever nothing waits and it is not gone, a snapshot Incus lost and a failed create included', () => {
    for (const word of ['Available', 'NotFound', 'Failed', 'SomethingNew']) {
      expect(canDeleteVmSnapshot(row(word))).toBe(true)
    }
    for (const word of ['Creating', 'Reverting', 'Deleting', 'Deleted']) {
      expect(canDeleteVmSnapshot(row(word))).toBe(false)
    }
  })
})

describe('pollWhileVmSnapshotsWait', () => {
  it('refreshes while a create, revert or delete waits, then stops', () => {
    expect(pollWhileVmSnapshotsWait(undefined)).toBe(false)
    expect(pollWhileVmSnapshotsWait([row('Available'), row('NotFound')])).toBe(false)
    for (const word of ['Creating', 'Reverting', 'Deleting']) {
      expect(pollWhileVmSnapshotsWait([row('Available'), row(word)])).toBe(POLL_MS)
    }
  })
})
