import type { ShadowEvaluation } from '../../types/domain'
import { round } from '../factories/rng'

function buildTimeline(startLL: number, endLL: number, startClv: number, endClv: number) {
  return [1, 3, 5, 7, 9, 11, 14].map((day, i, arr) => {
    const t = i / (arr.length - 1)
    return {
      day,
      candidateLogLoss: round(startLL + (endLL - startLL) * t, 3),
      incumbentLogLoss: round(0.982 + (0.978 - 0.982) * t, 3),
      candidateClv: round(startClv + (endClv - startClv) * t, 2),
      incumbentClv: round(1.4 + 0.05 * t, 2),
    }
  })
}

export const SHADOW_EVALUATIONS: ShadowEvaluation[] = [
  {
    id: 'SHADOW-0001', candidateId: 'model-v1-9-0-rc2', candidateVersion: 'v1.9.0-rc2',
    incumbentId: 'model-v1-8-3', incumbentVersion: 'v1.8.3',
    shadowDurationDays: 14, fixturesEvaluated: 1842,
    logLoss: 0.958, brier: 0.194, rps: 0.181, ece: 0.017, clv: 1.9, abstentionRatePct: 3.1,
    runtimeMs: 312, verdict: 'CANDIDATE_BETTER',
    timeline: buildTimeline(1.01, 0.958, 1.1, 1.9),
  },
  {
    id: 'SHADOW-0002', candidateId: 'model-v2-0-alpha', candidateVersion: 'v2.0.0-alpha',
    incumbentId: 'model-v1-8-3', incumbentVersion: 'v1.8.3',
    shadowDurationDays: 6, fixturesEvaluated: 704,
    logLoss: 1.043, brier: 0.221, rps: 0.203, ece: 0.038, clv: 0.4, abstentionRatePct: 8.7,
    runtimeMs: 480, verdict: 'REGRESSION',
    timeline: buildTimeline(1.05, 1.043, 0.6, 0.4).slice(0, 3),
  },
  {
    id: 'SHADOW-0003', candidateId: 'model-v2-0-research', candidateVersion: 'v2.0.0-research-3',
    incumbentId: 'model-v1-8-3', incumbentVersion: 'v1.8.3',
    shadowDurationDays: 2, fixturesEvaluated: 168,
    logLoss: 1.021, brier: 0.212, rps: 0.196, ece: 0.031, clv: 0.7, abstentionRatePct: 5.2,
    runtimeMs: 455, verdict: 'NOT_ENOUGH_DATA',
    timeline: buildTimeline(1.02, 1.021, 0.65, 0.7).slice(0, 2),
  },
]
