import { describe, expect, it } from 'vitest'
import {
  canDeleteStoredSnapshot,
  canUseStoredSnapshot,
  pollWhileVolumeSnapshotsWait,
  volumeSnapshotFailureNote,
  volumeSnapshotLabel,
  type VolumeSnapshotStateFields,
} from './volumeSnapshotState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// A volume snapshot has one status (titan-ops features/volume/design.md#volume-state-is-existence); a command the
// provider gave up on is a request failure.

function row(status: string, requestFailureReason: string | null = null): VolumeSnapshotStateFields {
  return { status, requestFailureReason }
}

describe('volumeSnapshotLabel', () => {
  it('shows the status as the server spells it, NotFound as Not found', () => {
    for (const word of ['Creating', 'Deleting', 'Available', 'Failed', 'Deleted']) {
      expect(volumeSnapshotLabel(row(word))).toBe(word)
    }
    expect(volumeSnapshotLabel(row('NotFound'))).toBe('Not found')
  })
})

describe('volumeSnapshotFailureNote', () => {
  it('says why the last request gave up while nothing waits, and nothing while one waits', () => {
    expect(volumeSnapshotFailureNote(row('Available', 'Delete failed.'))).toBe('Delete failed.')
    expect(volumeSnapshotFailureNote(row('Deleting', 'an older failure'))).toBeNull()
    expect(volumeSnapshotFailureNote(row('Available'))).toBeNull()
  })
})

describe('snapshot buttons follow the server rules', () => {
  it('offers restore only when Incus has it and nothing waits', () => {
    expect(canUseStoredSnapshot(row('Available'))).toBe(true)
    for (const status of ['Creating', 'Deleting', 'NotFound', 'Failed', 'Deleted']) {
      expect(canUseStoredSnapshot(row(status)), status).toBe(false)
    }
  })

  it('offers delete unless a request waits or it is gone, not found and failed create included', () => {
    expect(canDeleteStoredSnapshot(row('Available'))).toBe(true)
    expect(canDeleteStoredSnapshot(row('NotFound'))).toBe(true)
    expect(canDeleteStoredSnapshot(row('Failed', 'x'))).toBe(true)
    for (const status of ['Creating', 'Deleting', 'Deleted']) {
      expect(canDeleteStoredSnapshot(row(status)), status).toBe(false)
    }
  })
})

describe('pollWhileVolumeSnapshotsWait', () => {
  it('polls while any snapshot has a request waiting, then stops', () => {
    expect(pollWhileVolumeSnapshotsWait([row('Available'), row('Deleting')])).toBe(POLL_MS)
    expect(pollWhileVolumeSnapshotsWait([row('Available'), row('NotFound')])).toBe(false)
    expect(pollWhileVolumeSnapshotsWait(undefined)).toBe(false)
  })
})
