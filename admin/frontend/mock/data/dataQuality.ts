import type { DataQualityDomain } from '../../types/domain'

export const DATA_QUALITY_DOMAINS: DataQualityDomain[] = [
  { id: 'dq-fixtures', name: 'Fixtures', coveragePct: 99.6, freshnessMin: 4, missingnessPct: 0.4, source: 'API-Football', season: '2026/27', league: 'All leagues', status: 'READY', threshold: 99 },
  { id: 'dq-results', name: 'Results', coveragePct: 99.9, freshnessMin: 2, missingnessPct: 0.1, source: 'API-Football', season: '2026/27', league: 'All leagues', status: 'READY', threshold: 99 },
  { id: 'dq-standings', name: 'Standings', coveragePct: 98.7, freshnessMin: 18, missingnessPct: 1.3, source: 'API-Football', season: '2026/27', league: 'All leagues', status: 'READY', threshold: 95 },
  { id: 'dq-h2h', name: 'Head-to-Head', coveragePct: 96.4, freshnessMin: 90, missingnessPct: 3.6, source: 'API-Football', season: '2020–2026', league: 'All leagues', status: 'READY', threshold: 95 },
  { id: 'dq-lineups', name: 'Lineups', coveragePct: 91.2, freshnessMin: 12, missingnessPct: 8.8, source: 'API-Football', season: '2026/27', league: 'All leagues', status: 'PARTIAL', threshold: 95 },
  { id: 'dq-injuries', name: 'Injuries', coveragePct: 87.5, freshnessMin: 41, missingnessPct: 12.5, source: 'API-Football', season: '2026/27', league: 'Ligue 1, Brasileirao', status: 'PARTIAL', threshold: 95 },
  { id: 'dq-corners', name: 'Corners (historical)', coveragePct: 94.8, freshnessMin: 30, missingnessPct: 5.2, source: 'API-Football', season: '2021–2026', league: 'All leagues', status: 'PARTIAL', threshold: 95 },
  { id: 'dq-cards', name: 'Cards (historical)', coveragePct: 95.9, freshnessMin: 30, missingnessPct: 4.1, source: 'API-Football', season: '2021–2026', league: 'All leagues', status: 'READY', threshold: 95 },
  { id: 'dq-player', name: 'Player-level data', coveragePct: 73.6, freshnessMin: 60, missingnessPct: 26.4, source: 'API-Football + PropLine', season: '2023–2026', league: 'Tier 1 leagues only', status: 'STALE', threshold: 95 },
  { id: 'dq-unstructured', name: 'Unstructured signals (press, news)', coveragePct: 58.1, freshnessMin: 150, missingnessPct: 41.9, source: 'Internal ingestion', season: 'Rolling', league: 'Tier 1 leagues only', status: 'STALE', threshold: 80 },
  { id: 'dq-odds', name: 'Odds / prices', coveragePct: 81.2, freshnessMin: 3, missingnessPct: 18.8, source: 'PropLine + OddsHub', season: '2026/27', league: 'All leagues', status: 'PARTIAL', threshold: 95 },
  { id: 'dq-mls', name: 'MLS core dataset', coveragePct: 41.0, freshnessMin: 4200, missingnessPct: 59.0, source: 'API-Football', season: '2024–2025', league: 'MLS (disabled)', status: 'MISSING', threshold: 99 },
]
