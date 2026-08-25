import type { SetStore } from '../types'
import { makeAuditEntry } from '../helpers'
import type { Market } from '../../types/domain'

export interface GateCheck {
  label: string
  passed: boolean
}

export function computeProductionGates(market: Market): GateCheck[] {
  return [
    { label: 'Data gate (provider coverage ≥ 90%)', passed: market.providerCoveragePct >= 90 },
    { label: 'Calibration gate (ECE ≤ 0.030)', passed: market.calibrationEce <= 0.03 },
    { label: 'Consistency gate (OOS quality not weak)', passed: market.oosQuality !== 'weak' },
    { label: 'Semantics gate (settlement semantics verified)', passed: Boolean(market.lastValidation) },
    { label: 'Coverage gate (prediction coverage ≥ 90%)', passed: market.predictionCoveragePct >= 90 },
  ]
}

export function createMarketActions(set: SetStore) {
  function setMarketStatus(marketId: string, status: Market['status'], action: string, reason?: string) {
    set((prev) => {
      const market = prev.markets.find((m) => m.id === marketId)
      if (!market) return prev
      return {
        ...prev,
        markets: prev.markets.map((m) => (m.id === marketId ? { ...m, status } : m)),
        auditEvents: [
          makeAuditEntry({ action, entityType: 'Market', entityId: market.name, reason: reason ?? null, before: market.status, after: status }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function reviewMarket(marketId: string) {
    set((prev) => {
      const market = prev.markets.find((m) => m.id === marketId)
      if (!market) return prev
      return {
        ...prev,
        auditEvents: [makeAuditEntry({ action: 'review_market', entityType: 'Market', entityId: market.name }), ...prev.auditEvents],
      }
    })
  }

  function revalidateSemantics(marketId: string) {
    set((prev) => {
      const market = prev.markets.find((m) => m.id === marketId)
      if (!market) return prev
      const now = new Date().toISOString()
      return {
        ...prev,
        markets: prev.markets.map((m) => (m.id === marketId ? { ...m, lastRevalidation: now } : m)),
        auditEvents: [makeAuditEntry({ action: 'revalidate_market_semantics', entityType: 'Market', entityId: market.name }), ...prev.auditEvents],
      }
    })
  }

  function moveToExperimental(marketId: string, reason: string) {
    setMarketStatus(marketId, 'EXPERIMENTAL', 'move_market_experimental', reason)
  }

  function moveToAbstain(marketId: string, reason: string) {
    setMarketStatus(marketId, 'ABSTAIN', 'move_market_abstain', reason)
  }

  /** Returns the gate results; only mutates state (approves) when every gate passes. */
  function approveProduction(market: Market, reason: string): { success: boolean; gates: GateCheck[] } {
    const gates = computeProductionGates(market)
    const allPass = gates.every((g) => g.passed)
    if (!allPass) {
      set((prev) => ({
        ...prev,
        auditEvents: [
          makeAuditEntry({
            action: 'production_approval_blocked',
            entityType: 'Market',
            entityId: market.name,
            reason: `Failed gates: ${gates.filter((g) => !g.passed).map((g) => g.label).join(', ')}`,
          }),
          ...prev.auditEvents,
        ],
      }))
      return { success: false, gates }
    }
    setMarketStatus(market.id, 'PRODUCTION_ENABLED', 'approve_market_production', reason)
    return { success: true, gates }
  }

  return { reviewMarket, revalidateSemantics, moveToExperimental, moveToAbstain, approveProduction }
}
