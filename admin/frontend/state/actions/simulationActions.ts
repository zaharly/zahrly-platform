import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso } from '../helpers'
import type { SimulationMode, SimulationOutcome, SimulationCheckpoint } from '../../types/domain'

function randomCheckpoints(cap: number): SimulationCheckpoint[] {
  const checkpoints: SimulationCheckpoint[] = []
  let hw = 5.5
  for (let samples = 5000; samples <= cap; samples += 1000) {
    hw = Math.max(0.3, hw - (0.15 + Math.random() * 0.3))
    checkpoints.push({ samples, halfWidth: Math.round(hw * 100) / 100 })
    if (checkpoints.length >= 8) break
  }
  return checkpoints
}

export function createSimulationActions(set: SetStore) {
  function finishRun(runId: string) {
    set((prev) => {
      const run = prev.simulationRuns.find((r) => r.id === runId)
      if (!run) return prev
      const converged = Math.random() < 0.8
      const outcome: SimulationOutcome = converged ? 'converged' : Math.random() < 0.5 ? 'capped' : 'lower-confidence'
      const checkpoints = randomCheckpoints(run.samplesCap)
      return {
        ...prev,
        simulationRuns: prev.simulationRuns.map((r) =>
          r.id === runId
            ? {
                ...r,
                runStatus: 'done',
                outcome,
                checkpoints,
                halfWidth: checkpoints[checkpoints.length - 1]?.halfWidth ?? r.halfWidth,
                samplesUsed: outcome === 'capped' ? r.samplesCap : Math.round(r.samplesCap * (0.6 + Math.random() * 0.35)),
              }
            : r
        ),
        auditEvents: [makeAuditEntry({ action: 'simulation_completed', entityType: 'Simulation', entityId: run.fixtureLabel, after: outcome }), ...prev.auditEvents],
      }
    })
  }

  function createSimulationJob(fixtureLabel: string, mode: SimulationMode) {
    const cap = mode === 'Final Lock' ? 20000 : mode === 'Material' ? 15000 : mode === 'Research' ? 25000 : 10000
    const run = {
      id: genId('SIM'),
      fixtureLabel,
      mode,
      samplesUsed: 0,
      samplesCap: cap,
      se: 0,
      halfWidth: 0,
      runtimeP50: 0,
      runtimeP95: 0,
      runtimeP99: 0,
      memoryMb: 0,
      dependencyProfile: 'goals-corners-cards-v3',
      outcome: 'lower-confidence' as SimulationOutcome,
      checkpoints: [],
      topRecommendationStable: false,
      sparseEventHits: 0,
      startedAt: nowIso(),
      runStatus: 'queued' as const,
    }
    set((prev) => ({
      ...prev,
      simulationRuns: [run, ...prev.simulationRuns],
      queues: prev.queues.map((q) => (q.name === 'EVALUATION_QUEUE' ? { ...q, depth: q.depth + 1 } : q)),
      auditEvents: [makeAuditEntry({ action: 'create_simulation_job', entityType: 'Simulation', entityId: fixtureLabel, after: mode }), ...prev.auditEvents],
    }))
    window.setTimeout(() => {
      set((prev) => ({ ...prev, simulationRuns: prev.simulationRuns.map((r) => (r.id === run.id ? { ...r, runStatus: 'running' } : r)) }))
    }, 900)
    window.setTimeout(() => finishRun(run.id), 2600)
  }

  function rerunSimulation(runId: string) {
    set((prev) => ({
      ...prev,
      simulationRuns: prev.simulationRuns.map((r) => (r.id === runId ? { ...r, runStatus: 'queued' } : r)),
    }))
    window.setTimeout(() => {
      set((prev) => ({ ...prev, simulationRuns: prev.simulationRuns.map((r) => (r.id === runId ? { ...r, runStatus: 'running' } : r)) }))
    }, 800)
    window.setTimeout(() => finishRun(runId), 2400)
  }

  return { createSimulationJob, rerunSimulation }
}
