import type { EvidenceEvent } from '../../types/domain'
import { FIXTURES } from './fixtures'
import { EVIDENCE_SOURCES } from '../factories/names'
import { makeRng, pick, range, clamp, round, uid } from '../factories/rng'

const rng = makeRng(9911)

const FEATURE_POOL = [
  'attack_strength', 'defense_strength', 'lineup_confidence', 'rest_days',
  'travel_distance', 'market_signal', 'weather_index', 'h2h_recency', 'referee_bias',
]

function buildEvidenceForFixture(fixtureId: string, baseline: number, current: number, kickoffIso: string, modelVersion: string): EvidenceEvent[] {
  const events: EvidenceEvent[] = []
  const kickoff = new Date(kickoffIso).getTime()
  const stepCount = Math.max(1, Math.round(range(rng, 2, 5)))
  let prev = baseline
  const totalDelta = current - baseline
  for (let i = 0; i < stepCount; i++) {
    const isLast = i === stepCount - 1
    const portion = isLast ? current - prev : round(totalDelta * range(rng, 0.1, 0.5))
    const next = isLast ? current : clamp(round(prev + portion), 3, 97)
    const hoursBeforeKickoff = [168, 120, 72, 24, 1.5][i] ?? 0.5
    events.push({
      id: uid(`${fixtureId}-EV`, i + 1),
      fixtureId,
      timestamp: new Date(kickoff - hoursBeforeKickoff * 3600_000).toISOString(),
      label: i === 0 ? 'Baseline established' : pick(rng, EVIDENCE_SOURCES),
      source: i === 0 ? 'Prediction Engine — historical baseline model' : pick(rng, EVIDENCE_SOURCES),
      affectedFeatures: i === 0 ? ['baseline_all_features'] : [pick(rng, FEATURE_POOL), pick(rng, FEATURE_POOL)],
      previousProbability: i === 0 ? next : prev,
      newProbability: next,
      delta: round(next - (i === 0 ? next : prev)),
      modelVersion,
      snapshotHash: `sha256:${Math.abs(Math.floor(rng() * 1e12)).toString(16)}`,
      confidenceImpact: Math.abs(next - prev) > 5 ? 'high' : Math.abs(next - prev) > 2 ? 'medium' : 'low',
    })
    prev = next
  }
  return events
}

export const EVIDENCE_EVENTS: EvidenceEvent[] = FIXTURES.flatMap((f) =>
  f.baselineStatus === 'LOCKED'
    ? buildEvidenceForFixture(f.id, f.baselineProbability, f.currentProbability, f.kickoff, f.modelVersion)
    : []
)

export function getEvidenceForFixture(fixtureId: string): EvidenceEvent[] {
  return EVIDENCE_EVENTS.filter((e) => e.fixtureId === fixtureId).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
}
