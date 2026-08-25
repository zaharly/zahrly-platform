import type { ProviderConflict } from '../../types/domain'
import { FIXTURES, fixtureLabel } from './fixtures'
import { CONFLICT_FIELDS } from '../factories/names'
import { makeRng, pick, range, round, uid, isoOffset, rangeInt } from '../factories/rng'
import type { ConflictState } from '../../types/domain'

const rng = makeRng(310420)
const STATES: ConflictState[] = ['OPEN', 'CORROBORATED', 'RESOLVED', 'QUARANTINED', 'REPLAY_REQUIRED']

const SAMPLE_VALUES: Record<string, [string, string]> = {
  'Kickoff time': ['15:00 UTC', '15:30 UTC'],
  'Venue': ['Home stadium', 'Neutral venue (unconfirmed)'],
  'Starting lineup': ['Confirmed 11 (source A)', 'Confirmed 11 (source B, 2 differences)'],
  'Referee': ['M. Oliver', 'A. Taylor'],
  'Home/away designation': ['Home', 'Away (fixture reversed)'],
  'Player injury status': ['Fit', 'Doubtful'],
  'Match status': ['Scheduled', 'Postponed'],
  'Attendance capacity': ['61,000', '58,500'],
}

export const PROVIDER_CONFLICTS: ProviderConflict[] = FIXTURES.slice(4, 16).map((f, idx) => {
  const field = pick(rng, CONFLICT_FIELDS)
  const [valueA, valueB] = SAMPLE_VALUES[field] ?? ['Value A', 'Value B']
  const material = rng() < 0.4
  return {
    id: uid('CONF', idx + 1),
    fixtureLabel: fixtureLabel(f),
    field,
    providerA: 'API-Football',
    valueA: valueA ?? 'Value A',
    providerB: rng() < 0.7 ? 'PropLine' : 'OddsHub',
    valueB: valueB ?? 'Value B',
    timestamp: isoOffset(-rangeInt(rng, 5, 4000)),
    trustScore: round(range(rng, 0.55, 0.97), 2),
    confidence: material ? (rng() < 0.5 ? 'high' : 'medium') : 'low',
    materialToPrediction: material,
    state: pick(rng, STATES),
  }
})
