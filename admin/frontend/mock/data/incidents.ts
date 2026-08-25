import type { Incident } from '../../types/domain'

export const INCIDENTS: Incident[] = [
  {
    id: 'INC-0014', severity: 'P1', category: 'Provider', title: 'PropLine schema drift blocking odds ingestion',
    status: 'INVESTIGATING', owner: 'Priya Bennett', affectedEntities: ['PropLine', 'ODDS_QUEUE', '/v2/odds/prematch'],
    impact: 'Odds/value data delayed for ~40% of Tier 1 fixtures; predictions remain available.',
    timeline: [
      { ts: '2026-08-22T17:40:00Z', note: 'Schema drift detected on /v2/odds/prematch fingerprint change' },
      { ts: '2026-08-22T17:55:00Z', note: 'Endpoint auto-quarantined; adapter regression suite triggered' },
      { ts: '2026-08-23T02:10:00Z', note: 'Regression suite failing — investigating field mapping change' },
    ],
    resolution: null, createdAt: '2026-08-22T17:40:00Z', updatedAt: '2026-08-23T02:10:00Z',
  },
  {
    id: 'INC-0015', severity: 'P2', category: 'Queue', title: 'Elevated retry rate on ODDS_QUEUE',
    status: 'MITIGATED', owner: 'Marcus Rossi', affectedEntities: ['ODDS_QUEUE'],
    impact: 'Odds refresh latency increased for affected fixtures; no prediction impact.',
    timeline: [
      { ts: '2026-08-22T20:00:00Z', note: 'Retry rate crossed 8% threshold' },
      { ts: '2026-08-22T21:30:00Z', note: 'Root cause traced to PropLine 429 responses' },
      { ts: '2026-08-23T01:00:00Z', note: 'Backoff policy tuned; retry rate declining' },
    ],
    resolution: null, createdAt: '2026-08-22T20:00:00Z', updatedAt: '2026-08-23T01:00:00Z',
  },
  {
    id: 'INC-0016', severity: 'P0', category: 'Model', title: 'Model v1.8.0 rollback — calibration regression',
    status: 'RESOLVED', owner: 'Elena Fischer', affectedEntities: ['model-v1-8-0', 'model-v1-8-2'],
    impact: 'Production predictions reverted to v1.8.2 for 6 hours while regression was confirmed.',
    timeline: [
      { ts: '2026-07-03T02:00:00Z', note: 'ECE breach detected 4h after promotion' },
      { ts: '2026-07-03T02:40:00Z', note: 'Second-approval rollback authorized' },
      { ts: '2026-07-03T03:10:00Z', note: 'Rollback executed; cache invalidated' },
      { ts: '2026-07-03T09:00:00Z', note: 'Postmortem completed; gate thresholds tightened' },
    ],
    resolution: 'Rolled back to v1.8.2; added ECE gate to promotion checklist.', createdAt: '2026-07-03T02:00:00Z', updatedAt: '2026-07-03T09:00:00Z',
  },
  {
    id: 'INC-0017', severity: 'P2', category: 'Data', title: 'Ligue 1 enrichment completeness below threshold',
    status: 'OPEN', owner: 'Nadia Alves', affectedEntities: ['ligue-1', 'ENRICHMENT_QUEUE'],
    impact: 'Enrichment completeness at 93.5%, below the 95% production gate.',
    timeline: [{ ts: '2026-08-23T02:00:00Z', note: 'Completeness threshold breach detected by data quality scan' }],
    resolution: null, createdAt: '2026-08-23T02:00:00Z', updatedAt: '2026-08-23T02:00:00Z',
  },
  {
    id: 'INC-0018', severity: 'P3', category: 'Archive', title: 'Archive repair required — 2020/21 lineup dataset',
    status: 'OPEN', owner: 'Victor Haddad', affectedEntities: ['archive:2020/21:lineup archive'],
    impact: 'Historical training dataset build blocked for 2020/21 lineup features.',
    timeline: [{ ts: '2026-08-19T08:00:00Z', note: 'Checksum mismatch detected during integrity scan' }],
    resolution: null, createdAt: '2026-08-19T08:00:00Z', updatedAt: '2026-08-19T08:00:00Z',
  },
  {
    id: 'INC-0019', severity: 'P1', category: 'Queue', title: 'REPAIR_QUEUE dead-letter backlog growing',
    status: 'INVESTIGATING', owner: 'Kenji Petrov', affectedEntities: ['REPAIR_QUEUE'],
    impact: '3 jobs in dead-letter state; downstream consistency repairs delayed.',
    timeline: [
      { ts: '2026-08-22T14:00:00Z', note: 'DLQ depth crossed alert threshold (3 jobs)' },
      { ts: '2026-08-22T15:00:00Z', note: 'Two workers marked UNHEALTHY / DRAINING' },
    ],
    resolution: null, createdAt: '2026-08-22T14:00:00Z', updatedAt: '2026-08-22T15:00:00Z',
  },
  {
    id: 'INC-0020', severity: 'P2', category: 'Security', title: 'Supabase service role key expired',
    status: 'OPEN', owner: 'Talia Larsen', affectedEntities: ['SEC-03'],
    impact: 'Rotation overdue by 8 days; scheduled maintenance window requested.',
    timeline: [{ ts: '2026-08-15T00:00:00Z', note: 'Key crossed expiration date without rotation' }],
    resolution: null, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-23T00:00:00Z',
  },
  {
    id: 'INC-0021', severity: 'P2', category: 'Prediction', title: 'Monotonic totals warning — Over 2.5 / Over 3.5',
    status: 'INVESTIGATING', owner: 'Omar Nakamura', affectedEntities: ['CC-0004'],
    impact: 'Consistency warning on one fixture; recommendation suppressed pending repair.',
    timeline: [{ ts: '2026-08-22T11:00:00Z', note: 'Consistency scan flagged near-boundary violation' }],
    resolution: null, createdAt: '2026-08-22T11:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
  },
  {
    id: 'INC-0022', severity: 'P1', category: 'Prediction', title: 'Fréchet bound violation on combination market',
    status: 'OPEN', owner: 'Omar Nakamura', affectedEntities: ['CC-0006', 'mkt-combo-1x2-btts'],
    impact: 'Combination market recommendation withheld for affected fixture pending repair job.',
    timeline: [{ ts: '2026-08-22T19:20:00Z', note: 'Consistency scan failed Fréchet bound check' }],
    resolution: null, createdAt: '2026-08-22T19:20:00Z', updatedAt: '2026-08-22T19:20:00Z',
  },
  {
    id: 'INC-0023', severity: 'P3', category: 'Prediction', title: 'Partition sum drift — 1X2',
    status: 'MITIGATED', owner: 'Omar Nakamura', affectedEntities: ['CC-0009'],
    impact: 'Minor over-normalization (1.006); repair job queued, no user-facing impact.',
    timeline: [
      { ts: '2026-08-21T09:00:00Z', note: 'Partition sum drift detected' },
      { ts: '2026-08-21T10:00:00Z', note: 'Repair job queued to REPAIR_QUEUE' },
    ],
    resolution: null, createdAt: '2026-08-21T09:00:00Z', updatedAt: '2026-08-21T10:00:00Z',
  },
  {
    id: 'INC-0024', severity: 'P0', category: 'Provider', title: 'API-Football injuries endpoint schema drift',
    status: 'OPEN', owner: 'Priya Bennett', affectedEntities: ['API-Football', '/v3/injuries', 'ENRICHMENT_QUEUE'],
    impact: 'Injury enrichment blocked platform-wide pending adapter validation.',
    timeline: [{ ts: '2026-08-23T00:05:00Z', note: 'Critical schema fingerprint change detected, endpoint quarantined' }],
    resolution: null, createdAt: '2026-08-23T00:05:00Z', updatedAt: '2026-08-23T00:05:00Z',
  },
  {
    id: 'INC-0025', severity: 'P3', category: 'Performance', title: 'Simulation p99 runtime creeping upward',
    status: 'CLOSED', owner: 'Freya Silva', affectedEntities: ['EVALUATION_QUEUE'],
    impact: 'No SLA breach; monitored and resolved after worker resize.',
    timeline: [
      { ts: '2026-08-10T10:00:00Z', note: 'p99 runtime crossed watch threshold' },
      { ts: '2026-08-11T09:00:00Z', note: 'Worker memory allocation increased' },
      { ts: '2026-08-12T09:00:00Z', note: 'Runtime normalized; incident closed' },
    ],
    resolution: 'Increased worker RSS allocation for simulation pool.', createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-12T09:00:00Z',
  },
  {
    id: 'INC-0026', severity: 'P2', category: 'Compliance', title: 'Netherlands jurisdiction policy re-verification overdue',
    status: 'OPEN', owner: 'Talia Larsen', affectedEntities: ['Netherlands'],
    impact: 'Policy last verified 24 days ago; league remains paused pending review.',
    timeline: [{ ts: '2026-07-30T00:00:00Z', note: 'Policy verification window elapsed' }],
    resolution: null, createdAt: '2026-07-30T00:00:00Z', updatedAt: '2026-07-30T00:00:00Z',
  },
  {
    id: 'INC-0027', severity: 'P1', category: 'Database', title: 'Elevated query latency on prediction_read_models',
    status: 'RESOLVED', owner: 'Kenji Petrov', affectedEntities: ['prediction_read_models'],
    impact: 'Read-model queries slowed for 22 minutes; no data loss.',
    timeline: [
      { ts: '2026-08-09T06:00:00Z', note: 'Latency alert triggered at p95 > 800ms' },
      { ts: '2026-08-09T06:22:00Z', note: 'Index rebuilt; latency restored' },
    ],
    resolution: 'Rebuilt fragmented index on prediction_read_models.', createdAt: '2026-08-09T06:00:00Z', updatedAt: '2026-08-09T06:22:00Z',
  },
]
