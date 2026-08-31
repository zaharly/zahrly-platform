import { Routes, Route, Navigate } from 'react-router-dom'
import './appTheme.css'
import { AppShell } from './components/layout/AppShell'
import { StoreProvider } from './state/StoreContext'
import AdminAuthGate from './components/auth/AdminAuthGate'
import AdminDashboardV2 from './pages/AdminDashboardV2'
import IncidentCenter from './pages/incidents/IncidentCenter'
import HistoricalBootstrap from './pages/bootstrap/HistoricalBootstrapLive'
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
import WorkerControlLivePage from './pages/workers/WorkerControlLivePage'
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
import { BonusesPage, BonusEditor, GiveawaysPage, GiveawayEditor, PickRushPage, PickRushEditor, PrizePoolPage, PrizePoolEditor, BookmakersRadarPage, BookmakerEditor, LeaderboardsPage, LeaderboardBotEditor } from './pages/rewards/RewardsAdminV2'

export default function App() {
  return <AdminAuthGate><StoreProvider><AppShell><Routes>
    <Route path="/" element={<AdminDashboardV2/>}/><Route path="/incidents" element={<IncidentCenter/>}/><Route path="/bootstrap" element={<HistoricalBootstrap/>}/><Route path="/bootstrap/campaigns" element={<Navigate to="/bootstrap" replace/>}/>
    <Route path="/data/countries" element={<Countries/>}/><Route path="/data/leagues" element={<Leagues/>}/><Route path="/data/leagues/:id" element={<LeagueDetail/>}/><Route path="/data/fixtures" element={<Fixtures/>}/><Route path="/data/fixtures/:id" element={<FixtureDetail/>}/><Route path="/data/quality" element={<DataQuality/>}/><Route path="/data/provider-incidents" element={<ProviderIncidents/>}/><Route path="/data/archive" element={<ArchivePage/>}/>
    <Route path="/predictions" element={<PredictionMonitor/>}/><Route path="/predictions/episodes" element={<Episodes/>}/><Route path="/predictions/evidence" element={<Evidence/>}/><Route path="/predictions/consistency" element={<Consistency/>}/><Route path="/predictions/simulation" element={<Simulation/>}/><Route path="/predictions/:id" element={<PredictionDetail/>}/>
    <Route path="/markets" element={<Markets/>}/><Route path="/providers" element={<ProvidersPage/>}/><Route path="/providers/api-football" element={<ProvidersPage/>}/><Route path="/providers/propline" element={<ProvidersPage/>}/><Route path="/providers/odds" element={<ProvidersPage/>}/><Route path="/providers/capabilities" element={<ProvidersPage/>}/><Route path="/providers/schema-drift" element={<ProvidersPage/>}/><Route path="/providers/conflicts" element={<ProvidersPage/>}/>
    <Route path="/workers/queues" element={<WorkerControlLivePage/>}/><Route path="/workers/jobs" element={<WorkerControlLivePage/>}/><Route path="/workers/scheduler" element={<WorkerControlLivePage/>}/><Route path="/workers/cron" element={<WorkerControlLivePage/>}/><Route path="/workers" element={<WorkersPage/>}/><Route path="/workers/dlq" element={<DeadLetterQueue/>}/>
    <Route path="/models" element={<ModelRegistry/>}/><Route path="/models/active" element={<ModelRegistry/>}/><Route path="/models/candidates" element={<ModelRegistry/>}/><Route path="/models/shadow" element={<ShadowTesting/>}/><Route path="/models/evaluation" element={<Evaluation/>}/><Route path="/models/calibration" element={<Evaluation/>}/><Route path="/models/drift" element={<Drift/>}/><Route path="/models/rollback" element={<Rollback/>}/>
    <Route path="/security/admins" element={<SecurityPage/>}/><Route path="/security/roles" element={<SecurityPage/>}/><Route path="/security/audit" element={<AuditLog/>}/><Route path="/security/secrets" element={<SecurityPage/>}/><Route path="/security/rate-limits" element={<SecurityPage/>}/><Route path="/security/jurisdiction" element={<Jurisdiction/>}/><Route path="/security/responsible-gambling" element={<Jurisdiction/>}/>
    <Route path="/settings" element={<SettingsPage/>}/><Route path="/settings/feature-flags" element={<SettingsPage/>}/><Route path="/settings/environment" element={<SettingsPage/>}/><Route path="/settings/docs" element={<SettingsPage/>}/>
    <Route path="/bonuses" element={<BonusesPage/>}/><Route path="/bonuses/new" element={<BonusEditor/>}/><Route path="/bonuses/:id/edit" element={<BonusEditor/>}/>
    <Route path="/giveaways" element={<GiveawaysPage/>}/><Route path="/giveaways/new" element={<GiveawayEditor/>}/><Route path="/giveaways/:id/edit" element={<GiveawayEditor/>}/>
    <Route path="/pickrush" element={<PickRushPage/>}/><Route path="/pickrush/new" element={<PickRushEditor/>}/><Route path="/pickrush/:id/edit" element={<PickRushEditor/>}/>
    <Route path="/prizepool" element={<PrizePoolPage/>}/><Route path="/prizepool/new" element={<PrizePoolEditor/>}/><Route path="/prizepool/:id/edit" element={<PrizePoolEditor/>}/>
    <Route path="/bookmakersradar" element={<BookmakersRadarPage/>}/><Route path="/bookmakersradar/new" element={<BookmakerEditor/>}/><Route path="/bookmakersradar/:id/edit" element={<BookmakerEditor/>}/>
    <Route path="/leaderboards" element={<LeaderboardsPage/>}/><Route path="/leaderboards/new" element={<LeaderboardBotEditor/>}/><Route path="/leaderboards/:id/edit" element={<LeaderboardBotEditor/>}/>
    <Route path="*" element={<AdminDashboardV2/>}/>
  </Routes></AppShell></StoreProvider></AdminAuthGate>
}