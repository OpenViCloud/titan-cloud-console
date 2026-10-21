import { describe, expect, it } from 'vitest'
import {
  canAttachStoredVolume,
  canDeleteStoredVolume,
  canDeleteStoredSnapshot,
  canDetachStoredVolume,
  canSnapshotStoredVolume,
  canUseStoredSnapshot,
  pollWhileStorageWaits,
  snapshotLabel,
  volumeLabel,
  type StoredSnapshotFields,
  type StoredVolumeFields,
} from './storageState'

function volume(overrides: Partial<StoredVolumeFields> = {}): StoredVolumeFields {
  return {
    currentExistence: 'Exists',
    desiredExistence: 'Exists',
    currentAttachedVmId: null,
    currentAttachedElsewhere: false,
    desiredAttachedVmId: null,
    transition: null,
    requestFailureReason: null,
    ...overrides,
  }
}

function snapshot(overrides: Partial<StoredSnapshotFields> = {}): StoredSnapshotFields {
  return { currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, ...overrides }
}

describe('volumeLabel', () => {
  it('says the waiting request first', () => {
    expect(volumeLabel(volume({ currentExistence: 'NotCreated', transition: 'Creating' }))).toBe('Creating')
    expect(volumeLabel(volume({ transition: 'Attaching', desiredAttachedVmId: 'vm-1' }))).toBe('Attaching')
  })

  // P3-2: Incus has no word for an idle volume; the portal's label for one is Available.
  it('says Available for a volume Incus holds that no instance uses', () => {
    expect(volumeLabel(volume())).toBe('Available')
  })

  it('says Attached for one a Titan VM uses, and Attached outside Titan for one another instance uses', () => {
    expect(volumeLabel(volume({ currentAttachedVmId: 'vm-1', desiredAttachedVmId: 'vm-1' }))).toBe('Attached')
    expect(volumeLabel(volume({ currentAttachedElsewhere: true }))).toBe('Attached outside OpenViCloud')
    expect(volumeLabel(volume({ currentAttachedVmId: 'vm-1', currentAttachedElsewhere: true }))).toBe('Attached outside OpenViCloud')
  })

  it('says Not found when Incus no longer has it, and Failed for a create that gave up', () => {
    expect(volumeLabel(volume({ currentExistence: 'NotFound' }))).toBe('Not found')
    expect(volumeLabel(volume({ currentExistence: 'NotCreated', requestFailureReason: 'Volume creation failed.' }))).toBe('Failed')
  })
})

describe('volume buttons follow the server rules', () => {
  it('offers Attach only on an available volume', () => {
    expect(canAttachStoredVolume(volume())).toBe(true)
    expect(canAttachStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(false)
    expect(canAttachStoredVolume(volume({ currentAttachedElsewhere: true }))).toBe(false)
    expect(canAttachStoredVolume(volume({ currentExistence: 'NotFound' }))).toBe(false)
    expect(canAttachStoredVolume(volume({ transition: 'Detaching' }))).toBe(false)
  })

  it('offers Detach only on a volume a Titan VM alone uses', () => {
    expect(canDetachStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(true)
    expect(canDetachStoredVolume(volume({ currentAttachedVmId: 'vm-1', currentAttachedElsewhere: true }))).toBe(false)
    expect(canDetachStoredVolume(volume({ currentAttachedElsewhere: true }))).toBe(false)
    expect(canDetachStoredVolume(volume())).toBe(false)
  })

  // Delete follows Incus: not found and a failed create are deletable; an attached one and a waiting request are not.
  it('offers Delete on an unattached volume with nothing waiting, not found and failed create included', () => {
    expect(canDeleteStoredVolume(volume())).toBe(true)
    expect(canDeleteStoredVolume(volume({ currentExistence: 'NotFound' }))).toBe(true)
    expect(canDeleteStoredVolume(volume({ currentExistence: 'NotCreated', requestFailureReason: 'x' }))).toBe(true)
    expect(canDeleteStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(false)
    expect(canDeleteStoredVolume(volume({ currentAttachedElsewhere: true }))).toBe(false)
    expect(canDeleteStoredVolume(volume({ currentExistence: 'NotCreated', transition: 'Creating' }))).toBe(false)
    expect(canDeleteStoredVolume(volume({ desiredExistence: 'Deleted', transition: 'Deleting' }))).toBe(false)
  })

  it('offers New Snapshot when Incus has it and nothing waits, attached or not', () => {
    expect(canSnapshotStoredVolume(volume())).toBe(true)
    expect(canSnapshotStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(true)
    expect(canSnapshotStoredVolume(volume({ currentExistence: 'NotFound' }))).toBe(false)
    expect(canSnapshotStoredVolume(volume({ transition: 'Attaching' }))).toBe(false)
  })
})

describe('snapshots', () => {
  it('reads like a volume without an attachment', () => {
    expect(snapshotLabel(snapshot())).toBe('Available')
    expect(snapshotLabel(snapshot({ transition: 'Reverting' }))).toBe('Reverting')
    expect(snapshotLabel(snapshot({ currentExistence: 'NotFound' }))).toBe('Not found')
    expect(snapshotLabel(snapshot({ currentExistence: 'NotCreated', requestFailureReason: 'x' }))).toBe('Failed')
  })

  it('offers restore or revert only when Incus has it and nothing waits, and delete unless a request waits', () => {
    expect(canUseStoredSnapshot(snapshot())).toBe(true)
    expect(canUseStoredSnapshot(snapshot({ currentExistence: 'NotFound' }))).toBe(false)
    expect(canDeleteStoredSnapshot(snapshot({ currentExistence: 'NotFound' }))).toBe(true)
    expect(canDeleteStoredSnapshot(snapshot({ currentExistence: 'NotCreated', requestFailureReason: 'x' }))).toBe(true)
    expect(canDeleteStoredSnapshot(snapshot({ currentExistence: 'NotCreated', transition: 'Creating' }))).toBe(false)
  })
})

describe('pollWhileStorageWaits', () => {
  it('polls while any row has a request waiting, then stops', () => {
    expect(pollWhileStorageWaits([snapshot(), snapshot({ transition: 'Deleting' })])).not.toBe(false)
    expect(pollWhileStorageWaits([snapshot()])).toBe(false)
    expect(pollWhileStorageWaits(undefined)).toBe(false)
  })
})
