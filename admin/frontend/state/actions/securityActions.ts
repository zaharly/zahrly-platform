import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso } from '../helpers'
import type { AdminRole } from '../../types/domain'

export interface AddAdminInput {
  name: string
  email: string
  role: AdminRole
}

export function createSecurityActions(set: SetStore) {
  function addAdmin(input: AddAdminInput) {
    const admin = {
      id: genId('ADM'),
      name: input.name,
      email: input.email,
      role: input.role,
      mfaEnabled: false,
      lastLogin: nowIso(),
      sessionStatus: 'active' as const,
      accountStatus: 'active' as const,
    }
    set((prev) => ({
      ...prev,
      adminUsers: [admin, ...prev.adminUsers],
      auditEvents: [makeAuditEntry({ action: 'add_admin', entityType: 'Admin User', entityId: admin.email, after: admin.role }), ...prev.auditEvents],
    }))
  }

  function editAdminRole(adminId: string, role: AdminRole, reason: string) {
    set((prev) => {
      const admin = prev.adminUsers.find((a) => a.id === adminId)
      if (!admin) return prev
      return {
        ...prev,
        adminUsers: prev.adminUsers.map((a) => (a.id === adminId ? { ...a, role } : a)),
        auditEvents: [makeAuditEntry({ action: 'edit_admin_role', entityType: 'Admin User', entityId: admin.email, reason, before: admin.role, after: role }), ...prev.auditEvents],
      }
    })
  }

  function disableAdmin(adminId: string, reason: string) {
    set((prev) => {
      const admin = prev.adminUsers.find((a) => a.id === adminId)
      if (!admin) return prev
      return {
        ...prev,
        adminUsers: prev.adminUsers.map((a) => (a.id === adminId ? { ...a, accountStatus: 'disabled', sessionStatus: 'revoked' } : a)),
        auditEvents: [makeAuditEntry({ action: 'disable_admin', entityType: 'Admin User', entityId: admin.email, reason }), ...prev.auditEvents],
      }
    })
  }

  function revokeSessions(adminId: string) {
    set((prev) => {
      const admin = prev.adminUsers.find((a) => a.id === adminId)
      if (!admin) return prev
      return {
        ...prev,
        adminUsers: prev.adminUsers.map((a) => (a.id === adminId ? { ...a, sessionStatus: 'revoked' } : a)),
        auditEvents: [makeAuditEntry({ action: 'revoke_sessions', entityType: 'Admin User', entityId: admin.email }), ...prev.auditEvents],
      }
    })
  }

  function scheduleSecretRotation(secretId: string, scheduledDate: string) {
    set((prev) => {
      const secret = prev.secretRotations.find((s) => s.id === secretId)
      if (!secret) return prev
      return {
        ...prev,
        auditEvents: [makeAuditEntry({ action: 'schedule_secret_rotation', entityType: 'Secret', entityId: secret.name, after: scheduledDate }), ...prev.auditEvents],
      }
    })
  }

  function rotateMockSecret(secretId: string) {
    set((prev) => {
      const secret = prev.secretRotations.find((s) => s.id === secretId)
      if (!secret) return prev
      const now = new Date()
      const expires = new Date(now.getTime() + 90 * 24 * 3600_000)
      return {
        ...prev,
        secretRotations: prev.secretRotations.map((s) =>
          s.id === secretId
            ? { ...s, lastRotated: now.toISOString().slice(0, 10), expiresAt: expires.toISOString().slice(0, 10), daysRemaining: 90, status: 'healthy' }
            : s
        ),
        auditEvents: [makeAuditEntry({ action: 'rotate_secret', entityType: 'Secret', entityId: secret.name, after: 'rotated' }), ...prev.auditEvents],
      }
    })
  }

  return { addAdmin, editAdminRole, disableAdmin, revokeSessions, scheduleSecretRotation, rotateMockSecret }
}
