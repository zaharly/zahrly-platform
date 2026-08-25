import type { SetStore } from '../types'
import { makeAuditEntry, genId } from '../helpers'
import type { QueueName, Job } from '../../types/domain'

export interface CreateJobInput {
  priority: Job['priority']
  payloadSummary: string
  reason: string
}

export function createQueueActions(set: SetStore) {
  function pauseQueue(queueName: QueueName, reason: string) {
    set((prev) => ({
      ...prev,
      queues: prev.queues.map((q) => (q.name === queueName ? { ...q, paused: true } : q)),
      auditEvents: [
        makeAuditEntry({ action: 'pause_queue', entityType: 'Queue', entityId: queueName, reason }),
        ...prev.auditEvents,
      ],
    }))
  }

  function resumeQueue(queueName: QueueName) {
    set((prev) => ({
      ...prev,
      queues: prev.queues.map((q) => (q.name === queueName ? { ...q, paused: false } : q)),
      auditEvents: [
        makeAuditEntry({ action: 'resume_queue', entityType: 'Queue', entityId: queueName }),
        ...prev.auditEvents,
      ],
    }))
  }

  function createJob(queueName: QueueName, input: CreateJobInput) {
    const job: Job = {
      id: genId('JOB'),
      queue: queueName,
      status: 'PENDING',
      attempts: 1,
      worker: null,
      leaseExpiresAt: null,
      checkpoint: 'checkpoint:none',
      error: null,
      retryAt: null,
      priority: input.priority,
      payloadSummary: input.payloadSummary,
      firstFailure: null,
      lastFailure: null,
    }
    set((prev) => ({
      ...prev,
      jobs: [job, ...prev.jobs],
      queues: prev.queues.map((q) => (q.name === queueName ? { ...q, depth: q.depth + 1 } : q)),
      auditEvents: [
        makeAuditEntry({ action: 'create_job', entityType: 'Job', entityId: job.id, reason: input.reason, after: job.payloadSummary }),
        ...prev.auditEvents,
      ],
    }))
  }

  function retryJob(jobId: string) {
    let originatedFromDlq = false
    set((prev) => ({
      ...prev,
      jobs: prev.jobs.map((j) => {
        if (j.id !== jobId) return j
        originatedFromDlq = j.status === 'DEAD_LETTER'
        return { ...j, status: 'RETRYING', attempts: j.attempts + 1 }
      }),
    }))
    window.setTimeout(() => {
      set((prev) => {
        const job = prev.jobs.find((j) => j.id === jobId)
        if (!job) return prev
        return {
          ...prev,
          jobs: prev.jobs.map((j) => (j.id === jobId ? { ...j, status: 'COMPLETED', error: null } : j)),
          queues: prev.queues.map((q) =>
            q.name === job.queue
              ? { ...q, deadLetter: Math.max(0, q.deadLetter - (originatedFromDlq ? 1 : 0)) }
              : q
          ),
          auditEvents: [
            makeAuditEntry({ action: 'retry_job', entityType: 'Job', entityId: job.id, after: 'COMPLETED' }),
            ...prev.auditEvents,
          ],
        }
      })
    }, 1500)
  }

  function replayJob(jobId: string) {
    set((prev) => {
      const original = prev.jobs.find((j) => j.id === jobId)
      if (!original) return prev
      const replay: Job = {
        ...original,
        id: genId('JOB-REPLAY'),
        status: 'PENDING',
        attempts: 1,
        error: null,
        firstFailure: null,
        lastFailure: null,
        checkpoint: 'checkpoint:none',
      }
      return {
        ...prev,
        jobs: [replay, ...prev.jobs],
        queues: prev.queues.map((q) => (q.name === original.queue ? { ...q, depth: q.depth + 1 } : q)),
        auditEvents: [
          makeAuditEntry({
            action: 'replay_dead_letter',
            entityType: 'Job',
            entityId: original.id,
            after: `New lineage ${replay.id}`,
            reason: 'Manual replay — original dead-letter record preserved for audit.',
          }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function controlledReplay(subjectLabel: string, reason: string, artifacts: string[]): string {
    const job: Job = {
      id: genId('JOB-REPLAY'),
      queue: 'REPAIR_QUEUE',
      status: 'PENDING',
      attempts: 1,
      worker: null,
      leaseExpiresAt: null,
      checkpoint: 'checkpoint:none',
      error: null,
      retryAt: null,
      priority: 'high',
      payloadSummary: `Controlled replay: ${subjectLabel} — ${artifacts.join(', ')}`,
      firstFailure: null,
      lastFailure: null,
    }
    set((prev) => ({
      ...prev,
      jobs: [job, ...prev.jobs],
      queues: prev.queues.map((q) => (q.name === 'REPAIR_QUEUE' ? { ...q, depth: q.depth + 1 } : q)),
      auditEvents: [
        makeAuditEntry({ action: 'controlled_replay_requested', entityType: 'Prediction', entityId: subjectLabel, reason, after: job.id }),
        ...prev.auditEvents,
      ],
    }))
    window.setTimeout(() => {
      set((prev) => ({ ...prev, jobs: prev.jobs.map((j) => (j.id === job.id ? { ...j, status: 'RUNNING' } : j)) }))
    }, 1200)
    window.setTimeout(() => {
      set((prev) => {
        const succeeded = Math.random() > 0.12
        return {
          ...prev,
          jobs: prev.jobs.map((j) => (j.id === job.id ? { ...j, status: succeeded ? 'COMPLETED' : 'FAILED', error: succeeded ? null : 'Replay validation failed — see incident for detail' } : j)),
          queues: prev.queues.map((q) => (q.name === 'REPAIR_QUEUE' ? { ...q, depth: Math.max(0, q.depth - 1) } : q)),
          auditEvents: [
            makeAuditEntry({ action: 'controlled_replay_completed', entityType: 'Prediction', entityId: subjectLabel, after: succeeded ? 'COMPLETED' : 'FAILED' }),
            ...prev.auditEvents,
          ],
        }
      })
    }, 3400)
    return job.id
  }

  return { pauseQueue, resumeQueue, createJob, retryJob, replayJob, controlledReplay }
}
