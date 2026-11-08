import { describe, expect, it } from 'vitest'
import {
  canAttachStoredVolume,
  canDeleteStoredVolume,
  canDetachStoredVolume,
  canSnapshotStoredVolume,
  pollWhileVolumesWait,
  volumeAttachmentDrifts,
  volumeFailureNote,
  volumeLabel,
  type VolumeStateFields,
} from './volumeState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

// A volume has one status (titan-ops features/volume/design.md#volume-state-is-existence); a command the provider gave up
// on is a request failure.

function volume(overrides: Partial<VolumeStateFields> = {}): VolumeStateFields {
  return {
    status: 'Available',
    currentAttachedVmId: null,
    currentAttachedElsewhere: false,
    desiredAttachedVmId: null,
    requestFailureReason: null,
    ...overrides,
  }
}

describe('volumeLabel', () => {
  it('says the waiting request first', () => {
    expect(volumeLabel(volume({ status: 'Creating' }))).toBe('Creating')
    expect(volumeLabel(volume({ status: 'Attaching', desiredAttachedVmId: 'vm-1' }))).toBe('Attaching')
    expect(volumeLabel(volume({ status: 'Detaching', currentAttachedVmId: 'vm-1' }))).toBe('Detaching')
    expect(volumeLabel(volume({ status: 'Deleting' }))).toBe('Deleting')
  })

  // Incus has no word for an idle volume; the portal's label for one is Available.
  it('says Available for a volume Incus holds that no instance uses', () => {
    expect(volumeLabel(volume())).toBe('Available')
  })

  it('says Attached for one a Titan VM uses, and Attached outside Titan for one another instance uses', () => {
    expect(volumeLabel(volume({ currentAttachedVmId: 'vm-1', desiredAttachedVmId: 'vm-1' }))).toBe('Attached')
    expect(volumeLabel(volume({ currentAttachedElsewhere: true }))).toBe('Attached outside OpenViCloud')
    expect(volumeLabel(volume({ currentAttachedVmId: 'vm-1', currentAttachedElsewhere: true }))).toBe('Attached outside OpenViCloud')
  })

  it('says Not found when Incus no longer has it, and Failed for a create that gave up', () => {
    expect(volumeLabel(volume({ status: 'NotFound' }))).toBe('Not found')
    expect(volumeLabel(volume({ status: 'Failed', requestFailureReason: 'Volume creation failed.' }))).toBe('Failed')
  })

  it('shows a status it was not taught as the server sends it', () => {
    expect(volumeLabel(volume({ status: 'Resizing' }))).toBe('Resizing')
  })
})

describe('volumeFailureNote', () => {
  it('says why the last request gave up while nothing waits, and nothing while one waits', () => {
    expect(volumeFailureNote(volume({ requestFailureReason: 'Attach failed.' }))).toBe('Attach failed.')
    expect(volumeFailureNote(volume({ status: 'Attaching', requestFailureReason: 'an older failure' }))).toBeNull()
    expect(volumeFailureNote(volume())).toBeNull()
  })
})

describe('volume buttons follow the server rules', () => {
  it('offers Attach only on an available volume', () => {
    expect(canAttachStoredVolume(volume())).toBe(true)
    expect(canAttachStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(false)
    expect(canAttachStoredVolume(volume({ currentAttachedElsewhere: true }))).toBe(false)
    expect(canAttachStoredVolume(volume({ status: 'NotFound' }))).toBe(false)
    expect(canAttachStoredVolume(volume({ status: 'Failed' }))).toBe(false)
    expect(canAttachStoredVolume(volume({ status: 'Detaching' }))).toBe(false)
  })

  it('offers Detach only on a volume a Titan VM alone uses', () => {
    expect(canDetachStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(true)
    expect(canDetachStoredVolume(volume({ currentAttachedVmId: 'vm-1', currentAttachedElsewhere: true }))).toBe(false)
    expect(canDetachStoredVolume(volume({ currentAttachedElsewhere: true }))).toBe(false)
    expect(canDetachStoredVolume(volume())).toBe(false)
    expect(canDetachStoredVolume(volume({ status: 'Detaching', currentAttachedVmId: 'vm-1' }))).toBe(false)
  })

  // Delete follows Incus: not found and a failed create are deletable; an attached one and a waiting request are not.
  it('offers Delete on an unattached volume with nothing waiting, not found and failed create included', () => {
    expect(canDeleteStoredVolume(volume())).toBe(true)
    expect(canDeleteStoredVolume(volume({ status: 'NotFound' }))).toBe(true)
    expect(canDeleteStoredVolume(volume({ status: 'Failed', requestFailureReason: 'x' }))).toBe(true)
    expect(canDeleteStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(false)
    expect(canDeleteStoredVolume(volume({ currentAttachedElsewhere: true }))).toBe(false)
    for (const status of ['Creating', 'Attaching', 'Detaching', 'Deleting', 'Deleted']) {
      expect(canDeleteStoredVolume(volume({ status })), status).toBe(false)
    }
  })

  it('offers New Snapshot when Incus has it and nothing waits, attached or not', () => {
    expect(canSnapshotStoredVolume(volume())).toBe(true)
    expect(canSnapshotStoredVolume(volume({ currentAttachedVmId: 'vm-1' }))).toBe(true)
    expect(canSnapshotStoredVolume(volume({ status: 'NotFound' }))).toBe(false)
    expect(canSnapshotStoredVolume(volume({ status: 'Attaching' }))).toBe(false)
  })
})

describe('volumeAttachmentDrifts', () => {
  it('flags a volume whose attachment is not the one asked for, only while nothing waits', () => {
    expect(volumeAttachmentDrifts(volume({ currentAttachedVmId: 'vm-1', desiredAttachedVmId: null }))).toBe(true)
    expect(volumeAttachmentDrifts(volume({ currentAttachedVmId: null, desiredAttachedVmId: 'vm-1' }))).toBe(true)
    expect(volumeAttachmentDrifts(volume({ currentAttachedVmId: 'vm-1', desiredAttachedVmId: 'vm-1' }))).toBe(false)
    expect(volumeAttachmentDrifts(volume({ status: 'Attaching', desiredAttachedVmId: 'vm-1' }))).toBe(false)
  })
})

describe('pollWhileVolumesWait', () => {
  it('polls while any volume has a request waiting, then stops', () => {
    expect(pollWhileVolumesWait([volume(), volume({ status: 'Detaching' })])).toBe(POLL_MS)
    expect(pollWhileVolumesWait([volume(), volume({ status: 'NotFound' })])).toBe(false)
    expect(pollWhileVolumesWait(undefined)).toBe(false)
  })
})
