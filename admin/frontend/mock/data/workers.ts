import type { Worker, QueueName, WorkerStatus } from '../../types/domain'
import { makeRng, pick, rangeInt, round, uid, isoOffset } from '../factories/rng'

const rng = makeRng(660231)

const WORKER_CLASSES: Record<QueueName, string> = {
  CONTROL_QUEUE: 'control-worker',
  BACKFILL_QUEUE: 'backfill-worker',
  FIXTURE_QUEUE: 'fixture-discovery-worker',
  ODDS_QUEUE: 'odds-acquisition-worker',
  ENRICHMENT_QUEUE: 'enrichment-worker',
  PREDICTION_QUEUE: 'prediction-worker',
  REPAIR_QUEUE: 'repair-worker',
  EVALUATION_QUEUE: 'evaluation-worker',
  MODEL_TRAINING_QUEUE: 'model-training-worker',
}

const HOSTS = ['worker-fleet-a', 'worker-fleet-b', 'worker-fleet-c']

const PLAN: Array<{ queue: QueueName; count: number; statuses: WorkerStatus[] }> = [
  { queue: 'CONTROL_QUEUE', count: 2, statuses: ['HEALTHY', 'HEALTHY'] },
  { queue: 'BACKFILL_QUEUE', count: 3, statuses: ['HEALTHY', 'BUSY', 'HEALTHY'] },
  { queue: 'FIXTURE_QUEUE', count: 3, statuses: ['HEALTHY', 'HEALTHY', 'BUSY'] },
  { queue: 'ODDS_QUEUE', count: 4, statuses: ['BUSY', 'DEGRADED', 'HEALTHY', 'BUSY'] },
  { queue: 'ENRICHMENT_QUEUE', count: 4, statuses: ['HEALTHY', 'BUSY', 'DEGRADED', 'HEALTHY'] },
  { queue: 'PREDICTION_QUEUE', count: 5, statuses: ['HEALTHY', 'HEALTHY', 'BUSY', 'HEALTHY', 'BUSY'] },
  { queue: 'REPAIR_QUEUE', count: 2, statuses: ['UNHEALTHY', 'DRAINING'] },
  { queue: 'EVALUATION_QUEUE', count: 1, statuses: ['HEALTHY'] },
  { queue: 'MODEL_TRAINING_QUEUE', count: 1, statuses: ['OFFLINE'] },
]

export const WORKERS: Worker[] = PLAN.flatMap(({ queue, count, statuses }) =>
  Array.from({ length: count }, (_, i) => {
    const status = statuses[i] ?? 'HEALTHY'
    const n = rangeInt(rng, 100, 999)
    const isDown = status === 'OFFLINE' || status === 'UNHEALTHY'
    return {
      id: uid(`${queue.split('_')[0]}-W`, n),
      class: WORKER_CLASSES[queue],
      host: pick(rng, HOSTS),
      version: `build-${rangeInt(rng, 410, 468)}`,
      status,
      cpuPct: isDown ? 0 : round(rangeInt(rng, 12, 92)),
      ramPct: isDown ? 0 : round(rangeInt(rng, 20, 88)),
      jobsProcessed: rangeInt(rng, 800, 42000),
      successRatePct: status === 'DEGRADED' ? round(rangeInt(rng, 70, 88)) : status === 'UNHEALTHY' ? round(rangeInt(rng, 20, 55)) : round(rangeInt(rng, 96, 100)),
      errorRatePct: status === 'DEGRADED' ? round(rangeInt(rng, 8, 22), 1) : status === 'UNHEALTHY' ? round(rangeInt(rng, 30, 60), 1) : round(rangeInt(rng, 0, 3), 1),
      lastHeartbeat: isDown ? isoOffset(-rangeInt(rng, 20, 90)) : isoOffset(-rangeInt(rng, 0, 2)),
      currentJob: status === 'BUSY' ? uid('JOB', rangeInt(rng, 1, 400)) : null,
      queue,
      throughputPerMin: isDown ? 0 : round(rangeInt(rng, 2, 40)),
      p95RuntimeMs: rangeInt(rng, 180, 4200),
    }
  })
)
