import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { StoreState } from './types'
import { buildInitialState } from './initialState'
import { createCountryLeagueActions } from './actions/countryLeagueActions'
import { createFixtureActions } from './actions/fixtureActions'
import { createPredictionActions } from './actions/predictionActions'
import { createQueueActions } from './actions/queueActions'
import { createProviderActions } from './actions/providerActions'
import { createMarketActions } from './actions/marketActions'
import { createModelActions } from './actions/modelActions'
import { createSimulationActions } from './actions/simulationActions'
import { createArchiveActions } from './actions/archiveActions'
import { createSecurityActions } from './actions/securityActions'
import { createPolicyActions } from './actions/policyActions'
import { createIncidentActions } from './actions/incidentActions'

function buildActions(set: (updater: (prev: StoreState) => StoreState) => void) {
  return {
    ...createCountryLeagueActions(set),
    ...createFixtureActions(set),
    ...createPredictionActions(set),
    ...createQueueActions(set),
    ...createProviderActions(set),
    ...createMarketActions(set),
    ...createModelActions(set),
    ...createSimulationActions(set),
    ...createArchiveActions(set),
    ...createSecurityActions(set),
    ...createPolicyActions(set),
    ...createIncidentActions(set),
  }
}

type StoreActions = ReturnType<typeof buildActions>

interface StoreContextValue {
  state: StoreState
  actions: StoreActions
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>(buildInitialState)
  const actions = useMemo(() => buildActions(setState), [])
  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

function useStoreContext(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore hooks must be used within <StoreProvider>')
  return ctx
}

export function useStoreActions(): StoreActions {
  return useStoreContext().actions
}

export function useCountries() { return useStoreContext().state.countries }
export function useLeagues() { return useStoreContext().state.leagues }
export function useLeagueById(id: string | undefined) { return useStoreContext().state.leagues.find((l) => l.id === id) }
export function useFixtures() { return useStoreContext().state.fixtures }
export function useFixtureById(id: string | undefined) { return useStoreContext().state.fixtures.find((f) => f.id === id) }
export function useEvidenceEvents() { return useStoreContext().state.evidenceEvents }
export function useEvidenceForFixture(fixtureId: string | undefined) {
  const events = useStoreContext().state.evidenceEvents
  return useMemo(
    () => events.filter((e) => e.fixtureId === fixtureId).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [events, fixtureId]
  )
}
export function usePredictions() { return useStoreContext().state.predictions }
export function usePredictionById(id: string | undefined) { return useStoreContext().state.predictions.find((p) => p.id === id) }
export function usePredictionForFixture(fixtureId: string | undefined) { return useStoreContext().state.predictions.find((p) => p.fixtureId === fixtureId) }
export function useMarkets() { return useStoreContext().state.markets }
export function useSimulationRuns() { return useStoreContext().state.simulationRuns }
export function useProviders() { return useStoreContext().state.providers }
export function useProviderById(id: string | undefined) { return useStoreContext().state.providers.find((p) => p.id === id) }
export function useProviderConflicts() { return useStoreContext().state.providerConflicts }
export function useSchemaDriftEvents() { return useStoreContext().state.schemaDriftEvents }
export function useQueues() { return useStoreContext().state.queues }
export function useJobs() { return useStoreContext().state.jobs }
export function useDeadLetterJobs() {
  const jobs = useStoreContext().state.jobs
  return useMemo(() => jobs.filter((j) => j.status === 'DEAD_LETTER'), [jobs])
}
export function useWorkers() { return useStoreContext().state.workers }
export function useModelVersions() { return useStoreContext().state.modelVersions }
export function useActiveModel() { return useStoreContext().state.modelVersions.find((m) => m.status === 'ACTIVE') }
export function useAdminUsers() { return useStoreContext().state.adminUsers }
export function useSecretRotations() { return useStoreContext().state.secretRotations }
export function usePolicySettings() { return useStoreContext().state.policySettings }
export function usePolicyDrafts() { return useStoreContext().state.policyDrafts }
export function useFeatureFlags() { return useStoreContext().state.featureFlags }
export function useAuditEvents() { return useStoreContext().state.auditEvents }
export function useIncidents() { return useStoreContext().state.incidents }
export function useBootstrapCampaign() { return useStoreContext().state.bootstrapCampaign }
export function useBootstrapSeasons() { return useStoreContext().state.bootstrapSeasons }
export function useTrancheQueue() { return useStoreContext().state.trancheQueue }
export function useArchiveRecords() { return useStoreContext().state.archiveRecords }
export function useRateLimitIncidents() { return useStoreContext().state.rateLimitIncidents }
export function useDataQualityDomains() { return useStoreContext().state.dataQualityDomains }
export function useDriftMetrics() { return useStoreContext().state.driftMetrics }
export function useShadowEvaluations() { return useStoreContext().state.shadowEvaluations }
export function useJurisdictionPolicies() { return useStoreContext().state.jurisdictionPolicies }
