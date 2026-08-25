import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso } from '../helpers'

export function createPolicyActions(set: SetStore) {
  function createPolicyDraft(policyId: string, proposedValue: string, createdBy: string) {
    set((prev) => {
      const policy = prev.policySettings.find((p) => p.id === policyId)
      if (!policy) return prev
      const draft = {
        id: genId('DRAFT'),
        policyId,
        policyName: policy.name,
        proposedValue,
        status: 'DRAFT' as const,
        createdBy,
        createdAt: nowIso(),
        approvedBy: null,
        approvedAt: null,
      }
      return {
        ...prev,
        policyDrafts: [draft, ...prev.policyDrafts],
        auditEvents: [makeAuditEntry({ action: 'create_policy_draft', entityType: 'Policy', entityId: policy.name, after: proposedValue }), ...prev.auditEvents],
      }
    })
  }

  function reviewPolicyDraft(draftId: string) {
    set((prev) => {
      const draft = prev.policyDrafts.find((d) => d.id === draftId)
      if (!draft) return prev
      return {
        ...prev,
        policyDrafts: prev.policyDrafts.map((d) => (d.id === draftId ? { ...d, status: 'IN_REVIEW' } : d)),
        auditEvents: [makeAuditEntry({ action: 'review_policy_draft', entityType: 'Policy', entityId: draft.policyName }), ...prev.auditEvents],
      }
    })
  }

  function approvePolicyDraft(draftId: string, approvedBy: string) {
    set((prev) => {
      const draft = prev.policyDrafts.find((d) => d.id === draftId)
      if (!draft) return prev
      return {
        ...prev,
        policyDrafts: prev.policyDrafts.map((d) => (d.id === draftId ? { ...d, status: 'APPROVED', approvedBy, approvedAt: nowIso() } : d)),
        auditEvents: [makeAuditEntry({ action: 'approve_policy_draft', entityType: 'Policy', entityId: draft.policyName, after: approvedBy }), ...prev.auditEvents],
      }
    })
  }

  function activatePolicyDraft(draftId: string) {
    set((prev) => {
      const draft = prev.policyDrafts.find((d) => d.id === draftId)
      if (!draft || draft.status !== 'APPROVED') return prev
      const policy = prev.policySettings.find((p) => p.id === draft.policyId)
      if (!policy) return prev
      const versionParts = policy.policyVersion.split('v')
      const nextVersion = `${versionParts[0] ?? ''}v${(parseFloat(versionParts[1] ?? '1') + 0.1).toFixed(1)}`
      return {
        ...prev,
        policySettings: prev.policySettings.map((p) =>
          p.id === draft.policyId
            ? { ...p, value: draft.proposedValue, policyVersion: nextVersion, lastChanged: nowIso(), changedBy: draft.approvedBy ?? 'Current Operator', effectiveAt: nowIso() }
            : p
        ),
        policyDrafts: prev.policyDrafts.map((d) => (d.id === draftId ? { ...d, status: 'ACTIVATED' } : d)),
        auditEvents: [
          makeAuditEntry({ action: 'activate_policy', entityType: 'Policy', entityId: policy.name, before: policy.value, after: draft.proposedValue }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function toggleFeatureFlag(flagId: string, reason: string) {
    set((prev) => {
      const flag = prev.featureFlags.find((f) => f.id === flagId)
      if (!flag) return prev
      const nextEnabled = !flag.enabled
      return {
        ...prev,
        featureFlags: prev.featureFlags.map((f) => (f.id === flagId ? { ...f, enabled: nextEnabled, lastChanged: nowIso(), changedBy: 'Current Operator' } : f)),
        auditEvents: [
          makeAuditEntry({ action: 'toggle_feature_flag', entityType: 'Feature Flag', entityId: flag.name, reason, before: String(flag.enabled), after: String(nextEnabled) }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  return { createPolicyDraft, reviewPolicyDraft, approvePolicyDraft, activatePolicyDraft, toggleFeatureFlag }
}
