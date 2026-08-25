import type { SchemaDriftEvent } from '../../types/domain'

export const SCHEMA_DRIFT_EVENTS: SchemaDriftEvent[] = [
  { id: 'DRIFT-0001', provider: 'PropLine', endpoint: '/v2/odds/prematch', oldFingerprint: 'fp_8a21c4', newFingerprint: 'fp_9b34e1', detectedAt: '2026-08-22T17:40:00Z', severity: 'critical', status: 'QUARANTINED', adapterVersion: 'adapter-propline-2.1.0', regressionSuite: 'failing', productionState: 'blocked' },
  { id: 'DRIFT-0002', provider: 'API-Football', endpoint: '/v3/fixtures/lineups', oldFingerprint: 'fp_1120af', newFingerprint: 'fp_1120bd', detectedAt: '2026-08-21T09:12:00Z', severity: 'warning', status: 'TESTING', adapterVersion: 'adapter-apifootball-3.4.0', regressionSuite: 'pending', productionState: 'blocked' },
  { id: 'DRIFT-0003', provider: 'API-Football', endpoint: '/v3/standings', oldFingerprint: 'fp_66cde2', newFingerprint: 'fp_66cde2', detectedAt: '2026-08-19T14:05:00Z', severity: 'info', status: 'APPROVED', adapterVersion: 'adapter-apifootball-3.4.1', regressionSuite: 'passing', productionState: 'resumed' },
  { id: 'DRIFT-0004', provider: 'OddsHub', endpoint: '/prices/live', oldFingerprint: 'fp_c02a19', newFingerprint: 'fp_c02b20', detectedAt: '2026-08-23T02:20:00Z', severity: 'warning', status: 'DETECTED', adapterVersion: 'adapter-oddshub-1.6.2', regressionSuite: 'pending', productionState: 'blocked' },
  { id: 'DRIFT-0005', provider: 'PropLine', endpoint: '/v2/props/player', oldFingerprint: 'fp_44ab90', newFingerprint: 'fp_44ac91', detectedAt: '2026-08-16T11:00:00Z', severity: 'info', status: 'RESUMED', adapterVersion: 'adapter-propline-2.0.9', regressionSuite: 'passing', productionState: 'resumed' },
  { id: 'DRIFT-0006', provider: 'API-Football', endpoint: '/v3/injuries', oldFingerprint: 'fp_77f210', newFingerprint: 'fp_78a311', detectedAt: '2026-08-23T00:05:00Z', severity: 'critical', status: 'QUARANTINED', adapterVersion: 'adapter-apifootball-3.4.0', regressionSuite: 'failing', productionState: 'blocked' },
]
