import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso } from '../helpers'
import type { IncidentSeverity, IncidentCategory } from '../../types/domain'

export interface CreateIncidentInput {
  type: string
  severity: IncidentSeverity
  category: IncidentCategory
  scope: string
  description: string
  materialToPrediction: boolean
  reason: string
}

export function createIncidentActions(set: SetStore) {
  function createIncident(input: CreateIncidentInput) {
    const incident = {
      id: genId('INC'),
      severity: input.severity,
      category: input.category,
      title: `${input.type} — ${input.scope}`,
      status: 'OPEN' as const,
      owner: 'Unassigned',
      affectedEntities: [input.scope],
      impact: input.description + (input.materialToPrediction ? ' Material to prediction.' : ' Not material to prediction.'),
      timeline: [{ ts: nowIso(), note: `Incident created: ${input.reason}` }],
      resolution: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    set((prev) => ({
      ...prev,
      incidents: [incident, ...prev.incidents],
      auditEvents: [makeAuditEntry({ action: 'create_incident', entityType: 'Incident', entityId: incident.id, reason: input.reason }), ...prev.auditEvents],
    }))
    return incident.id
  }

  function updateIncident(incidentId: string, patch: Partial<{ status: 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED' | 'CLOSED'; owner: string; resolution: string | null }>, action: string, note: string) {
    set((prev) => {
      const incident = prev.incidents.find((i) => i.id === incidentId)
      if (!incident) return prev
      return {
        ...prev,
        incidents: prev.incidents.map((i) =>
          i.id === incidentId
            ? { ...i, ...patch, updatedAt: nowIso(), timeline: [...i.timeline, { ts: nowIso(), note }] }
            : i
        ),
        auditEvents: [makeAuditEntry({ action, entityType: 'Incident', entityId: incident.id, before: incident.status, after: patch.status ?? incident.status }), ...prev.auditEvents],
      }
    })
  }

  const assignIncident = (incidentId: string, owner: string) => updateIncident(incidentId, { owner }, 'assign_incident', `Assigned to ${owner}`)
  const escalateIncident = (incidentId: string) => updateIncident(incidentId, { status: 'INVESTIGATING' }, 'escalate_incident', 'Escalated for immediate investigation')
  const acknowledgeIncident = (incidentId: string) => updateIncident(incidentId, { status: 'INVESTIGATING' }, 'acknowledge_incident', 'Acknowledged by operator')
  const resolveIncident = (incidentId: string, resolution: string) => updateIncident(incidentId, { status: 'RESOLVED', resolution }, 'resolve_incident', `Resolved: ${resolution}`)
  const closeIncident = (incidentId: string) => updateIncident(incidentId, { status: 'CLOSED' }, 'close_incident', 'Closed after verification checks passed')

  return { createIncident, assignIncident, escalateIncident, acknowledgeIncident, resolveIncident, closeIncident }
}
