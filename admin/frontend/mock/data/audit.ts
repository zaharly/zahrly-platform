import type { AuditEvent, AdminRole } from '../../types/domain'
import { ADMIN_USERS } from './security'
import { makeRng, pick, rangeInt, uid, isoOffset } from '../factories/rng'

const rng = makeRng(90210)

const ACTIONS: Array<{ action: string; entityType: string; sensitive: boolean }> = [
  { action: 'disable_league', entityType: 'League', sensitive: true },
  { action: 'enable_league', entityType: 'League', sensitive: true },
  { action: 'retry_job', entityType: 'Job', sensitive: false },
  { action: 'replay_dead_letter', entityType: 'Job', sensitive: true },
  { action: 'promote_model', entityType: 'Model', sensitive: true },
  { action: 'rollback_model', entityType: 'Model', sensitive: true },
  { action: 'quarantine_endpoint', entityType: 'Provider Endpoint', sensitive: true },
  { action: 'change_market_status', entityType: 'Market', sensitive: true },
  { action: 'update_policy', entityType: 'Policy Setting', sensitive: true },
  { action: 'resolve_incident', entityType: 'Incident', sensitive: false },
  { action: 'rotate_secret', entityType: 'Secret', sensitive: true },
  { action: 'run_backfill_tranche', entityType: 'Backfill Tranche', sensitive: false },
  { action: 'revalidate_fixture', entityType: 'Fixture', sensitive: false },
  { action: 'update_geo_policy', entityType: 'Jurisdiction Policy', sensitive: true },
]

const ENTITY_IDS = ['premier-league', 'eredivisie', 'JOB-ODD-0012', 'model-v1-8-3', 'model-v1-8-0', 'PropLine:/v2/odds/prematch', 'mkt-correct-score', 'sim-policy-v6', 'INC-0014', 'SEC-03', 'BF-2022-23-la-liga', 'FX-PRE-0004', 'geo-policy-v4.2']

export const AUDIT_EVENTS: AuditEvent[] = Array.from({ length: 34 }, (_, i) => {
  const { action, entityType, sensitive } = pick(rng, ACTIONS)
  const actor = pick(rng, ADMIN_USERS)
  return {
    id: uid('AUD', i + 1),
    actorName: actor.name,
    role: actor.role as AdminRole,
    action,
    entityType,
    entityId: pick(rng, ENTITY_IDS),
    beforeHash: sensitive ? `sha256:${Math.abs(Math.floor(rng() * 1e12)).toString(16)}` : null,
    afterHash: sensitive ? `sha256:${Math.abs(Math.floor(rng() * 1e12)).toString(16)}` : null,
    reason: sensitive ? pick(rng, [
      'Scheduled governance review', 'Incident remediation', 'Provider quota exhaustion',
      'Consistency gate failure', 'Compliance policy update', 'Operator-requested rollback',
    ]) : null,
    ticketOrIncident: rng() < 0.4 ? uid('INC', rangeInt(rng, 1, 24)) : null,
    createdAt: isoOffset(-rangeInt(rng, 5, 12000)),
  }
}).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
