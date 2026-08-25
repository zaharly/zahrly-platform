import type { DriftMetric } from '../../types/domain'

export const DRIFT_METRICS: DriftMetric[] = [
  { id: 'DRIFT-M-01', category: 'Model', metric: 'Log Loss (7d rolling)', baseline: 0.982, current: 0.991, threshold: 1.02, durationHours: 36, severity: 'WATCH', trigger: 'Rolling log loss trending above baseline' },
  { id: 'DRIFT-M-02', category: 'Calibration', metric: 'ECE — Over/Under 2.5', baseline: 0.016, current: 0.024, threshold: 0.03, durationHours: 18, severity: 'WATCH', trigger: 'Calibration curve widening in mid-season segment' },
  { id: 'DRIFT-M-03', category: 'Data', metric: 'Fixture completeness (Ligue 1)', baseline: 98.4, current: 93.5, threshold: 95.0, durationHours: 12, severity: 'WARNING', trigger: 'PropLine coverage gap in Ligue 1' },
  { id: 'DRIFT-M-04', category: 'Feature', metric: 'lineup_confidence distribution shift', baseline: 0.71, current: 0.58, threshold: 0.6, durationHours: 6, severity: 'WARNING', trigger: 'Late lineup confirmations increasing' },
  { id: 'DRIFT-M-05', category: 'Provider', metric: 'PropLine error rate', baseline: 0.8, current: 4.8, threshold: 3.0, durationHours: 9, severity: 'CRITICAL', trigger: 'Elevated 429 responses correlated with schema drift' },
  { id: 'DRIFT-M-06', category: 'Market', metric: 'Combination market Fréchet violations', baseline: 0.1, current: 0.6, threshold: 0.5, durationHours: 4, severity: 'WARNING', trigger: 'Increase in combination bound failures' },
  { id: 'DRIFT-M-07', category: 'Model', metric: 'CLV (14d rolling)', baseline: 1.4, current: 1.3, threshold: 0.5, durationHours: 72, severity: 'NORMAL', trigger: 'Within expected band' },
  { id: 'DRIFT-M-08', category: 'Data', metric: 'Injury report freshness', baseline: 22, current: 41, threshold: 45, durationHours: 3, severity: 'WATCH', trigger: 'Enrichment queue backlog increasing latency' },
  { id: 'DRIFT-M-09', category: 'Feature', metric: 'market_signal coverage', baseline: 96.2, current: 94.8, threshold: 90.0, durationHours: 24, severity: 'NORMAL', trigger: 'Within expected band' },
  { id: 'DRIFT-M-10', category: 'Calibration', metric: 'ECE — 1X2', baseline: 0.018, current: 0.021, threshold: 0.03, durationHours: 48, severity: 'NORMAL', trigger: 'Within expected band' },
]
