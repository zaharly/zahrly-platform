import type { PredictionRecord, DataQualityState, ConsistencyState } from '../../types/domain'
import { FIXTURES, fixtureLabel } from './fixtures'
import { getEvidenceForFixture } from './evidence'
import { makeRng, range, round, uid } from '../factories/rng'

const rng = makeRng(48213)

function dataQualityFor(dataReadinessPct: number): DataQualityState {
  if (dataReadinessPct >= 95) return 'READY'
  if (dataReadinessPct >= 75) return 'PARTIAL'
  if (dataReadinessPct >= 40) return 'STALE'
  return 'MISSING'
}

function consistencyFor(): ConsistencyState {
  const roll = rng()
  if (roll < 0.88) return 'PASS'
  if (roll < 0.96) return 'WARNING'
  return 'FAILED'
}

export const PREDICTIONS: PredictionRecord[] = FIXTURES.map((f, idx) => {
  const evidence = getEvidenceForFixture(f.id)
  const change = round(f.currentProbability - f.baselineProbability)
  const recommendationState =
    f.marketState === 'ABSTAIN' ? 'ABSTAIN' : f.marketState === 'PREDICTED_ONLY' ? 'PREDICTED_ONLY' : 'RECOMMENDABLE'
  const priceAgeMin = f.marketState === 'ABSTAIN' ? null : Math.round(range(rng, 2, 240))
  const bestPrice = f.marketState === 'ABSTAIN' ? null : round(range(rng, 1.4, 5.2), 2)
  return {
    id: uid('PRED', idx + 1),
    fixtureId: f.id,
    fixtureLabel: fixtureLabel(f),
    leagueName: f.leagueName,
    kickoff: f.kickoff,
    episodeId: f.episodeId,
    baselinePick: f.baselinePick,
    baselineProbability: f.baselineProbability,
    currentProbability: f.currentProbability,
    change,
    modelVersion: f.modelVersion,
    evidenceCount: evidence.length,
    dataQuality: dataQualityFor(f.dataReadinessPct),
    marketState: f.marketState,
    recommendationState,
    predictionState: f.predictionState,
    lastUpdated: evidence.length > 0 ? evidence[evidence.length - 1]!.timestamp : f.kickoff,
    consistency: consistencyFor(),
    bestPrice,
    priceAgeMin,
  }
})

export function getPredictionForFixture(fixtureId: string): PredictionRecord | undefined {
  return PREDICTIONS.find((p) => p.fixtureId === fixtureId)
}
