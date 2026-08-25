import type { ArchiveSeasonRecord } from '../../types/domain'
import { makeRng, pick, rangeInt, round, uid, isoOffset } from '../factories/rng'
import type { ArchiveStatus } from '../../types/domain'

const rng = makeRng(881220)

const SEASONS = ['2020/21', '2021/22', '2022/23', '2023/24', '2024/25', '2025/26', '2026/27']
const LEAGUE_SAMPLES = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Primeira Liga', 'Brasileirao']
const COUNTRY_SAMPLES = ['England', 'Spain', 'Italy', 'Germany', 'France', 'Portugal', 'Brazil']
const DATASETS = ['core fixtures', 'enrichment bundle', 'specialized markets', 'odds history', 'lineup archive']

function statusForSeason(season: string): ArchiveStatus {
  if (season === '2026/27') return 'PARTIAL'
  if (season === '2020/21') return rng() < 0.7 ? 'COMPLETE' : 'REPAIR_REQUIRED'
  return rng() < 0.85 ? 'COMPLETE' : rng() < 0.6 ? 'PARTIAL' : 'BLOCKED'
}

export const ARCHIVE_RECORDS: ArchiveSeasonRecord[] = SEASONS.flatMap((season, sIdx) =>
  LEAGUE_SAMPLES.slice(0, sIdx % 3 === 0 ? 7 : 4).map((league, lIdx) => {
    const country = COUNTRY_SAMPLES[LEAGUE_SAMPLES.indexOf(league)] ?? 'England'
    const status = statusForSeason(season)
    return {
      season,
      status,
      checksum: `sha256:${Math.abs(Math.floor(rng() * 1e13)).toString(16)}`,
      rowCount: rangeInt(rng, 12000, 480000),
      objectUri: `s3://zahrly-archive/${season.replace('/', '-')}/${league.toLowerCase().replace(/\s+/g, '-')}/manifest.json`,
      manifestId: uid('MANIFEST', sIdx * 10 + lIdx + 1),
      completenessPct: status === 'COMPLETE' ? round(rangeInt(rng, 98, 100)) : status === 'PARTIAL' ? round(rangeInt(rng, 60, 92)) : round(rangeInt(rng, 10, 55)),
      createdAt: isoOffset(-rangeInt(rng, 400, 30000)),
      country,
      league,
      dataset: pick(rng, DATASETS),
    }
  })
)

export interface SeasonSummary {
  season: string
  completenessPct: number
  recordCount: number
  status: ArchiveStatus
}

export const ARCHIVE_SEASON_SUMMARY: SeasonSummary[] = SEASONS.map((season) => {
  const records = ARCHIVE_RECORDS.filter((r) => r.season === season)
  const avgCompleteness = records.reduce((sum, r) => sum + r.completenessPct, 0) / Math.max(records.length, 1)
  const worstStatus: ArchiveStatus = records.some((r) => r.status === 'BLOCKED' || r.status === 'CORRUPTED')
    ? 'BLOCKED'
    : records.some((r) => r.status === 'REPAIR_REQUIRED')
      ? 'REPAIR_REQUIRED'
      : records.every((r) => r.status === 'COMPLETE')
        ? 'COMPLETE'
        : 'PARTIAL'
  return {
    season,
    completenessPct: round(avgCompleteness),
    recordCount: records.length,
    status: worstStatus,
  }
})
