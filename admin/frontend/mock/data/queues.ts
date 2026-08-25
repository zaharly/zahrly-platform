import type { QueueStat, QueueName } from '../../types/domain'

export const QUEUE_LABELS: Record<QueueName, string> = {
  CONTROL_QUEUE: 'Control',
  BACKFILL_QUEUE: 'Backfill',
  FIXTURE_QUEUE: 'Fixture discovery',
  ODDS_QUEUE: 'Odds acquisition',
  ENRICHMENT_QUEUE: 'Enrichment',
  PREDICTION_QUEUE: 'Prediction',
  REPAIR_QUEUE: 'Repair / replay',
  EVALUATION_QUEUE: 'Evaluation',
  MODEL_TRAINING_QUEUE: 'Model training',
}

export const QUEUES: QueueStat[] = [
  { name: 'CONTROL_QUEUE', label: QUEUE_LABELS.CONTROL_QUEUE, depth: 6, oldestJobAgeMin: 4, p50AgeMin: 1, p95AgeMin: 5, throughputPerMin: 22, failures: 0, retrying: 0, deadLetter: 0, workers: 2, slaStatus: 'healthy' },
  { name: 'BACKFILL_QUEUE', label: QUEUE_LABELS.BACKFILL_QUEUE, depth: 184, oldestJobAgeMin: 620, p50AgeMin: 210, p95AgeMin: 590, throughputPerMin: 8, failures: 3, retrying: 2, deadLetter: 1, workers: 3, slaStatus: 'healthy' },
  { name: 'FIXTURE_QUEUE', label: QUEUE_LABELS.FIXTURE_QUEUE, depth: 12, oldestJobAgeMin: 9, p50AgeMin: 2, p95AgeMin: 11, throughputPerMin: 35, failures: 0, retrying: 0, deadLetter: 0, workers: 3, slaStatus: 'healthy' },
  { name: 'ODDS_QUEUE', label: QUEUE_LABELS.ODDS_QUEUE, depth: 47, oldestJobAgeMin: 38, p50AgeMin: 6, p95AgeMin: 41, throughputPerMin: 18, failures: 9, retrying: 6, deadLetter: 2, workers: 4, slaStatus: 'warning' },
  { name: 'ENRICHMENT_QUEUE', label: QUEUE_LABELS.ENRICHMENT_QUEUE, depth: 63, oldestJobAgeMin: 52, p50AgeMin: 11, p95AgeMin: 55, throughputPerMin: 24, failures: 5, retrying: 3, deadLetter: 1, workers: 4, slaStatus: 'warning' },
  { name: 'PREDICTION_QUEUE', label: QUEUE_LABELS.PREDICTION_QUEUE, depth: 21, oldestJobAgeMin: 14, p50AgeMin: 3, p95AgeMin: 16, throughputPerMin: 30, failures: 2, retrying: 1, deadLetter: 0, workers: 5, slaStatus: 'healthy' },
  { name: 'REPAIR_QUEUE', label: QUEUE_LABELS.REPAIR_QUEUE, depth: 9, oldestJobAgeMin: 120, p50AgeMin: 45, p95AgeMin: 130, throughputPerMin: 4, failures: 1, retrying: 1, deadLetter: 3, workers: 2, slaStatus: 'critical' },
  { name: 'EVALUATION_QUEUE', label: QUEUE_LABELS.EVALUATION_QUEUE, depth: 5, oldestJobAgeMin: 30, p50AgeMin: 10, p95AgeMin: 33, throughputPerMin: 3, failures: 0, retrying: 0, deadLetter: 0, workers: 1, slaStatus: 'healthy' },
  { name: 'MODEL_TRAINING_QUEUE', label: QUEUE_LABELS.MODEL_TRAINING_QUEUE, depth: 2, oldestJobAgeMin: 340, p50AgeMin: 300, p95AgeMin: 340, throughputPerMin: 0.2, failures: 0, retrying: 0, deadLetter: 0, workers: 1, slaStatus: 'healthy' },
]

export function getQueueByName(name: QueueName): QueueStat | undefined {
  return QUEUES.find((q) => q.name === name)
}
