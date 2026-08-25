// Central status → visual tone mapping used by StatusBadge and HealthIndicator.
// Tones map to Tailwind utility classes built on the semantic + status color tokens.

export type StatusTone = 'success' | 'warning' | 'critical' | 'info' | 'model' | 'neutral' | 'muted'

export const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'zc-chip-success',
  warning: 'zc-chip-warning',
  critical: 'zc-chip-critical',
  info: 'zc-chip-info',
  model: 'zc-chip-model',
  neutral: 'zc-chip-neutral',
  muted: 'zc-chip-muted',
}

export const TONE_DOT_CLASSES: Record<StatusTone, string> = {
  success: 'zc-dot-success',
  warning: 'zc-dot-warning',
  critical: 'zc-dot-critical',
  info: 'zc-dot-info',
  model: 'zc-dot-model',
  neutral: 'zc-dot-neutral',
  muted: 'zc-dot-muted',
}

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  // health
  healthy: 'success', HEALTHY: 'success',
  degraded: 'warning', DEGRADED: 'warning',
  warning: 'warning', WARNING: 'warning', WATCH: 'warning',
  critical: 'critical', CRITICAL: 'critical',
  offline: 'muted', OFFLINE: 'muted', NORMAL: 'success',
  // enable / lifecycle
  ENABLED: 'success', ACTIVE: 'success', COMPLETE: 'success', COMPLETED: 'success',
  RESOLVED: 'success', CLOSED: 'muted', APPROVED: 'success', RESUMED: 'success',
  PASS: 'success', CORROBORATED: 'success', READY: 'success',
  RECOMMENDABLE: 'success', PRODUCTION_ENABLED: 'success',
  PAUSED: 'warning', PENDING: 'warning', PARTIAL: 'warning', RETRYING: 'warning',
  PROCESSING: 'info', TESTING: 'info', PREDICTED_ONLY: 'info', DETECTED: 'warning',
  INVESTIGATING: 'warning', MITIGATED: 'info', OPEN: 'critical', REPLAY_REQUIRED: 'warning',
  DISABLED: 'critical', BLOCKED: 'critical', ABSTAIN: 'critical', ABSTAINED: 'critical',
  FAILED: 'critical', DEAD_LETTER: 'critical', UNHEALTHY: 'critical', CORRUPTED: 'critical',
  REPAIR_REQUIRED: 'critical', REGRESSION: 'critical', QUARANTINED: 'critical',
  ARCHIVED: 'muted', RETIRED: 'muted', REJECTED: 'critical', ROLLBACK: 'warning',
  BUSY: 'info', DRAINING: 'warning', RUNNING: 'info',
  CANDIDATE: 'model', SHADOW: 'model', EXPERIMENTAL: 'model',
  'NOT STARTED': 'muted', WAITING: 'warning', 'IN PROGRESS': 'info',
  RESTRICTED: 'warning', ALLOWED: 'success', UNKNOWN: 'muted',
  STALE: 'warning', MISSING: 'critical',
  CANDIDATE_BETTER: 'success', NO_MATERIAL_DIFFERENCE: 'info', NOT_ENOUGH_DATA: 'muted',
  active: 'success', idle: 'warning', revoked: 'critical',
  low: 'muted', normal: 'info', high: 'warning',
}

export function toneForStatus(status: string): StatusTone {
  return STATUS_TONE_MAP[status] ?? 'neutral'
}

export function formatStatusLabel(status: string): string {
  if (status === status.toUpperCase() && status.includes('_')) {
    return status.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
  }
  if (status === status.toUpperCase() && status.length > 3) {
    return status.charAt(0) + status.slice(1).toLowerCase()
  }
  return status
}
