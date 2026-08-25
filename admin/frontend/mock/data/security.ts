import type { AdminUser, SecretRotation, RateLimitIncident, AdminRole } from '../../types/domain'
import { FIRST_NAMES, LAST_NAMES } from '../factories/names'
import { makeRng, pick, pickMany, rangeInt, uid, isoOffset } from '../factories/rng'

const rng = makeRng(224466)

const ROLES: AdminRole[] = [
  'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'DATA_ADMIN', 'PREDICTION_ADMIN',
  'MODEL_ADMIN', 'MARKET_ADMIN', 'COMPLIANCE_ADMIN', 'AUDITOR', 'READ_ONLY',
]

export const ROLE_PERMISSIONS: Record<AdminRole, { read: string; control: string; sensitive: string }> = {
  SUPER_ADMIN: { read: 'All areas', control: 'All operational areas', sensitive: 'Role/security policy, releases, DR operations' },
  OPERATIONS_ADMIN: { read: 'Overview, queues, incidents', control: 'Retry, pause, resume, worker controls', sensitive: 'DR / production incident actions' },
  DATA_ADMIN: { read: 'Data, providers, archive, fixtures', control: 'Backfill, provider reconciliation, league/fixture controls', sensitive: 'Source incident closure' },
  PREDICTION_ADMIN: { read: 'Prediction, model, simulation, evaluation', control: 'Queue prediction, inspect evidence, start shadow', sensitive: 'Model release with approval workflow' },
  MODEL_ADMIN: { read: 'Model registry, drift, evaluation', control: 'Create candidate training, manage shadow tests', sensitive: 'Model promotion, rollback (step-up auth)' },
  MARKET_ADMIN: { read: 'Markets, odds, bookmakers', control: 'Enable/disable/experimental, semantics review', sensitive: 'Settlement semantics production approval' },
  COMPLIANCE_ADMIN: { read: 'Jurisdiction, security, audit', control: 'Policy and CTA controls', sensitive: 'Geo/age policy changes' },
  AUDITOR: { read: 'All permitted read views', control: 'None', sensitive: 'No mutations' },
  READ_ONLY: { read: 'Command Center + assigned areas', control: 'None', sensitive: 'No mutations' },
}

export const ADMIN_USERS: AdminUser[] = Array.from({ length: 11 }, (_, i) => {
  const first = pick(rng, FIRST_NAMES)
  const last = pick(rng, LAST_NAMES)
  const role = ROLES[i % ROLES.length]!
  const sessionStatus = rng() < 0.75 ? 'active' : rng() < 0.6 ? 'idle' : 'revoked'
  return {
    id: uid('ADM', i + 1),
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@zahrly.io`,
    role,
    mfaEnabled: role === 'READ_ONLY' ? rng() < 0.6 : true,
    lastLogin: isoOffset(-rangeInt(rng, 5, 8000)),
    sessionStatus,
    accountStatus: 'active',
  }
})

export const SECRET_ROTATIONS: SecretRotation[] = [
  { id: 'SEC-01', name: 'API-Football API key', scope: 'Provider integration', lastRotated: '2026-06-10', expiresAt: '2026-09-10', daysRemaining: 18, status: 'warning' },
  { id: 'SEC-02', name: 'PropLine API key', scope: 'Provider integration', lastRotated: '2026-07-01', expiresAt: '2026-10-01', daysRemaining: 39, status: 'healthy' },
  { id: 'SEC-03', name: 'Supabase service role key', scope: 'Database access', lastRotated: '2026-05-15', expiresAt: '2026-08-15', daysRemaining: -8, status: 'expired' },
  { id: 'SEC-04', name: 'Redis auth token', scope: 'Cache layer', lastRotated: '2026-07-20', expiresAt: '2026-10-20', daysRemaining: 58, status: 'healthy' },
  { id: 'SEC-05', name: 'Model artifact signing key', scope: 'Model release pipeline', lastRotated: '2026-06-28', expiresAt: '2026-09-28', daysRemaining: 36, status: 'healthy' },
  { id: 'SEC-06', name: 'Admin SSO client secret', scope: 'Authentication', lastRotated: '2026-04-30', expiresAt: '2026-08-30', daysRemaining: 7, status: 'warning' },
  { id: 'SEC-07', name: 'Archive object storage key', scope: 'Cold storage', lastRotated: '2026-07-05', expiresAt: '2026-10-05', daysRemaining: 43, status: 'healthy' },
  { id: 'SEC-08', name: 'OddsHub API key', scope: 'Provider integration', lastRotated: '2026-05-20', expiresAt: '2026-08-20', daysRemaining: -3, status: 'expired' },
]

export const RATE_LIMIT_INCIDENTS: RateLimitIncident[] = pickMany(rng, [
  { id: 'RL-01', scope: 'IP 203.0.113.42', endpoint: '/admin/api/fixtures', count: 812, windowMin: 5, lastHit: isoOffset(-14), status: 'active' as const },
  { id: 'RL-02', scope: 'User adm-0007', endpoint: '/admin/api/replay-dead-letter', count: 41, windowMin: 10, lastHit: isoOffset(-120), status: 'resolved' as const },
  { id: 'RL-03', scope: 'IP 198.51.100.9', endpoint: '/admin/api/search', count: 260, windowMin: 5, lastHit: isoOffset(-1900), status: 'resolved' as const },
  { id: 'RL-04', scope: 'Service token svc-reporting', endpoint: '/admin/api/predictions', count: 1204, windowMin: 15, lastHit: isoOffset(-6), status: 'active' as const },
], 4)
