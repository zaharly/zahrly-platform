import type { Alert } from '../../types/domain'

export const ALERTS: Alert[] = [
  { id: 'ALT-01', severity: 'critical', title: 'PropLine schema drift blocking odds ingestion', message: 'Endpoint /v2/odds/prematch quarantined. Odds/value data delayed for Tier 1 fixtures.', linkTo: '/providers?tab=schema-drift', owner: 'Priya Bennett', createdAt: '2026-08-22T17:40:00Z' },
  { id: 'ALT-02', severity: 'critical', title: 'API-Football injuries endpoint quarantined', message: 'Critical schema fingerprint change on /v3/injuries. Enrichment blocked platform-wide.', linkTo: '/providers?tab=schema-drift', owner: 'Priya Bennett', createdAt: '2026-08-23T00:05:00Z' },
  { id: 'ALT-03', severity: 'warning', title: 'REPAIR_QUEUE dead-letter backlog', message: '3 jobs dead-lettered; two repair workers unhealthy or draining.', linkTo: '/workers/queues?tab=dlq', owner: 'Kenji Petrov', createdAt: '2026-08-22T15:00:00Z' },
  { id: 'ALT-04', severity: 'warning', title: 'Ligue 1 enrichment completeness below gate', message: 'Enrichment completeness at 93.5%, below the 95% production threshold.', linkTo: '/data/quality', owner: 'Nadia Alves', createdAt: '2026-08-23T02:00:00Z' },
  { id: 'ALT-05', severity: 'warning', title: 'Fréchet bound violation — combination market', message: 'Consistency check CC-0006 failed on 1X2 & BTTS combination.', linkTo: '/predictions/consistency', owner: 'Omar Nakamura', createdAt: '2026-08-22T19:20:00Z' },
  { id: 'ALT-06', severity: 'warning', title: 'Supabase service role key expired', message: 'Rotation overdue by 8 days. Schedule rotation window.', linkTo: '/security?tab=secrets', owner: 'Talia Larsen', createdAt: '2026-08-15T00:00:00Z' },
  { id: 'ALT-07', severity: 'info', title: 'Shadow candidate v1.9.0-rc2 trending ahead of incumbent', message: 'Day 11 of 14 — CANDIDATE_BETTER across Log Loss and CLV.', linkTo: '/models/shadow', owner: 'Elena Fischer', createdAt: '2026-08-22T09:00:00Z' },
  { id: 'ALT-08', severity: 'info', title: 'Historical bootstrap tranche complete — Bundesliga 2023/24', message: 'Core + enrichment datasets reached 100% completeness.', linkTo: '/bootstrap', owner: 'Victor Haddad', createdAt: '2026-08-21T22:00:00Z' },
  { id: 'ALT-09', severity: 'warning', title: 'PropLine error rate above threshold', message: 'Error rate at 4.8%, 429 responses correlated with schema drift.', linkTo: '/providers?tab=propline', owner: 'Marcus Rossi', createdAt: '2026-08-22T21:00:00Z' },
  { id: 'ALT-10', severity: 'info', title: 'Netherlands re-verification window elapsed', message: 'Jurisdiction policy last verified 24 days ago.', linkTo: '/security?tab=jurisdiction', owner: 'Talia Larsen', createdAt: '2026-07-30T00:00:00Z' },
]
