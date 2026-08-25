import type {
  Country, League, Fixture, EvidenceEvent, PredictionRecord, Market, SimulationRun,
  Provider, ProviderConflict, SchemaDriftEvent, QueueStat, Job, Worker, ModelVersion,
  AdminUser, SecretRotation, PolicySetting, PolicyDraft, AuditEvent, Incident,
  BootstrapCampaign, BootstrapSeason, TrancheQueueItem, ArchiveSeasonRecord,
  RateLimitIncident, DataQualityDomain, DriftMetric, ShadowEvaluation, JurisdictionPolicy,
  FeatureFlag,
} from '../types/domain'

/** Full mutable in-memory state for the ZAHRLY admin console mock control plane. */
export interface StoreState {
  countries: Country[]
  leagues: League[]
  fixtures: Fixture[]
  evidenceEvents: EvidenceEvent[]
  predictions: PredictionRecord[]
  markets: Market[]
  simulationRuns: SimulationRun[]
  providers: Provider[]
  providerConflicts: ProviderConflict[]
  schemaDriftEvents: SchemaDriftEvent[]
  queues: QueueStat[]
  jobs: Job[]
  workers: Worker[]
  modelVersions: ModelVersion[]
  adminUsers: AdminUser[]
  secretRotations: SecretRotation[]
  policySettings: PolicySetting[]
  policyDrafts: PolicyDraft[]
  auditEvents: AuditEvent[]
  incidents: Incident[]
  bootstrapCampaign: BootstrapCampaign
  bootstrapSeasons: BootstrapSeason[]
  trancheQueue: TrancheQueueItem[]
  archiveRecords: ArchiveSeasonRecord[]
  rateLimitIncidents: RateLimitIncident[]
  dataQualityDomains: DataQualityDomain[]
  driftMetrics: DriftMetric[]
  shadowEvaluations: ShadowEvaluation[]
  jurisdictionPolicies: JurisdictionPolicy[]
  featureFlags: FeatureFlag[]
}

export type SetStore = (updater: (prev: StoreState) => StoreState) => void

/** Common context every action needs: who performed it, and why. */
export interface ActorContext {
  actorName?: string
  role?: import('../types/domain').AdminRole
}
