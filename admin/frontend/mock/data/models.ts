import type { ModelVersion } from '../../types/domain'

export const MODEL_VERSIONS: ModelVersion[] = [
  {
    id: 'model-v1-8-3', family: 'zahrly-poisson-dixon-coles', version: 'v1.8.3', status: 'ACTIVE',
    trainingCutoff: '2026-08-01', features: 214,
    metrics: { logLoss: 0.982, brier: 0.201, rps: 0.187, ece: 0.021, clv: 1.4 },
    calibration: 'strong', drift: 'healthy', shadowState: null,
    createdAt: '2026-07-28T10:00:00Z', promotedAt: '2026-08-04T09:00:00Z',
  },
  {
    id: 'model-v1-8-2', family: 'zahrly-poisson-dixon-coles', version: 'v1.8.2', status: 'RETIRED',
    trainingCutoff: '2026-06-15', features: 208,
    metrics: { logLoss: 1.011, brier: 0.209, rps: 0.194, ece: 0.026, clv: 0.9 },
    calibration: 'strong', drift: 'healthy', shadowState: null,
    createdAt: '2026-06-10T10:00:00Z', promotedAt: '2026-06-20T09:00:00Z',
  },
  {
    id: 'model-v1-9-0-rc2', family: 'zahrly-poisson-dixon-coles', version: 'v1.9.0-rc2', status: 'SHADOW',
    trainingCutoff: '2026-08-18', features: 231,
    metrics: { logLoss: 0.958, brier: 0.194, rps: 0.181, ece: 0.017, clv: 1.9 },
    calibration: 'strong', drift: 'healthy', shadowState: 'Day 11 of 14 — CANDIDATE_BETTER trending',
    createdAt: '2026-08-18T08:00:00Z', promotedAt: null,
  },
  {
    id: 'model-v2-0-alpha', family: 'zahrly-hierarchical-bayes', version: 'v2.0.0-alpha', status: 'CANDIDATE',
    trainingCutoff: '2026-08-20', features: 267,
    metrics: { logLoss: 1.043, brier: 0.221, rps: 0.203, ece: 0.038, clv: 0.4 },
    calibration: 'moderate', drift: 'warning', shadowState: null,
    createdAt: '2026-08-21T14:00:00Z', promotedAt: null,
  },
  {
    id: 'model-v1-7-9', family: 'zahrly-poisson-dixon-coles', version: 'v1.7.9', status: 'REJECTED',
    trainingCutoff: '2026-05-01', features: 196,
    metrics: { logLoss: 1.088, brier: 0.233, rps: 0.216, ece: 0.049, clv: -0.6 },
    calibration: 'weak', drift: 'critical', shadowState: null,
    createdAt: '2026-05-05T10:00:00Z', promotedAt: null,
  },
  {
    id: 'model-v1-8-0', family: 'zahrly-poisson-dixon-coles', version: 'v1.8.0', status: 'ROLLBACK',
    trainingCutoff: '2026-06-25', features: 210,
    metrics: { logLoss: 1.102, brier: 0.238, rps: 0.219, ece: 0.052, clv: -1.1 },
    calibration: 'weak', drift: 'critical', shadowState: null,
    createdAt: '2026-06-25T10:00:00Z', promotedAt: '2026-07-02T09:00:00Z',
  },
  {
    id: 'model-v2-0-research', family: 'zahrly-hierarchical-bayes', version: 'v2.0.0-research-3', status: 'CANDIDATE',
    trainingCutoff: '2026-08-22', features: 274,
    metrics: { logLoss: 1.021, brier: 0.212, rps: 0.196, ece: 0.031, clv: 0.7 },
    calibration: 'moderate', drift: 'warning', shadowState: null,
    createdAt: '2026-08-22T20:00:00Z', promotedAt: null,
  },
]

export const ACTIVE_MODEL = MODEL_VERSIONS.find((m) => m.status === 'ACTIVE')!
