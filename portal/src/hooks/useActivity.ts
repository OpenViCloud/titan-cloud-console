import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTenant } from '@/contexts/TenantContext'
import type { Messages } from '@/i18n/en'

export interface ActivityEvent {
  id: string
  action: string
  resourceType: string
  resourceName: string
  createdAt: string
}

export function useActivity(limit = 10) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['activity', tenantId, limit],
    queryFn: () =>
      api
        .get<ActivityEvent[]>(`/v1/tenant/activity`, { params: { limit } })
        .then(r => r.data),
    enabled: !!tenantId,
  })
}

// The backend action is a stable "{resource}.{verb}" key — map it to a dictionary label for the feed.
// Falls back to a Title-cased "{verb} {resource}" for any action not enumerated here, so a new
// event type still reads sensibly before this map is updated.
//
// docs/architecture/intent-and-observation.md#intent-has-identity: every asynchronous action records TWO events — "*_requested" when someone presses the
// button, and the past-tense outcome when the provider has actually done it. Rows written before
// docs/architecture/intent-and-observation.md#intent-has-identity used the outcome names for the request; they keep these same labels (no data rewrite).
const ACTION_KEYS: Record<string, keyof Messages['activityActions']> = {
  'vm.create_requested': 'vmCreateRequested',
  'vm.stop_requested': 'vmStopRequested',
  'vm.start_requested': 'vmStartRequested',
  'vm.delete_requested': 'vmDeleteRequested',
  'network.create_requested': 'networkCreateRequested',
  'network.delete_requested': 'networkDeleteRequested',
  'volume.create_requested': 'volumeCreateRequested',
  'volume.attach_requested': 'volumeAttachRequested',
  'volume.detach_requested': 'volumeDetachRequested',
  'volume.delete_requested': 'volumeDeleteRequested',
  'vm_snapshot.create_requested': 'vmSnapshotCreateRequested',
  'vm_snapshot.revert_requested': 'vmSnapshotRevertRequested',
  'vm_snapshot.delete_requested': 'vmSnapshotDeleteRequested',
  'volume_snapshot.create_requested': 'volumeSnapshotCreateRequested',
  'volume_snapshot.delete_requested': 'volumeSnapshotDeleteRequested',
  // The row names the NEW volume; its outcome is that volume's "Created volume".
  'volume_snapshot.restore_requested': 'volumeSnapshotRestoreRequested',
  'firewall_rule.create_requested': 'firewallRuleCreateRequested',
  'firewall_rule.delete_requested': 'firewallRuleDeleteRequested',
  'ssh_key.create_requested': 'sshKeyCreateRequested',
  'ssh_key.delete_requested': 'sshKeyDeleteRequested',
  'api_token.create_requested': 'apiTokenCreateRequested',
  'api_token.delete_requested': 'apiTokenDeleteRequested',
  'load_balancer.create_requested': 'loadBalancerCreateRequested',
  'load_balancer.update_requested': 'loadBalancerUpdateRequested',
  'load_balancer.delete_requested': 'loadBalancerDeleteRequested',
  'vm.ssh_requested': 'vmSshRequested',
  'vm.created': 'vmCreated',
  'vm.deleted': 'vmDeleted',
  'vm.stopped': 'vmStopped',
  'vm.started': 'vmStarted',
  'network.created': 'networkCreated',
  'network.deleted': 'networkDeleted',
  'volume.created': 'volumeCreated',
  'volume.deleted': 'volumeDeleted',
  'volume.attached': 'volumeAttached',
  'volume.detached': 'volumeDetached',
  'vm_snapshot.created': 'vmSnapshotCreated',
  'vm_snapshot.reverted': 'vmSnapshotReverted',
  'vm_snapshot.deleted': 'vmSnapshotDeleted',
  'volume_snapshot.created': 'volumeSnapshotCreated',
  'volume_snapshot.deleted': 'volumeSnapshotDeleted',
  'firewall_rule.created': 'firewallRuleCreated',
  'firewall_rule.deleted': 'firewallRuleDeleted',
  'ssh_key.created': 'sshKeyCreated',
  'ssh_key.deleted': 'sshKeyDeleted',
  'api_token.created': 'apiTokenCreated',
  'api_token.deleted': 'apiTokenDeleted',
  'load_balancer.created': 'loadBalancerCreated',
  'load_balancer.updated': 'loadBalancerUpdated',
  'load_balancer.deleted': 'loadBalancerDeleted',
  // INTENT-4 S-C: the provider refused the stop/start on every retry; the VM is free for a new request.
  'vm.stop_failed': 'vmStopFailed',
  'vm.start_failed': 'vmStartFailed',
}

// The fallback is built from the raw API identifiers, so it reads the same in every language.
export function formatActivityAction(action: string, t: Messages): string {
  const key = ACTION_KEYS[action]
  if (key) {
    return t.activityActions[key]
  }
  const [resource, verb] = action.split('.')
  if (!verb) {
    return action
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return `${cap(verb)} ${resource}`
}

// Compact relative time for the "When" column ("just now", "5m ago", "3h ago", "2d ago").
export function relativeTime(iso: string, now: Date, t: Messages): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.floor((now.getTime() - then) / 1000))
  if (diffSec < 60) {
    return t.activity.justNow
  }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return t.activity.minutesAgo(diffMin)
  }
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) {
    return t.activity.hoursAgo(diffHr)
  }
  const diffDay = Math.floor(diffHr / 24)
  return t.activity.daysAgo(diffDay)
}
