import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso } from '../helpers'
import type { IncidentSeverity, IncidentCategory } from '../../types/domain'

export interface FixtureCorrectionInput {
  kickoff?: string
  venue?: string
  homeTeam?: string
  awayTeam?: string
  round?: string
  matchStatus?: 'SCHEDULED' | 'POSTPONED' | 'CANCELLED' | 'COMPLETED'
}

export function createFixtureActions(set: SetStore) {
  function bumpQueueDepth(queueName: string, delta: number) {
    set((prev) => ({
      ...prev,
      queues: prev.queues.map((q) => (q.name === queueName ? { ...q, depth: Math.max(0, q.depth + delta) } : q)),
    }))
  }

  function applyFixtureCorrection(fixtureId: string, changes: FixtureCorrectionInput, reason: string) {
    set((prev) => {
      const fixture = prev.fixtures.find((f) => f.id === fixtureId)
      if (!fixture) return prev
      return {
        ...prev,
        fixtures: prev.fixtures.map((f) =>
          f.id === fixtureId ? { ...f, ...changes, lastCorrectedAt: nowIso() } : f
        ),
        auditEvents: [
          makeAuditEntry({
            action: 'manual_fixture_correction',
            entityType: 'Fixture',
            entityId: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
            reason,
            before: JSON.stringify({ kickoff: fixture.kickoff, venue: fixture.venue, matchStatus: fixture.matchStatus }),
            after: JSON.stringify(changes),
          }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function revalidateFixture(fixtureId: string) {
    set((prev) => ({
      ...prev,
      fixtures: prev.fixtures.map((f) => (f.id === fixtureId ? { ...f, predictionState: 'PROCESSING' } : f)),
    }))
    window.setTimeout(() => {
      set((prev) => {
        const fixture = prev.fixtures.find((f) => f.id === fixtureId)
        if (!fixture) return prev
        return {
          ...prev,
          fixtures: prev.fixtures.map((f) => (f.id === fixtureId ? { ...f, predictionState: 'COMPLETED', dataReadinessPct: Math.min(100, f.dataReadinessPct + 3) } : f)),
          auditEvents: [
            makeAuditEntry({ action: 'revalidate_fixture', entityType: 'Fixture', entityId: `${fixture.homeTeam} vs ${fixture.awayTeam}` }),
            ...prev.auditEvents,
          ],
        }
      })
    }, 1400)
  }

  function createRepairJobForFixture(fixtureId: string, reason: string, payloadSummary: string) {
    set((prev) => {
      const fixture = prev.fixtures.find((f) => f.id === fixtureId)
      if (!fixture) return prev
      const job = {
        id: genId('JOB-REP'),
        queue: 'REPAIR_QUEUE' as const,
        status: 'PENDING' as const,
        attempts: 1,
        worker: null,
        leaseExpiresAt: null,
        checkpoint: 'checkpoint:none',
        error: null,
        retryAt: null,
        priority: 'high' as const,
        payloadSummary,
        firstFailure: null,
        lastFailure: null,
      }
      return {
        ...prev,
        jobs: [job, ...prev.jobs],
        queues: prev.queues.map((q) => (q.name === 'REPAIR_QUEUE' ? { ...q, depth: q.depth + 1 } : q)),
        auditEvents: [
          makeAuditEntry({ action: 'create_repair_job', entityType: 'Fixture', entityId: `${fixture.homeTeam} vs ${fixture.awayTeam}`, reason, after: job.id }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function openDataIncidentForFixture(
    fixtureId: string,
    payload: { severity: IncidentSeverity; category: IncidentCategory; description: string; materialToPrediction: boolean }
  ) {
    set((prev) => {
      const fixture = prev.fixtures.find((f) => f.id === fixtureId)
      if (!fixture) return prev
      const incident = {
        id: genId('INC'),
        severity: payload.severity,
        category: payload.category,
        title: `${payload.category} incident — ${fixture.homeTeam} vs ${fixture.awayTeam}`,
        status: 'OPEN' as const,
        owner: 'Unassigned',
        affectedEntities: [`${fixture.homeTeam} vs ${fixture.awayTeam}`, fixture.leagueName],
        impact: payload.description + (payload.materialToPrediction ? ' Material to prediction.' : ' Not material to prediction.'),
        timeline: [{ ts: nowIso(), note: 'Incident opened from Fixture Operations' }],
        resolution: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      return {
        ...prev,
        incidents: [incident, ...prev.incidents],
        fixtures: prev.fixtures.map((f) => (f.id === fixtureId ? { ...f, hasIncident: true } : f)),
        auditEvents: [
          makeAuditEntry({ action: 'open_data_incident', entityType: 'Fixture', entityId: `${fixture.homeTeam} vs ${fixture.awayTeam}`, after: incident.id }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  return { applyFixtureCorrection, revalidateFixture, createRepairJobForFixture, openDataIncidentForFixture, bumpQueueDepth }
}
