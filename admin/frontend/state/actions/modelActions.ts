import type { SetStore } from '../types'
import { makeAuditEntry, nowIso } from '../helpers'

export function createModelActions(set: SetStore) {
  function reviewCandidate(modelId: string) {
    set((prev) => {
      const model = prev.modelVersions.find((m) => m.id === modelId)
      if (!model) return prev
      return {
        ...prev,
        auditEvents: [makeAuditEntry({ action: 'review_candidate', entityType: 'Model', entityId: `${model.family} ${model.version}` }), ...prev.auditEvents],
      }
    })
  }

  function startShadow(modelId: string) {
    set((prev) => {
      const model = prev.modelVersions.find((m) => m.id === modelId)
      if (!model) return prev
      return {
        ...prev,
        modelVersions: prev.modelVersions.map((m) =>
          m.id === modelId ? { ...m, status: 'SHADOW', shadowState: 'Day 1 of 14 — shadow evaluation started' } : m
        ),
        auditEvents: [makeAuditEntry({ action: 'start_shadow', entityType: 'Model', entityId: `${model.family} ${model.version}`, before: model.status, after: 'SHADOW' }), ...prev.auditEvents],
      }
    })
  }

  function rejectModel(modelId: string, reason: string) {
    set((prev) => {
      const model = prev.modelVersions.find((m) => m.id === modelId)
      if (!model) return prev
      return {
        ...prev,
        modelVersions: prev.modelVersions.map((m) => (m.id === modelId ? { ...m, status: 'REJECTED', shadowState: null } : m)),
        auditEvents: [makeAuditEntry({ action: 'reject_model', entityType: 'Model', entityId: `${model.family} ${model.version}`, reason, before: model.status, after: 'REJECTED' }), ...prev.auditEvents],
      }
    })
  }

  function approvePromotion(candidateId: string, reason: string) {
    set((prev) => {
      const candidate = prev.modelVersions.find((m) => m.id === candidateId)
      const currentActive = prev.modelVersions.find((m) => m.status === 'ACTIVE')
      if (!candidate) return prev
      const now = nowIso()
      return {
        ...prev,
        modelVersions: prev.modelVersions.map((m) => {
          if (m.id === candidateId) return { ...m, status: 'ACTIVE', shadowState: null, promotedAt: now }
          if (currentActive && m.id === currentActive.id) return { ...m, status: 'RETIRED' }
          return m
        }),
        auditEvents: [
          makeAuditEntry({
            action: 'promote_model',
            entityType: 'Model',
            entityId: `${candidate.family} ${candidate.version}`,
            reason,
            before: currentActive ? `${currentActive.family} ${currentActive.version}` : 'none',
            after: `${candidate.family} ${candidate.version}`,
          }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function rollbackModel(reason: string) {
    set((prev) => {
      const currentActive = prev.modelVersions.find((m) => m.status === 'ACTIVE')
      const previousSafe = [...prev.modelVersions]
        .filter((m) => m.status === 'RETIRED')
        .sort((a, b) => new Date(b.promotedAt ?? b.createdAt).getTime() - new Date(a.promotedAt ?? a.createdAt).getTime())[0]
      if (!currentActive || !previousSafe) return prev
      const now = nowIso()
      return {
        ...prev,
        modelVersions: prev.modelVersions.map((m) => {
          if (m.id === currentActive.id) return { ...m, status: 'ROLLBACK' }
          if (m.id === previousSafe.id) return { ...m, status: 'ACTIVE', promotedAt: now }
          return m
        }),
        auditEvents: [
          makeAuditEntry({
            action: 'rollback_model',
            entityType: 'Model',
            entityId: `${currentActive.family} ${currentActive.version}`,
            reason,
            before: `${currentActive.family} ${currentActive.version}`,
            after: `${previousSafe.family} ${previousSafe.version}`,
          }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  return { reviewCandidate, startShadow, rejectModel, approvePromotion, rollbackModel }
}
