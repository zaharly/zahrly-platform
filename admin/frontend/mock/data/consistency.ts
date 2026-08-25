import type { ConsistencyCheck } from '../../types/domain'
import { FIXTURES, fixtureLabel } from './fixtures'

const f = FIXTURES

export const CONSISTENCY_CHECKS: ConsistencyCheck[] = [
  { id: 'CC-0001', rule: 'P(1) + P(X) + P(2) = 1', category: 'Partition', state: 'PASS', market: '1X2', fixtureLabel: fixtureLabel(f[0]!), observed: '1.000', expected: '1.000', incidentId: null },
  { id: 'CC-0002', rule: 'GG + NG = 1', category: 'Complement', state: 'PASS', market: 'BTTS (GG/NG)', fixtureLabel: fixtureLabel(f[1]!), observed: '1.000', expected: '1.000', incidentId: null },
  { id: 'CC-0003', rule: '1X = P(1) + P(X)', category: 'Double Chance', state: 'PASS', market: 'Double Chance', fixtureLabel: fixtureLabel(f[2]!), observed: '0.612', expected: '0.612', incidentId: null },
  { id: 'CC-0004', rule: 'Over 2.5 >= Over 3.5', category: 'Monotonic totals', state: 'WARNING', market: 'Over/Under 2.5 / 3.5', fixtureLabel: fixtureLabel(f[3]!), observed: '0.481 vs 0.478', expected: 'Over 2.5 >= Over 3.5', incidentId: 'INC-0021' },
  { id: 'CC-0005', rule: 'Over 1.5 >= Over 2.5 >= Over 3.5 >= Over 5.5', category: 'Monotonic totals', state: 'PASS', market: 'Over/Under ladder', fixtureLabel: fixtureLabel(f[4]!), observed: 'monotonic', expected: 'monotonic', incidentId: null },
  { id: 'CC-0006', rule: 'Joint outcome bounded by Fréchet limits', category: 'Fréchet bounds', state: 'FAILED', market: '1X2 & BTTS', fixtureLabel: fixtureLabel(f[5]!), observed: '0.402', expected: '<= 0.379', incidentId: 'INC-0022' },
  { id: 'CC-0007', rule: 'Combination probability <= min(leg probabilities)', category: 'Combination bounds', state: 'PASS', market: 'Double Chance & BTTS', fixtureLabel: fixtureLabel(f[6]!), observed: '0.331', expected: '<= 0.402', incidentId: null },
  { id: 'CC-0008', rule: 'Simulated joint frequencies match analytic marginals', category: 'Joint simulation consistency', state: 'PASS', market: 'Over 2.5 Goals & Over 9.5 Corners', fixtureLabel: fixtureLabel(f[7]!), observed: 'Δ 0.004', expected: 'Δ <= 0.01', incidentId: null },
  { id: 'CC-0009', rule: 'P(1) + P(X) + P(2) = 1', category: 'Partition', state: 'WARNING', market: '1X2', fixtureLabel: fixtureLabel(f[8]!), observed: '1.006', expected: '1.000', incidentId: 'INC-0023' },
  { id: 'CC-0010', rule: 'Draw No Bet renormalized over {1,2}', category: 'Complement', state: 'PASS', market: 'Draw No Bet', fixtureLabel: fixtureLabel(f[9]!), observed: '1.000', expected: '1.000', incidentId: null },
  { id: 'CC-0011', rule: 'Asian Handicap quarter-line split sums correctly', category: 'Settlement semantics', state: 'PASS', market: 'Asian Handicap', fixtureLabel: fixtureLabel(f[10]!), observed: '1.000', expected: '1.000', incidentId: null },
  { id: 'CC-0012', rule: 'Team totals sum bounded by match total', category: 'Combination bounds', state: 'PASS', market: 'Team Total Goals', fixtureLabel: fixtureLabel(f[11]!), observed: '2.41 <= 2.60', expected: '<= match total', incidentId: null },
]
