import type { League } from '../../types/domain'

export const LEAGUES: League[] = [
  {
    id: 'premier-league', countryId: 'gb', countryName: 'England', name: 'Premier League',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football', 'PropLine'],
    currentSeason: '2026/27', historicalSeasons: ['2020/21', '2021/22', '2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 380, predictionCount: 372, marketCoveragePct: 98.6, oddsCoveragePct: 99.2, completenessPct: 99.4,
    processingPolicy: 'Full enrichment + all markets', tier: 1,
  },
  {
    id: 'championship', countryId: 'gb', countryName: 'England', name: 'Championship',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football', 'PropLine'],
    currentSeason: '2026/27', historicalSeasons: ['2021/22', '2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 552, predictionCount: 528, marketCoveragePct: 91.2, oddsCoveragePct: 93.5, completenessPct: 96.8,
    processingPolicy: 'Standard enrichment', tier: 2,
  },
  {
    id: 'la-liga', countryId: 'es', countryName: 'Spain', name: 'La Liga',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football', 'PropLine'],
    currentSeason: '2026/27', historicalSeasons: ['2020/21', '2021/22', '2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 380, predictionCount: 366, marketCoveragePct: 97.1, oddsCoveragePct: 98.0, completenessPct: 98.9,
    processingPolicy: 'Full enrichment + all markets', tier: 1,
  },
  {
    id: 'segunda-division', countryId: 'es', countryName: 'Spain', name: 'Segunda Division',
    status: 'PAUSED', seasonScope: 'ACTIVE', providers: ['API-Football'],
    currentSeason: '2026/27', historicalSeasons: ['2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 462, predictionCount: 301, marketCoveragePct: 62.4, oddsCoveragePct: 58.1, completenessPct: 88.0,
    processingPolicy: 'Core dataset only — paused pending provider quota', tier: 3,
  },
  {
    id: 'serie-a', countryId: 'it', countryName: 'Italy', name: 'Serie A',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football', 'PropLine'],
    currentSeason: '2026/27', historicalSeasons: ['2020/21', '2021/22', '2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 380, predictionCount: 359, marketCoveragePct: 95.8, oddsCoveragePct: 96.9, completenessPct: 98.1,
    processingPolicy: 'Full enrichment + all markets', tier: 1,
  },
  {
    id: 'bundesliga', countryId: 'de', countryName: 'Germany', name: 'Bundesliga',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football', 'PropLine'],
    currentSeason: '2026/27', historicalSeasons: ['2020/21', '2021/22', '2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 306, predictionCount: 296, marketCoveragePct: 96.4, oddsCoveragePct: 97.3, completenessPct: 98.6,
    processingPolicy: 'Full enrichment + all markets', tier: 1,
  },
  {
    id: 'ligue-1', countryId: 'fr', countryName: 'France', name: 'Ligue 1',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football'],
    currentSeason: '2026/27', historicalSeasons: ['2021/22', '2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 306, predictionCount: 274, marketCoveragePct: 84.7, oddsCoveragePct: 80.2, completenessPct: 93.5,
    processingPolicy: 'Standard enrichment — PropLine coverage gap', tier: 2,
  },
  {
    id: 'eredivisie', countryId: 'nl', countryName: 'Netherlands', name: 'Eredivisie',
    status: 'PAUSED', seasonScope: 'BLOCKED', providers: ['API-Football'],
    currentSeason: '2026/27', historicalSeasons: ['2023/24', '2024/25', '2025/26'],
    fixtureCount: 306, predictionCount: 0, marketCoveragePct: 0, oddsCoveragePct: 0, completenessPct: 74.2,
    processingPolicy: 'Paused — awaiting re-enable review', tier: 3,
  },
  {
    id: 'primeira-liga', countryId: 'pt', countryName: 'Portugal', name: 'Primeira Liga',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football', 'PropLine'],
    currentSeason: '2026/27', historicalSeasons: ['2022/23', '2023/24', '2024/25', '2025/26'],
    fixtureCount: 306, predictionCount: 288, marketCoveragePct: 90.3, oddsCoveragePct: 88.5, completenessPct: 95.7,
    processingPolicy: 'Standard enrichment', tier: 2,
  },
  {
    id: 'brasileirao', countryId: 'br', countryName: 'Brazil', name: 'Brasileirao Serie A',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football'],
    currentSeason: '2026', historicalSeasons: ['2023', '2024', '2025'],
    fixtureCount: 380, predictionCount: 312, marketCoveragePct: 76.9, oddsCoveragePct: 68.4, completenessPct: 89.2,
    processingPolicy: 'Core + enrichment — odds coverage limited', tier: 2,
  },
  {
    id: 'mls', countryId: 'us', countryName: 'United States', name: 'MLS',
    status: 'DISABLED', seasonScope: 'BLOCKED', providers: [],
    currentSeason: '2026', historicalSeasons: ['2024', '2025'],
    fixtureCount: 0, predictionCount: 0, marketCoveragePct: 0, oddsCoveragePct: 0, completenessPct: 41.0,
    processingPolicy: 'Disabled — provider plan does not include endpoint', tier: 3,
  },
  {
    id: 'liga-mx', countryId: 'mx', countryName: 'Mexico', name: 'Liga MX',
    status: 'ENABLED', seasonScope: 'ACTIVE', providers: ['API-Football'],
    currentSeason: '2026/27', historicalSeasons: ['2024/25', '2025/26'],
    fixtureCount: 306, predictionCount: 201, marketCoveragePct: 58.7, oddsCoveragePct: 46.2, completenessPct: 81.4,
    processingPolicy: 'Core dataset only', tier: 3,
  },
]

export function getLeagueById(id: string): League | undefined {
  return LEAGUES.find((l) => l.id === id)
}
