import type { Job, QueueName, JobStatus } from '../../types/domain'
import { WORKERS } from './workers'
import { makeRng, pick, rangeInt, uid, isoOffset } from '../factories/rng'

const rng = makeRng(551007)

const QUEUES_LIST: QueueName[] = [
  'CONTROL_QUEUE', 'BACKFILL_QUEUE', 'FIXTURE_QUEUE', 'ODDS_QUEUE', 'ENRICHMENT_QUEUE',
  'PREDICTION_QUEUE', 'REPAIR_QUEUE', 'EVALUATION_QUEUE', 'MODEL_TRAINING_QUEUE',
]

const PAYLOADS: Record<QueueName, string[]> = {
  CONTROL_QUEUE: ['league eligibility check', 'season scope update', 'processing control sync'],
  BACKFILL_QUEUE: ['tranche: 2022/23 core dataset', 'tranche: 2021/22 enrichment', 'tranche: 2024/25 specialized'],
  FIXTURE_QUEUE: ['discover fixtures — matchday 4', 'reconcile fixture IDs', 'discover fixtures — matchday 5'],
  ODDS_QUEUE: ['fetch best price snapshot', 'fetch closing line', 'fetch opening price'],
  ENRICHMENT_QUEUE: ['lineup enrichment', 'injury report enrichment', 'H2H recompute', 'standings refresh'],
  PREDICTION_QUEUE: ['baseline generation', 'evidence recompute', 'episode re-baseline'],
  REPAIR_QUEUE: ['data correction replay', 'conflict resolution replay', 'consistency repair job'],
  EVALUATION_QUEUE: ['walk-forward fold scoring', 'CLV benchmark scoring'],
  MODEL_TRAINING_QUEUE: ['candidate training run v1.9.0-rc2'],
}

const ERRORS = [
  'Upstream 429 rate limit exceeded', 'Schema validation failed on field `lineup.status`',
  'Timeout waiting for enrichment dependency', 'Consistency gate failed — Fréchet bound violated',
  'Worker lease expired before checkpoint', 'Unexpected null in provider payload',
]

function buildJobsForQueue(queue: QueueName, count: number, dlqCount: number): Job[] {
  const jobs: Job[] = []
  const queueWorkers = WORKERS.filter((w) => w.queue === queue)
  for (let i = 0; i < count; i++) {
    const isDlq = i < dlqCount
    const status: JobStatus = isDlq ? 'DEAD_LETTER' : pick(rng, ['PENDING', 'RUNNING', 'RETRYING', 'COMPLETED', 'COMPLETED', 'COMPLETED'])
    const worker = queueWorkers.length > 0 ? pick(rng, queueWorkers).id : null
    const firstFailure = isDlq ? isoOffset(-rangeInt(rng, 600, 5000)) : null
    jobs.push({
      id: uid(`JOB-${queue.split('_')[0]}`, i + 1),
      queue,
      status,
      attempts: isDlq ? rangeInt(rng, 3, 8) : status === 'RETRYING' ? rangeInt(rng, 1, 3) : 1,
      worker: status === 'RUNNING' || status === 'RETRYING' ? worker : isDlq ? worker : null,
      leaseExpiresAt: status === 'RUNNING' ? isoOffset(rangeInt(rng, 1, 15)) : null,
      checkpoint: isDlq ? 'checkpoint:fetch-complete' : status === 'RUNNING' ? 'checkpoint:in-progress' : 'checkpoint:none',
      error: isDlq || status === 'RETRYING' ? pick(rng, ERRORS) : null,
      retryAt: status === 'RETRYING' ? isoOffset(rangeInt(rng, 1, 30)) : null,
      priority: pick(rng, ['low', 'normal', 'normal', 'high']),
      payloadSummary: pick(rng, PAYLOADS[queue]),
      firstFailure,
      lastFailure: isDlq ? isoOffset(-rangeInt(rng, 5, 400)) : null,
    })
  }
  return jobs
}

export const JOBS: Job[] = [
  ...buildJobsForQueue('CONTROL_QUEUE', 6, 0),
  ...buildJobsForQueue('BACKFILL_QUEUE', 14, 1),
  ...buildJobsForQueue('FIXTURE_QUEUE', 10, 0),
  ...buildJobsForQueue('ODDS_QUEUE', 16, 2),
  ...buildJobsForQueue('ENRICHMENT_QUEUE', 14, 1),
  ...buildJobsForQueue('PREDICTION_QUEUE', 12, 0),
  ...buildJobsForQueue('REPAIR_QUEUE', 9, 3),
  ...buildJobsForQueue('EVALUATION_QUEUE', 5, 0),
  ...buildJobsForQueue('MODEL_TRAINING_QUEUE', 2, 0),
]

export const DEAD_LETTER_JOBS: Job[] = JOBS.filter((j) => j.status === 'DEAD_LETTER')

export { QUEUES_LIST }
