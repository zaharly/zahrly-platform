import type { SetStore } from '../types'
import { makeAuditEntry, genId, nowIso, clamp, round1 } from '../helpers'

export interface AddEvidenceInput {
  evidenceType: string
  source: string
  description: string
  affectedArea: string
  evidenceReference: string
  deltaHint?: number
}

export function createPredictionActions(set: SetStore) {
  function applyEvidence(fixtureId: string, input: AddEvidenceInput, action: string) {
    set((prev) => {
      const fixture = prev.fixtures.find((f) => f.id === fixtureId)
      const prediction = prev.predictions.find((p) => p.fixtureId === fixtureId)
      if (!fixture) return prev
      const delta = round1(input.deltaHint ?? (Math.random() * 6 - 1.5))
      const previousProbability = fixture.currentProbability
      const newProbability = clamp(round1(previousProbability + delta), 3, 97)
      const timestamp = nowIso()

      const evidenceEvent = {
        id: genId('EV'),
        fixtureId,
        timestamp,
        label: input.evidenceType,
        source: input.source,
        affectedFeatures: [input.affectedArea],
        previousProbability,
        newProbability,
        delta: round1(newProbability - previousProbability),
        modelVersion: fixture.modelVersion,
        snapshotHash: `sha256:${Math.abs(Math.floor(Math.random() * 1e12)).toString(16)}`,
        confidenceImpact: (Math.abs(newProbability - previousProbability) > 5 ? 'high' : Math.abs(newProbability - previousProbability) > 2 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      }

      return {
        ...prev,
        evidenceEvents: [...prev.evidenceEvents, evidenceEvent],
        fixtures: prev.fixtures.map((f) => (f.id === fixtureId ? { ...f, currentProbability: newProbability } : f)),
        predictions: prediction
          ? prev.predictions.map((p) =>
              p.fixtureId === fixtureId
                ? {
                    ...p,
                    currentProbability: newProbability,
                    change: round1(newProbability - p.baselineProbability),
                    evidenceCount: p.evidenceCount + 1,
                    lastUpdated: timestamp,
                  }
                : p
            )
          : prev.predictions,
        auditEvents: [
          makeAuditEntry({
            action,
            entityType: 'Prediction',
            entityId: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
            reason: input.description,
            before: `${previousProbability}%`,
            after: `${newProbability}% (baseline unchanged at ${fixture.baselineProbability}%)`,
            ticketOrIncident: input.evidenceReference || null,
          }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function addEvidence(fixtureId: string, input: AddEvidenceInput) {
    applyEvidence(fixtureId, input, 'add_evidence')
  }

  function requestEvidenceRecompute(fixtureId: string) {
    applyEvidence(
      fixtureId,
      {
        evidenceType: 'Evidence recompute',
        source: 'Controlled recompute (admin-triggered)',
        description: 'Recomputed current probability from latest accepted evidence.',
        affectedArea: 'recompute_all_features',
        evidenceReference: '',
        deltaHint: round1(Math.random() * 3 - 1),
      },
      'request_evidence_recompute'
    )
  }

  function revalidatePrediction(fixtureId: string) {
    set((prev) => ({
      ...prev,
      predictions: prev.predictions.map((p) => (p.fixtureId === fixtureId ? { ...p, predictionState: 'PROCESSING' } : p)),
    }))
    window.setTimeout(() => {
      set((prev) => {
        const prediction = prev.predictions.find((p) => p.fixtureId === fixtureId)
        if (!prediction) return prev
        return {
          ...prev,
          predictions: prev.predictions.map((p) =>
            p.fixtureId === fixtureId ? { ...p, predictionState: 'COMPLETED', consistency: 'PASS' } : p
          ),
          auditEvents: [
            makeAuditEntry({ action: 'revalidate_prediction', entityType: 'Prediction', entityId: prediction.fixtureLabel }),
            ...prev.auditEvents,
          ],
        }
      })
    }, 1200)
  }

  return { addEvidence, requestEvidenceRecompute, revalidatePrediction }
}
