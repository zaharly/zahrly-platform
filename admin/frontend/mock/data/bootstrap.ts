import type { BootstrapSeason, TrancheQueueItem, BootstrapCampaign } from '../../types/domain'

export const BOOTSTRAP_CAMPAIGN: BootstrapCampaign = {
  status: 'ACTIVE',
  minDurationDays: 60,
  elapsedDays: 31,
  expectedCompletion: '2026-10-14',
  priority: 'BACKGROUND / PRODUCTION-SAFE',
  overallCompletenessPct: 64.3,
  seasonsCompleted: 2,
  seasonsTotal: 7,
  leaguesCompleted: 5,
  leaguesTotal: 12,
  datasetsCompleted: 31,
  datasetsTotal: 58,
  requestsConsumed: 218_400,
  requestsBudget: 340_000,
  currentTranche: 'Serie A — 2022/23 — specialized markets dataset',
  nextTranche: 'Bundesliga — 2021/22 — enrichment bundle',
  reserve: { production: 30, repair: 10, backfill: 60 },
}

export const BOOTSTRAP_SEASONS: BootstrapSeason[] = [
  { season: '2020', status: 'COMPLETE', competitions: 9, fixtures: 3120, coreCompletenessPct: 100, enrichmentCompletenessPct: 99.4, specializedCompletenessPct: 96.2, requestsUsed: 41200, archiveStatus: 'COMPLETE' },
  { season: '2021', status: 'COMPLETE', competitions: 10, fixtures: 3340, coreCompletenessPct: 99.8, enrichmentCompletenessPct: 98.7, specializedCompletenessPct: 94.5, requestsUsed: 43800, archiveStatus: 'COMPLETE' },
  { season: '2022', status: 'IN PROGRESS', competitions: 11, fixtures: 3480, coreCompletenessPct: 92.1, enrichmentCompletenessPct: 78.4, specializedCompletenessPct: 52.0, requestsUsed: 51200, archiveStatus: 'PARTIAL' },
  { season: '2023', status: 'IN PROGRESS', competitions: 12, fixtures: 3560, coreCompletenessPct: 71.5, enrichmentCompletenessPct: 48.2, specializedCompletenessPct: 21.3, requestsUsed: 46900, archiveStatus: 'PARTIAL' },
  { season: '2024', status: 'PARTIAL', competitions: 12, fixtures: 3610, coreCompletenessPct: 44.8, enrichmentCompletenessPct: 22.0, specializedCompletenessPct: 6.1, requestsUsed: 28400, archiveStatus: 'PARTIAL' },
  { season: '2025', status: 'WAITING', competitions: 12, fixtures: 3650, coreCompletenessPct: 8.2, enrichmentCompletenessPct: 0, specializedCompletenessPct: 0, requestsUsed: 6900, archiveStatus: 'BLOCKED' },
  { season: '2026', status: 'NOT STARTED', competitions: 12, fixtures: 0, coreCompletenessPct: 0, enrichmentCompletenessPct: 0, specializedCompletenessPct: 0, requestsUsed: 0, archiveStatus: 'BLOCKED' },
]

export const TRANCHE_QUEUE: TrancheQueueItem[] = [
  { id: 'TR-01', country: 'Italy', league: 'Serie A', season: '2022/23', datasetType: 'Specialized markets', priority: 'high', progressPct: 62, requestsUsed: 8120, lastWatermark: '2023-02-14' },
  { id: 'TR-02', country: 'Germany', league: 'Bundesliga', season: '2021/22', datasetType: 'Enrichment bundle', priority: 'normal', progressPct: 18, requestsUsed: 2140, lastWatermark: '2021-11-02' },
  { id: 'TR-03', country: 'France', league: 'Ligue 1', season: '2023/24', datasetType: 'Core fixtures', priority: 'normal', progressPct: 84, requestsUsed: 6410, lastWatermark: '2024-01-19' },
  { id: 'TR-04', country: 'Portugal', league: 'Primeira Liga', season: '2022/23', datasetType: 'Odds history', priority: 'low', progressPct: 41, requestsUsed: 1890, lastWatermark: '2022-12-08' },
  { id: 'TR-05', country: 'Brazil', league: 'Brasileirao Serie A', season: '2024', datasetType: 'Core fixtures', priority: 'high', progressPct: 29, requestsUsed: 3050, lastWatermark: '2024-05-11' },
  { id: 'TR-06', country: 'Spain', league: 'Segunda Division', season: '2023/24', datasetType: 'Enrichment bundle', priority: 'low', progressPct: 0, requestsUsed: 0, lastWatermark: '—' },
  { id: 'TR-07', country: 'Netherlands', league: 'Eredivisie', season: '2024/25', datasetType: 'Core fixtures', priority: 'low', progressPct: 0, requestsUsed: 0, lastWatermark: '—' },
  { id: 'TR-08', country: 'England', league: 'Championship', season: '2021/22', datasetType: 'Specialized markets', priority: 'normal', progressPct: 55, requestsUsed: 5230, lastWatermark: '2022-01-30' },
]
