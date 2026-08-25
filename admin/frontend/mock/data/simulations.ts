import type { SimulationRun, SimulationMode, SimulationOutcome } from '../../types/domain'
import { FIXTURES, fixtureLabel } from './fixtures'
import { makeRng, pick, range, rangeInt, round, uid, isoOffset } from '../factories/rng'

const rng = makeRng(77234)
const MODES: SimulationMode[] = ['Routine', 'Material', 'Final Lock', 'Research']

function buildCheckpoints(cap: number) {
  const checkpoints = []
  let hw = range(rng, 4.2, 6.5)
  for (let samples = 5000; samples <= cap; samples += 1000) {
    hw = Math.max(0.35, hw - range(rng, 0.15, 0.45))
    checkpoints.push({ samples, halfWidth: round(hw, 2) })
    if (checkpoints.length >= 8) break
  }
  return checkpoints
}

export const SIMULATION_RUNS: SimulationRun[] = FIXTURES.slice(0, 18).map((f, idx) => {
  const mode = pick(rng, MODES)
  const cap = mode === 'Final Lock' ? 20000 : mode === 'Material' ? 15000 : mode === 'Research' ? 25000 : 10000
  const converged = rng() < 0.82
  const outcome: SimulationOutcome = converged ? 'converged' : rng() < 0.5 ? 'capped' : 'lower-confidence'
  const checkpoints = buildCheckpoints(cap)
  const lastHalfWidth = checkpoints[checkpoints.length - 1]?.halfWidth ?? 1.0
  return {
    id: uid('SIM', idx + 1),
    fixtureLabel: fixtureLabel(f),
    mode,
    samplesUsed: outcome === 'capped' ? cap : Math.round(cap * range(rng, 0.55, 0.95)),
    samplesCap: cap,
    se: round(lastHalfWidth / 1.96, 3),
    halfWidth: lastHalfWidth,
    runtimeP50: rangeInt(rng, 180, 420),
    runtimeP95: rangeInt(rng, 420, 980),
    runtimeP99: rangeInt(rng, 980, 1600),
    memoryMb: rangeInt(rng, 340, 980),
    dependencyProfile: rng() < 0.6 ? 'goals-corners-cards-v3' : 'goals-only-v2',
    outcome,
    checkpoints,
    topRecommendationStable: rng() < 0.9,
    sparseEventHits: rangeInt(rng, 0, 6),
    startedAt: isoOffset(-rangeInt(rng, 5, 600)),
    runStatus: 'done',
  }
})
