import type { Provider } from '../../types/domain'

export const PROVIDERS: Provider[] = [
  {
    id: 'api-football', name: 'API-Football', status: 'healthy', plan: 'Ultra (7,500 req/day)',
    quotaTotal: 7500, quotaUsed: 5120, requestsPerSec: 4.2, errorRatePct: 0.6, rateLimit429: 3,
    latencyMs: 214, coveragePct: 98.9, schemaVersion: 'v3.4.1', lastSchemaCheck: '2026-08-23T04:00:00Z',
    quotaHistory: [61, 64, 68, 70, 73, 75, 74, 77, 79, 81, 83, 85, 86, 88],
  },
  {
    id: 'propline', name: 'PropLine', status: 'degraded', plan: 'Growth (odds + props)',
    quotaTotal: 4000, quotaUsed: 3610, requestsPerSec: 2.1, errorRatePct: 4.8, rateLimit429: 41,
    latencyMs: 890, coveragePct: 81.2, schemaVersion: 'v2.1.0', lastSchemaCheck: '2026-08-22T18:30:00Z',
    quotaHistory: [55, 60, 66, 71, 78, 82, 85, 87, 88, 89, 90, 90, 90, 90],
  },
  {
    id: 'oddshub', name: 'OddsHub (secondary prices)', status: 'healthy', plan: 'Standard',
    quotaTotal: 2500, quotaUsed: 980, requestsPerSec: 1.1, errorRatePct: 0.2, rateLimit429: 0,
    latencyMs: 165, coveragePct: 74.0, schemaVersion: 'v1.6.2', lastSchemaCheck: '2026-08-23T01:15:00Z',
    quotaHistory: [22, 24, 27, 29, 31, 33, 34, 35, 37, 38, 38, 39, 39, 40],
  },
]

export function getProviderById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}
