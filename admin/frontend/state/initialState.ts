import type { StoreState } from './types'
import { COUNTRIES } from '../mock/data/countries'
import { LEAGUES } from '../mock/data/leagues'
import { FIXTURES } from '../mock/data/fixtures'
import { EVIDENCE_EVENTS } from '../mock/data/evidence'
import { PREDICTIONS } from '../mock/data/predictions'
import { MARKETS } from '../mock/data/markets'
import { SIMULATION_RUNS } from '../mock/data/simulations'
import { PROVIDERS } from '../mock/data/providers'
import { PROVIDER_CONFLICTS } from '../mock/data/conflicts'
import { SCHEMA_DRIFT_EVENTS } from '../mock/data/schemaDrift'
import { QUEUES } from '../mock/data/queues'
import { JOBS } from '../mock/data/jobs'
import { WORKERS } from '../mock/data/workers'
import { MODEL_VERSIONS } from '../mock/data/models'
import { ADMIN_USERS, SECRET_ROTATIONS, RATE_LIMIT_INCIDENTS } from '../mock/data/security'
import { POLICY_SETTINGS, FEATURE_FLAGS } from '../mock/data/settings'
import { AUDIT_EVENTS } from '../mock/data/audit'
import { INCIDENTS } from '../mock/data/incidents'
import { BOOTSTRAP_CAMPAIGN, BOOTSTRAP_SEASONS, TRANCHE_QUEUE } from '../mock/data/bootstrap'
import { ARCHIVE_RECORDS } from '../mock/data/archive'
import { DATA_QUALITY_DOMAINS } from '../mock/data/dataQuality'
import { DRIFT_METRICS } from '../mock/data/driftMetrics'
import { SHADOW_EVALUATIONS } from '../mock/data/shadowEvaluations'
import { JURISDICTION_POLICIES } from '../mock/data/jurisdiction'

/**
 * Builds a fresh, deep-enough copy of every mock dataset so the running session
 * can mutate state without touching the original generator modules (which stay
 * the read-only "seed" for a fresh reload).
 */
export function buildInitialState(): StoreState {
  return {
    countries: COUNTRIES.map((c) => ({ ...c })),
    leagues: LEAGUES.map((l) => ({ ...l, providers: [...l.providers], historicalSeasons: [...l.historicalSeasons] })),
    fixtures: FIXTURES.map((f) => ({ ...f })),
    evidenceEvents: EVIDENCE_EVENTS.map((e) => ({ ...e, affectedFeatures: [...e.affectedFeatures] })),
    predictions: PREDICTIONS.map((p) => ({ ...p })),
    markets: MARKETS.map((m) => ({ ...m })),
    simulationRuns: SIMULATION_RUNS.map((s) => ({ ...s, checkpoints: [...s.checkpoints] })),
    providers: PROVIDERS.map((p) => ({ ...p, quotaHistory: [...p.quotaHistory] })),
    providerConflicts: PROVIDER_CONFLICTS.map((c) => ({ ...c })),
    schemaDriftEvents: SCHEMA_DRIFT_EVENTS.map((e) => ({ ...e })),
    queues: QUEUES.map((q) => ({ ...q })),
    jobs: JOBS.map((j) => ({ ...j })),
    workers: WORKERS.map((w) => ({ ...w })),
    modelVersions: MODEL_VERSIONS.map((m) => ({ ...m, metrics: { ...m.metrics } })),
    adminUsers: ADMIN_USERS.map((a) => ({ ...a })),
    secretRotations: SECRET_ROTATIONS.map((s) => ({ ...s })),
    policySettings: POLICY_SETTINGS.map((p) => ({ ...p })),
    policyDrafts: [],
    auditEvents: AUDIT_EVENTS.map((a) => ({ ...a })),
    incidents: INCIDENTS.map((i) => ({ ...i, affectedEntities: [...i.affectedEntities], timeline: [...i.timeline] })),
    bootstrapCampaign: { ...BOOTSTRAP_CAMPAIGN, reserve: { ...BOOTSTRAP_CAMPAIGN.reserve } },
    bootstrapSeasons: BOOTSTRAP_SEASONS.map((s) => ({ ...s })),
    trancheQueue: TRANCHE_QUEUE.map((t) => ({ ...t })),
    archiveRecords: ARCHIVE_RECORDS.map((a) => ({ ...a })),
    rateLimitIncidents: RATE_LIMIT_INCIDENTS.map((r) => ({ ...r })),
    dataQualityDomains: DATA_QUALITY_DOMAINS.map((d) => ({ ...d })),
    driftMetrics: DRIFT_METRICS.map((d) => ({ ...d })),
    shadowEvaluations: SHADOW_EVALUATIONS.map((s) => ({ ...s, timeline: [...s.timeline] })),
    jurisdictionPolicies: JURISDICTION_POLICIES.map((j) => ({ ...j })),
    featureFlags: FEATURE_FLAGS.map((f) => ({ ...f })),
  }
}
