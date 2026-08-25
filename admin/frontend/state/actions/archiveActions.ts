import type { SetStore } from '../types'
import { makeAuditEntry, genId } from '../helpers'
import type { TrancheQueueItem } from '../../types/domain'

export interface CreateTrancheInput {
  country: string
  league: string
  season: string
  datasetType: string
  priority: TrancheQueueItem['priority']
}

export function createArchiveActions(set: SetStore) {
  function pauseCampaign(reason: string) {
    set((prev) => ({
      ...prev,
      bootstrapCampaign: { ...prev.bootstrapCampaign, status: 'PAUSED' },
      auditEvents: [
        makeAuditEntry({ action: 'pause_bootstrap_campaign', entityType: 'Bootstrap Campaign', entityId: 'Historical Bootstrap 2020–2026', reason }),
        ...prev.auditEvents,
      ],
    }))
  }

  function resumeCampaign() {
    set((prev) => ({
      ...prev,
      bootstrapCampaign: { ...prev.bootstrapCampaign, status: 'ACTIVE' },
      auditEvents: [
        makeAuditEntry({ action: 'resume_bootstrap_campaign', entityType: 'Bootstrap Campaign', entityId: 'Historical Bootstrap 2020–2026' }),
        ...prev.auditEvents,
      ],
    }))
  }

  function retryTrancheScope(trancheId: string) {
    set((prev) => {
      const tranche = prev.trancheQueue.find((t) => t.id === trancheId)
      if (!tranche) return prev
      return {
        ...prev,
        trancheQueue: prev.trancheQueue.map((t) =>
          t.id === trancheId ? { ...t, progressPct: Math.min(100, t.progressPct + 5), requestsUsed: t.requestsUsed + 250 } : t
        ),
        auditEvents: [
          makeAuditEntry({ action: 'retry_tranche_scope', entityType: 'Backfill Tranche', entityId: `${tranche.league} ${tranche.season} — ${tranche.datasetType}` }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function reprioritizeTranche(trancheId: string, reason: string) {
    set((prev) => {
      const tranche = prev.trancheQueue.find((t) => t.id === trancheId)
      if (!tranche) return prev
      const reordered = [{ ...tranche, priority: 'high' as const }, ...prev.trancheQueue.filter((t) => t.id !== trancheId)]
      return {
        ...prev,
        trancheQueue: reordered,
        auditEvents: [
          makeAuditEntry({ action: 'reprioritize_tranche', entityType: 'Backfill Tranche', entityId: `${tranche.league} ${tranche.season} — ${tranche.datasetType}`, reason }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function createBackfillTranche(input: CreateTrancheInput) {
    const tranche: TrancheQueueItem = {
      id: genId('TR'),
      country: input.country,
      league: input.league,
      season: input.season,
      datasetType: input.datasetType,
      priority: input.priority,
      progressPct: 0,
      requestsUsed: 0,
      lastWatermark: '—',
    }
    set((prev) => ({
      ...prev,
      trancheQueue: [tranche, ...prev.trancheQueue],
      queues: prev.queues.map((q) => (q.name === 'BACKFILL_QUEUE' ? { ...q, depth: q.depth + 1 } : q)),
      auditEvents: [
        makeAuditEntry({ action: 'create_backfill_tranche', entityType: 'Backfill Tranche', entityId: `${tranche.league} ${tranche.season} — ${tranche.datasetType}`, after: tranche.id }),
        ...prev.auditEvents,
      ],
    }))
  }

  return { pauseCampaign, resumeCampaign, retryTrancheScope, reprioritizeTranche, createBackfillTranche }
}
