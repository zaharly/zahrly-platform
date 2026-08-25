// ZAHRLY Admin Dashboard — shared domain types (UI template, mock-data driven)

export type HealthState = 'healthy' | 'degraded' | 'warning' | 'critical' | 'offline'
export type AlertSeverity = 'critical' | 'warning' | 'info'

export type CountryStatus = 'ENABLED' | 'PAUSED' | 'DISABLED' | 'ARCHIVED'
export type LeagueStatus = 'ENABLED' | 'PAUSED' | 'DISABLED' | 'ARCHIVED'
export type SeasonScope = 'ACTIVE' | 'ARCHIVE_ONLY' | 'BLOCKED'

export type PredictionState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'ABSTAINED'
export type MarketState = 'PRODUCTION_ENABLED' | 'EXPERIMENTAL' | 'ABSTAIN' | 'PREDICTED_ONLY' | 'RECOMMENDABLE'
export type DataQualityState = 'READY' | 'PARTIAL' | 'STALE' | 'MISSING'

export type ModelStatus = 'CANDIDATE' | 'SHADOW' | 'ACTIVE' | 'RETIRED' | 'REJECTED' | 'ROLLBACK'
export type ShadowVerdict = 'CANDIDATE_BETTER' | 'NO_MATERIAL_DIFFERENCE' | 'REGRESSION' | 'NOT_ENOUGH_DATA'

export type QueueName =
  | 'CONTROL_QUEUE'
  | 'BACKFILL_QUEUE'
  | 'FIXTURE_QUEUE'
  | 'ODDS_QUEUE'
  | 'ENRICHMENT_QUEUE'
  | 'PREDICTION_QUEUE'
  | 'REPAIR_QUEUE'
  | 'EVALUATION_QUEUE'
  | 'MODEL_TRAINING_QUEUE'

export type WorkerStatus = 'HEALTHY' | 'BUSY' | 'DEGRADED' | 'UNHEALTHY' | 'DRAINING' | 'OFFLINE'
export type JobStatus = 'PENDING' | 'RUNNING' | 'RETRYING' | 'FAILED' | 'DEAD_LETTER' | 'COMPLETED'

export type IncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3'
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED' | 'CLOSED'
export type IncidentCategory =
  | 'Provider'
  | 'Data'
  | 'Prediction'
  | 'Model'
  | 'Queue'
  | 'Database'
  | 'Security'
  | 'Compliance'
  | 'Archive'
  | 'Performance'

export type ArchiveStatus = 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'CORRUPTED' | 'REPAIR_REQUIRED'
export type ConflictState = 'OPEN' | 'CORROBORATED' | 'RESOLVED' | 'QUARANTINED' | 'REPLAY_REQUIRED'
export type SchemaDriftStatus = 'DETECTED' | 'QUARANTINED' | 'TESTING' | 'APPROVED' | 'RESUMED'
export type ConsistencyState = 'PASS' | 'WARNING' | 'FAILED'
export type SimulationMode = 'Routine' | 'Material' | 'Final Lock' | 'Research'
export type SimulationOutcome = 'converged' | 'capped' | 'lower-confidence'
export type GeoStatus = 'ALLOWED' | 'RESTRICTED' | 'BLOCKED' | 'UNKNOWN'
export type BootstrapSeasonStatus = 'COMPLETE' | 'IN PROGRESS' | 'PARTIAL' | 'BLOCKED' | 'WAITING' | 'NOT STARTED'

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'OPERATIONS_ADMIN'
  | 'DATA_ADMIN'
  | 'PREDICTION_ADMIN'
  | 'MODEL_ADMIN'
  | 'MARKET_ADMIN'
  | 'COMPLIANCE_ADMIN'
  | 'AUDITOR'
  | 'READ_ONLY'

export interface Country {
  id: string
  name: string
  code: string
  status: CountryStatus
  leagueCount: number
  activeFixtures: number
  historicalProgressPct: number
  providerCoveragePct: number
  lastSync: string
}

export interface League {
  id: string
  countryId: string
  countryName: string
  name: string
  status: LeagueStatus
  seasonScope: SeasonScope
  providers: string[]
  currentSeason: string
  historicalSeasons: string[]
  fixtureCount: number
  predictionCount: number
  marketCoveragePct: number
  oddsCoveragePct: number
  completenessPct: number
  processingPolicy: string
  tier: 1 | 2 | 3
}

export interface Fixture {
  id: string
  kickoff: string
  countryId: string
  countryName: string
  leagueId: string
  leagueName: string
  homeTeam: string
  awayTeam: string
  episodeId: string
  predictionState: PredictionState
  marketState: MarketState
  dataReadinessPct: number
  oddsReadinessPct: number
  providerStatus: HealthState
  baselineStatus: 'LOCKED' | 'PENDING'
  baselinePick: string
  baselineProbability: number
  currentProbability: number
  modelVersion: string
  hasIncident: boolean
  isPast: boolean
  venue?: string
  round?: string
  matchStatus?: 'SCHEDULED' | 'POSTPONED' | 'CANCELLED' | 'COMPLETED'
  lastCorrectedAt?: string
}

export interface EvidenceEvent {
  id: string
  fixtureId: string
  timestamp: string
  label: string
  source: string
  affectedFeatures: string[]
  previousProbability: number
  newProbability: number
  delta: number
  modelVersion: string
  snapshotHash: string
  confidenceImpact: 'low' | 'medium' | 'high'
}

export interface PredictionRecord {
  id: string
  fixtureId: string
  fixtureLabel: string
  leagueName: string
  kickoff: string
  episodeId: string
  baselinePick: string
  baselineProbability: number
  currentProbability: number
  change: number
  modelVersion: string
  evidenceCount: number
  dataQuality: DataQualityState
  marketState: MarketState
  recommendationState: 'RECOMMENDABLE' | 'PREDICTED_ONLY' | 'ABSTAIN'
  predictionState: PredictionState
  lastUpdated: string
  consistency: ConsistencyState
  bestPrice: number | null
  priceAgeMin: number | null
}

export interface Market {
  id: string
  name: string
  family: 'RESULT' | 'GOALS' | 'CORNERS' | 'CARDS' | 'PLAYER_PROPS' | 'COMBINATIONS'
  status: MarketState
  predictionCoveragePct: number
  calibrationEce: number
  sampleSize: number
  oosQuality: 'strong' | 'moderate' | 'weak'
  dependencyEligible: boolean
  settlementSemantics: string
  providerCoveragePct: number
  lastValidation: string
  lastRevalidation: string
}

export interface ConsistencyCheck {
  id: string
  rule: string
  category: string
  state: ConsistencyState
  market: string
  fixtureLabel: string
  observed: string
  expected: string
  incidentId: string | null
}

export interface SimulationCheckpoint {
  samples: number
  halfWidth: number
}

export type SimulationRunStatus = 'queued' | 'running' | 'done'

export interface SimulationRun {
  id: string
  fixtureLabel: string
  mode: SimulationMode
  samplesUsed: number
  samplesCap: number
  se: number
  halfWidth: number
  runtimeP50: number
  runtimeP95: number
  runtimeP99: number
  memoryMb: number
  dependencyProfile: string
  outcome: SimulationOutcome
  checkpoints: SimulationCheckpoint[]
  topRecommendationStable: boolean
  sparseEventHits: number
  startedAt: string
  runStatus: SimulationRunStatus
}

export interface Provider {
  id: string
  name: string
  status: HealthState
  plan: string
  quotaTotal: number
  quotaUsed: number
  requestsPerSec: number
  errorRatePct: number
  rateLimit429: number
  latencyMs: number
  coveragePct: number
  schemaVersion: string
  lastSchemaCheck: string
  quotaHistory: number[]
}

export interface ProviderConflict {
  id: string
  fixtureLabel: string
  field: string
  providerA: string
  valueA: string
  providerB: string
  valueB: string
  timestamp: string
  trustScore: number
  confidence: 'low' | 'medium' | 'high'
  materialToPrediction: boolean
  state: ConflictState
}

export interface SchemaDriftEvent {
  id: string
  provider: string
  endpoint: string
  oldFingerprint: string
  newFingerprint: string
  detectedAt: string
  severity: AlertSeverity
  status: SchemaDriftStatus
  adapterVersion: string
  regressionSuite: 'passing' | 'failing' | 'pending'
  productionState: 'blocked' | 'resumed'
}

export interface QueueStat {
  name: QueueName
  label: string
  depth: number
  oldestJobAgeMin: number
  p50AgeMin: number
  p95AgeMin: number
  throughputPerMin: number
  failures: number
  retrying: number
  deadLetter: number
  workers: number
  slaStatus: HealthState
  paused?: boolean
}

export interface Job {
  id: string
  queue: QueueName
  status: JobStatus
  attempts: number
  worker: string | null
  leaseExpiresAt: string | null
  checkpoint: string
  error: string | null
  retryAt: string | null
  priority: 'low' | 'normal' | 'high'
  payloadSummary: string
  firstFailure: string | null
  lastFailure: string | null
}

export interface Worker {
  id: string
  class: string
  host: string
  version: string
  status: WorkerStatus
  cpuPct: number
  ramPct: number
  jobsProcessed: number
  successRatePct: number
  errorRatePct: number
  lastHeartbeat: string
  currentJob: string | null
  queue: QueueName
  throughputPerMin: number
  p95RuntimeMs: number
}

export interface ModelMetrics {
  logLoss: number
  brier: number
  rps: number
  ece: number
  clv: number
}

export interface ModelVersion {
  id: string
  family: string
  version: string
  status: ModelStatus
  trainingCutoff: string
  features: number
  metrics: ModelMetrics
  calibration: 'strong' | 'moderate' | 'weak'
  drift: HealthState
  shadowState: string | null
  createdAt: string
  promotedAt: string | null
}

export interface ShadowTimelinePoint {
  day: number
  candidateLogLoss: number
  incumbentLogLoss: number
  candidateClv: number
  incumbentClv: number
}

export interface ShadowEvaluation {
  id: string
  candidateId: string
  candidateVersion: string
  incumbentId: string
  incumbentVersion: string
  shadowDurationDays: number
  fixturesEvaluated: number
  logLoss: number
  brier: number
  rps: number
  ece: number
  clv: number
  abstentionRatePct: number
  runtimeMs: number
  verdict: ShadowVerdict
  timeline: ShadowTimelinePoint[]
}

export interface DriftMetric {
  id: string
  category: 'Model' | 'Data' | 'Feature' | 'Provider' | 'Calibration' | 'Market'
  metric: string
  baseline: number
  current: number
  threshold: number
  durationHours: number
  severity: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL'
  trigger: string
}

export interface DataQualityDomain {
  id: string
  name: string
  coveragePct: number
  freshnessMin: number
  missingnessPct: number
  source: string
  season: string
  league: string
  status: DataQualityState
  threshold: number
}

export interface ArchiveSeasonRecord {
  season: string
  status: ArchiveStatus
  checksum: string
  rowCount: number
  objectUri: string
  manifestId: string
  completenessPct: number
  createdAt: string
  country: string
  league: string
  dataset: string
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: AdminRole
  mfaEnabled: boolean
  lastLogin: string
  sessionStatus: 'active' | 'idle' | 'revoked'
  accountStatus: 'active' | 'disabled'
}

export interface SecretRotation {
  id: string
  name: string
  scope: string
  lastRotated: string
  expiresAt: string
  daysRemaining: number
  status: 'healthy' | 'warning' | 'expired'
}

export interface RateLimitIncident {
  id: string
  scope: string
  endpoint: string
  count: number
  windowMin: number
  lastHit: string
  status: 'active' | 'resolved'
}

export interface JurisdictionPolicy {
  country: string
  geoStatus: GeoStatus
  ageRequirement: number | null
  bookmakerAvailability: 'available' | 'unavailable'
  affiliateAvailability: 'available' | 'unavailable'
  ctaState: 'CTA_ENABLED' | 'NO_CTA'
  rgNotice: boolean
  policyVersion: string
  lastVerified: string
}

export interface AuditEvent {
  id: string
  actorName: string
  role: AdminRole
  action: string
  entityType: string
  entityId: string
  beforeHash: string | null
  afterHash: string | null
  reason: string | null
  ticketOrIncident: string | null
  createdAt: string
}

export interface IncidentTimelineEntry {
  ts: string
  note: string
}

export interface Incident {
  id: string
  severity: IncidentSeverity
  category: IncidentCategory
  title: string
  status: IncidentStatus
  owner: string
  affectedEntities: string[]
  impact: string
  timeline: IncidentTimelineEntry[]
  resolution: string | null
  createdAt: string
  updatedAt: string
}

export interface Alert {
  id: string
  severity: AlertSeverity
  title: string
  message: string
  linkTo: string
  owner: string
  createdAt: string
}

export interface BootstrapSeason {
  season: string
  status: BootstrapSeasonStatus
  competitions: number
  fixtures: number
  coreCompletenessPct: number
  enrichmentCompletenessPct: number
  specializedCompletenessPct: number
  requestsUsed: number
  archiveStatus: ArchiveStatus
}

export interface TrancheQueueItem {
  id: string
  country: string
  league: string
  season: string
  datasetType: string
  priority: 'low' | 'normal' | 'high'
  progressPct: number
  requestsUsed: number
  lastWatermark: string
}

export interface FeatureFlag {
  id: string
  name: string
  description: string
  enabled: boolean
  environment: 'production' | 'staging' | 'all'
  lastChanged: string
  changedBy: string
}

export interface PolicySetting {
  id: string
  name: string
  category: string
  value: string
  policyVersion: string
  lastChanged: string
  changedBy: string
  effectiveAt: string
}

export type PolicyDraftStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ACTIVATED' | 'REJECTED'

export interface PolicyDraft {
  id: string
  policyId: string
  policyName: string
  proposedValue: string
  status: PolicyDraftStatus
  createdBy: string
  createdAt: string
  approvedBy: string | null
  approvedAt: string | null
}

export type BootstrapCampaignStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED'

export interface BootstrapCampaign {
  status: BootstrapCampaignStatus
  minDurationDays: number
  elapsedDays: number
  expectedCompletion: string
  priority: string
  overallCompletenessPct: number
  seasonsCompleted: number
  seasonsTotal: number
  leaguesCompleted: number
  leaguesTotal: number
  datasetsCompleted: number
  datasetsTotal: number
  requestsConsumed: number
  requestsBudget: number
  currentTranche: string
  nextTranche: string
  reserve: { production: number; repair: number; backfill: number }
}
