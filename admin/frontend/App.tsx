import { Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import './appTheme.css'
import { AppShell } from './components/layout/AppShell'
import { StoreProvider } from './state/StoreContext'
import AdminAuthGate from './components/auth/AdminAuthGate'
import { AdminRouteAvailabilityGate } from './components/layout/AdminRouteAvailabilityGate'

import Dashboard from './pages/Dashboard'
import IncidentCenter from './pages/incidents/IncidentCenter'
import HistoricalBootstrap from './pages/bootstrap/HistoricalBootstrapLive'
import ProviderCatalog from './pages/providers/ProviderCatalog'
import IngestionControls from './pages/data/IngestionControls'
import Countries from './pages/data/Countries'
import Leagues from './pages/data/Leagues'
import LeagueDetail from './pages/data/LeagueDetail'
import Fixtures from './pages/data/Fixtures'
import FixtureDetail from './pages/data/FixtureDetail'
import DataQuality from './pages/data/DataQuality'
import ProviderIncidents from './pages/data/ProviderIncidents'
import ArchivePage from './pages/data/Archive'
import PredictionMonitor from './pages/predictions/PredictionMonitor'
import PredictionDetail from './pages/predictions/PredictionDetail'
import Episodes from './pages/predictions/Episodes'
import Evidence from './pages/predictions/Evidence'
import Consistency from './pages/predictions/Consistency'
import Simulation from './pages/predictions/Simulation'
import Markets from './pages/markets/Markets'
import ProvidersPage from './pages/providers/ProvidersPage'
import QueuesPage from './pages/workers/QueuesPage'
import WorkersPage from './pages/workers/WorkersPage'
import DeadLetterQueue from './pages/workers/DeadLetterQueue'
import ModelRegistry from './pages/models/ModelRegistry'
import ShadowTesting from './pages/models/ShadowTesting'
import Evaluation from './pages/models/Evaluation'
import Drift from './pages/models/Drift'
import Rollback from './pages/models/Rollback'
import SecurityPage from './pages/security/SecurityPage'
import AuditLog from './pages/security/AuditLog'
import Jurisdiction from './pages/security/Jurisdiction'
import SettingsPage from './pages/settings/SettingsPage'

function AvailabilityRoute({ element }: { element: ReactNode }) {
  return <AdminRouteAvailabilityGate>{element}</AdminRouteAvailabilityGate>
}

export default function App() {
  return (
    <AdminAuthGate>
      <StoreProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<AvailabilityRoute element={<Dashboard />} />} />
            <Route path="/incidents" element={<AvailabilityRoute element={<IncidentCenter />} />} />
            <Route path="/bootstrap" element={<AvailabilityRoute element={<HistoricalBootstrap />} />} />
            <Route path="/bootstrap/campaigns" element={<Navigate to="/bootstrap" replace />} />
            <Route path="/providers/catalog" element={<AvailabilityRoute element={<ProviderCatalog />} />} />
            <Route path="/data/ingestion-controls" element={<AvailabilityRoute element={<IngestionControls />} />} />
            <Route path="/data/countries" element={<AvailabilityRoute element={<Countries />} />} />
            <Route path="/data/leagues" element={<AvailabilityRoute element={<Leagues />} />} />
            <Route path="/data/leagues/:id" element={<AvailabilityRoute element={<LeagueDetail />} />} />
            <Route path="/data/fixtures" element={<AvailabilityRoute element={<Fixtures />} />} />
            <Route path="/data/fixtures/:id" element={<AvailabilityRoute element={<FixtureDetail />} />} />
            <Route path="/data/quality" element={<AvailabilityRoute element={<DataQuality />} />} />
            <Route path="/data/provider-incidents" element={<AvailabilityRoute element={<ProviderIncidents />} />} />
            <Route path="/data/archive" element={<AvailabilityRoute element={<ArchivePage />} />} />
            <Route path="/predictions" element={<AvailabilityRoute element={<PredictionMonitor />} />} />
            <Route path="/predictions/episodes" element={<AvailabilityRoute element={<Episodes />} />} />
            <Route path="/predictions/evidence" element={<AvailabilityRoute element={<Evidence />} />} />
            <Route path="/predictions/consistency" element={<AvailabilityRoute element={<Consistency />} />} />
            <Route path="/predictions/simulation" element={<AvailabilityRoute element={<Simulation />} />} />
            <Route path="/predictions/:id" element={<AvailabilityRoute element={<PredictionDetail />} />} />
            <Route path="/markets" element={<AvailabilityRoute element={<Markets />} />} />
            <Route path="/providers" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/providers/api-football" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/providers/propline" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/providers/odds" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/providers/capabilities" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/providers/schema-drift" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/providers/conflicts" element={<AvailabilityRoute element={<ProvidersPage />} />} />
            <Route path="/workers/queues" element={<AvailabilityRoute element={<QueuesPage />} />} />
            <Route path="/workers/jobs" element={<AvailabilityRoute element={<QueuesPage />} />} />
            <Route path="/workers/scheduler" element={<AvailabilityRoute element={<QueuesPage />} />} />
            <Route path="/workers/cron" element={<AvailabilityRoute element={<QueuesPage />} />} />
            <Route path="/workers" element={<AvailabilityRoute element={<WorkersPage />} />} />
            <Route path="/workers/dlq" element={<AvailabilityRoute element={<DeadLetterQueue />} />} />
            <Route path="/models" element={<AvailabilityRoute element={<ModelRegistry />} />} />
            <Route path="/models/active" element={<AvailabilityRoute element={<ModelRegistry />} />} />
            <Route path="/models/candidates" element={<AvailabilityRoute element={<ModelRegistry />} />} />
            <Route path="/models/shadow" element={<AvailabilityRoute element={<ShadowTesting />} />} />
            <Route path="/models/evaluation" element={<AvailabilityRoute element={<Evaluation />} />} />
            <Route path="/models/calibration" element={<AvailabilityRoute element={<Evaluation />} />} />
            <Route path="/models/drift" element={<AvailabilityRoute element={<Drift />} />} />
            <Route path="/models/rollback" element={<AvailabilityRoute element={<Rollback />} />} />
            <Route path="/security/admins" element={<AvailabilityRoute element={<SecurityPage />} />} />
            <Route path="/security/roles" element={<AvailabilityRoute element={<SecurityPage />} />} />
            <Route path="/security/secrets" element={<AvailabilityRoute element={<SecurityPage />} />} />
            <Route path="/security/rate-limits" element={<AvailabilityRoute element={<SecurityPage />} />} />
            <Route path="/security/audit" element={<AvailabilityRoute element={<AuditLog />} />} />
            <Route path="/security/jurisdiction" element={<AvailabilityRoute element={<Jurisdiction />} />} />
            <Route path="/security/responsible-gambling" element={<AvailabilityRoute element={<Jurisdiction />} />} />
            <Route path="/settings" element={<AvailabilityRoute element={<SettingsPage />} />} />
            <Route path="/settings/feature-flags" element={<AvailabilityRoute element={<SettingsPage />} />} />
            <Route path="/settings/environment" element={<AvailabilityRoute element={<SettingsPage />} />} />
            <Route path="/settings/docs" element={<AvailabilityRoute element={<SettingsPage />} />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </AppShell>
      </StoreProvider>
    </AdminAuthGate>
  )
}
