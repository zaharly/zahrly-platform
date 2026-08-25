import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso } from '../helpers'
import type { ConflictState } from '../../types/domain'

export function createProviderActions(set: SetStore) {
  function quarantineEndpoint(driftEventId: string, reason: string) {
    set((prev) => {
      const event = prev.schemaDriftEvents.find((e) => e.id === driftEventId)
      if (!event) return prev
      const incident = {
        id: genId('INC'),
        severity: 'P1' as const,
        category: 'Provider' as const,
        title: `${event.provider} endpoint quarantined — ${event.endpoint}`,
        status: 'INVESTIGATING' as const,
        owner: 'Unassigned',
        affectedEntities: [event.provider, event.endpoint],
        impact: 'Endpoint blocked from production traffic pending adapter regression suite pass.',
        timeline: [{ ts: nowIso(), note: `Quarantined by operator: ${reason}` }],
        resolution: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      return {
        ...prev,
        schemaDriftEvents: prev.schemaDriftEvents.map((e) =>
          e.id === driftEventId ? { ...e, status: 'QUARANTINED', productionState: 'blocked' } : e
        ),
        incidents: [incident, ...prev.incidents],
        auditEvents: [
          makeAuditEntry({ action: 'quarantine_endpoint', entityType: 'Provider Endpoint', entityId: `${event.provider} ${event.endpoint}`, reason, after: incident.id }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function reviewSchemaChange(driftEventId: string) {
    set((prev) => {
      const event = prev.schemaDriftEvents.find((e) => e.id === driftEventId)
      if (!event) return prev
      return {
        ...prev,
        schemaDriftEvents: prev.schemaDriftEvents.map((e) => (e.id === driftEventId ? { ...e, status: 'TESTING' } : e)),
        auditEvents: [
          makeAuditEntry({ action: 'review_schema_change', entityType: 'Provider Endpoint', entityId: `${event.provider} ${event.endpoint}` }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function reviewCoverage(providerId: string) {
    set((prev) => {
      const provider = prev.providers.find((p) => p.id === providerId)
      if (!provider) return prev
      return {
        ...prev,
        auditEvents: [
          makeAuditEntry({ action: 'review_provider_coverage', entityType: 'Provider', entityId: provider.name }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function reviewPlanPolicy(providerId: string) {
    set((prev) => {
      const provider = prev.providers.find((p) => p.id === providerId)
      if (!provider) return prev
      return {
        ...prev,
        auditEvents: [
          makeAuditEntry({ action: 'review_provider_plan_policy', entityType: 'Provider', entityId: provider.name }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function reviewConflict(conflictId: string) {
    setConflictState(conflictId, 'CORROBORATED', 'review_conflict')
  }

  function resolveConflict(conflictId: string, reason: string) {
    setConflictState(conflictId, 'RESOLVED', 'resolve_conflict', reason)
  }

  function requestConflictReplay(conflictId: string) {
    setConflictState(conflictId, 'REPLAY_REQUIRED', 'controlled_replay_conflict')
  }

  function setConflictState(conflictId: string, state: ConflictState, action: string, reason?: string) {
    set((prev) => {
      const conflict = prev.providerConflicts.find((c) => c.id === conflictId)
      if (!conflict) return prev
      return {
        ...prev,
        providerConflicts: prev.providerConflicts.map((c) => (c.id === conflictId ? { ...c, state } : c)),
        auditEvents: [
          makeAuditEntry({ action, entityType: 'Provider Conflict', entityId: `${conflict.fixtureLabel} — ${conflict.field}`, reason: reason ?? null, before: conflict.state, after: state }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  return { quarantineEndpoint, reviewSchemaChange, reviewCoverage, reviewPlanPolicy, reviewConflict, resolveConflict, requestConflictReplay }
}
