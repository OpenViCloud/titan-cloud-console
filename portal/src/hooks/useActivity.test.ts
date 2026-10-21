import { describe, expect, it } from 'vitest'
import { formatActivityAction, relativeTime } from './useActivity'
import { vi as viMessages } from '@/i18n/vi'
import { en } from '@/i18n/en'

describe('formatActivityAction', () => {
  it('maps known actions to human labels', () => {
    expect(formatActivityAction('vm.created', en)).toBe('Created VM')
    expect(formatActivityAction('volume.attached', en)).toBe('Attached volume')
    expect(formatActivityAction('network.deleted', en)).toBe('Deleted network')
  })

  // docs/architecture/intent-and-observation.md#intent-has-identity — the request and its outcome are two rows; the feed must never make a request read
  // like the thing already happened.
  it('labels every request event as a request, distinct from its outcome', () => {
    const requests: Record<string, string> = {
      'vm.create_requested': 'vm.created',
      'vm.stop_requested': 'vm.stopped',
      'vm.start_requested': 'vm.started',
      'vm.delete_requested': 'vm.deleted',
      'network.create_requested': 'network.created',
      'network.delete_requested': 'network.deleted',
      'volume.create_requested': 'volume.created',
      'volume.attach_requested': 'volume.attached',
      'volume.detach_requested': 'volume.detached',
      'volume.delete_requested': 'volume.deleted',
      // INTENT-3 S-3: snapshots and firewall rules. A restore's outcome is the new volume's creation.
      'vm_snapshot.create_requested': 'vm_snapshot.created',
      'vm_snapshot.revert_requested': 'vm_snapshot.reverted',
      'vm_snapshot.delete_requested': 'vm_snapshot.deleted',
      'volume_snapshot.create_requested': 'volume_snapshot.created',
      'volume_snapshot.delete_requested': 'volume_snapshot.deleted',
      'volume_snapshot.restore_requested': 'volume.created',
      'firewall_rule.create_requested': 'firewall_rule.created',
      'firewall_rule.delete_requested': 'firewall_rule.deleted',
      'ssh_key.create_requested': 'ssh_key.created',
      'ssh_key.delete_requested': 'ssh_key.deleted',
      'api_token.create_requested': 'api_token.created',
      'api_token.delete_requested': 'api_token.deleted',
      'load_balancer.create_requested': 'load_balancer.created',
      'load_balancer.update_requested': 'load_balancer.updated',
      'load_balancer.delete_requested': 'load_balancer.deleted',
    }
    expect(Object.keys(requests)).toHaveLength(25)
    for (const [request, outcome] of Object.entries(requests)) {
      expect(formatActivityAction(request, en)).toMatch(/^Requested /)
      expect(formatActivityAction(outcome, en)).not.toMatch(/^Requested /)
      expect(formatActivityAction(outcome, en)).not.toBe(formatActivityAction(request, en))
    }
    expect(formatActivityAction('vm.delete_requested', en)).toBe('Requested VM deletion')
    expect(formatActivityAction('volume_snapshot.restore_requested', en)).toBe('Requested volume restore from snapshot')
    expect(formatActivityAction('firewall_rule.deleted', en)).toBe('Deleted firewall rule')
    expect(formatActivityAction('ssh_key.created', en)).toBe('Added SSH key')
    expect(formatActivityAction('api_token.deleted', en)).toBe('Deleted API token')
    expect(formatActivityAction('api_token.created', viMessages)).toBe('Đã tạo token API')
    expect(formatActivityAction('load_balancer.update_requested', en)).toBe('Requested load balancer change')
    expect(formatActivityAction('load_balancer.updated', viMessages)).toBe('Đã sửa load balancer')
  })

  // INTENT-4 S-C — a stop/start the provider refused is the request's outcome too; it must not
  // fall back to the generic "Stop_failed vm", and must not read like the success.
  it('labels a failed stop or start as a failure', () => {
    expect(formatActivityAction('vm.stop_failed', en)).toBe('VM stop failed')
    expect(formatActivityAction('vm.start_failed', en)).toBe('VM start failed')
  })

  // An SSH session is a request with no outcome row: the session leaves nothing behind on the VM.
  it('labels an SSH session request in both languages', () => {
    expect(formatActivityAction('vm.ssh_requested', en)).toBe('Requested SSH session')
    expect(formatActivityAction('vm.ssh_requested', viMessages)).toBe('Yêu cầu phiên SSH')
  })

  it('keeps the labels of rows written before docs/architecture/intent-and-observation.md#intent-has-identity', () => {
    expect(formatActivityAction('vm.deleted', en)).toBe('Deleted VM')
    expect(formatActivityAction('vm.stopped', en)).toBe('Stopped VM')
  })

  it('falls back to Title-cased "{verb} {resource}" for an unmapped action', () => {
    expect(formatActivityAction('vm.rebooted', en)).toBe('Rebooted vm')
  })

  it('returns the raw action when it has no verb segment', () => {
    expect(formatActivityAction('weird', en)).toBe('weird')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-08-23T12:00:00Z')

  it('renders "just now" under a minute', () => {
    expect(relativeTime('2026-08-23T11:59:30Z', now, en)).toBe('just now')
  })

  it('renders minutes, hours, and days', () => {
    expect(relativeTime('2026-08-23T11:55:00Z', now, en)).toBe('5m ago')
    expect(relativeTime('2026-08-23T09:00:00Z', now, en)).toBe('3h ago')
    expect(relativeTime('2026-08-21T12:00:00Z', now, en)).toBe('2d ago')
  })

  it('clamps a future timestamp to "just now" rather than a negative age', () => {
    expect(relativeTime('2026-08-23T12:05:00Z', now, en)).toBe('just now')
  })
})

describe('activity labels in Vietnamese', () => {
  it('labels known actions and relative times from the Vietnamese dictionary', () => {
    expect(formatActivityAction('vm.created', viMessages)).toBe('Đã tạo VM')
    expect(formatActivityAction('vm.delete_requested', viMessages)).toBe('Yêu cầu xoá VM')
    expect(formatActivityAction('vm.stop_failed', viMessages)).toBe('Tắt VM thất bại')
    // An unmapped action is built from raw identifiers, so it is the same in both languages.
    expect(formatActivityAction('vm.rebooted', viMessages)).toBe('Rebooted vm')
    const now = new Date('2026-08-23T12:00:00Z')
    expect(relativeTime('2026-08-23T11:59:30Z', now, viMessages)).toBe('vừa xong')
    expect(relativeTime('2026-08-23T11:55:00Z', now, viMessages)).toBe('5 phút trước')
    expect(relativeTime('2026-08-21T12:00:00Z', now, viMessages)).toBe('2 ngày trước')
  })
})
