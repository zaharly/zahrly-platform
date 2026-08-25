// Small helpers shared by every mock action factory.
import type { AuditEvent, AdminRole } from '../types/domain'

let counter = 0

/** Deterministic-ish unique id generator for newly created mock records within a session. */
export function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${counter}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

interface AuditInput {
  action: string
  entityType: string
  entityId: string
  reason?: string | null
  before?: string | null
  after?: string | null
  ticketOrIncident?: string | null
  actorName?: string
  role?: AdminRole
}

/** Builds a new audit entry for the default mock operator, ready to prepend to the audit log. */
export function makeAuditEntry(input: AuditInput): AuditEvent {
  return {
    id: genId('AUD'),
    actorName: input.actorName ?? 'Current Operator',
    role: input.role ?? 'SUPER_ADMIN',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeHash: input.before ? `sha256:${input.before}` : null,
    afterHash: input.after ? `sha256:${input.after}` : null,
    reason: input.reason ?? null,
    ticketOrIncident: input.ticketOrIncident ?? null,
    createdAt: nowIso(),
  }
}
