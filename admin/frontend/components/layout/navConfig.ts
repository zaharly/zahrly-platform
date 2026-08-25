import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Siren, History, Globe, Trophy, CalendarDays, Gauge, AlertTriangle, Archive,
  Activity, ListTree, Layers, FileClock, CheckSquare, Dices, Server, Radio, Coins, Grid3x3, FileDiff,
  ListOrdered, Cpu, ClipboardList, Inbox, Clock, Repeat, Boxes, Star, FlaskConical, Eye, BarChart3,
  TrendingUp, SlidersHorizontal, Undo2, Users, KeyRound, ScrollText, Lock, Timer, MapPin, HeartHandshake,
  Settings, Flag, Cloud, BookOpen,
} from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  badgeKey?: string
  locked?: boolean
  lockReason?: string
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

const NOT_IMPLEMENTED = 'Locked — backend contract is not implemented yet.'

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'command-center', label: 'Command Center', items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Incidents', path: '/incidents', icon: Siren, badgeKey: 'incidents', locked: true, lockReason: NOT_IMPLEMENTED },
    ],
  },
  {
    id: 'data-coverage', label: 'Data & Coverage', items: [
      { label: 'Historical Bootstrap', path: '/bootstrap', icon: History, lockReason: 'Active — live archive campaign and season state are now read from Supabase.' },
      { label: 'Countries', path: '/data/countries', icon: Globe, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Leagues', path: '/data/leagues', icon: Trophy, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Fixtures', path: '/data/fixtures', icon: CalendarDays, locked: true, lockReason: 'Locked — provider fixture ingestion exists, but the admin control/read surface is not complete yet.' },
      { label: 'Data Quality', path: '/data/quality', icon: Gauge, badgeKey: 'dataQuality', locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Provider Incidents', path: '/data/provider-incidents', icon: AlertTriangle, badgeKey: 'providerIncidents', locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Archive', path: '/data/archive', icon: Archive },
    ],
  },
  {
    id: 'predictions', label: 'Predictions', items: [
      { label: 'Prediction Monitor', path: '/predictions', icon: Activity, locked: true, lockReason: 'Locked — prediction execution backend is not started.' },
      { label: 'Prediction Episodes', path: '/predictions/episodes', icon: ListTree, locked: true, lockReason: 'Locked — prediction execution backend is not started.' },
      { label: 'Markets', path: '/markets', icon: Layers, locked: true, lockReason: 'Locked — prediction/market backend is not started.' },
      { label: 'Evidence Updates', path: '/predictions/evidence', icon: FileClock, locked: true, lockReason: 'Locked — prediction evidence backend is not started.' },
      { label: 'Consistency', path: '/predictions/consistency', icon: CheckSquare, badgeKey: 'consistency', locked: true, lockReason: 'Locked — prediction consistency backend is not started.' },
      { label: 'Simulation', path: '/predictions/simulation', icon: Dices, locked: true, lockReason: 'Locked — prediction simulation backend is not started.' },
    ],
  },
  {
    id: 'providers', label: 'Providers', items: [
      { label: 'Provider Overview', path: '/providers', icon: Server },
      { label: 'API-Football', path: '/providers/api-football', icon: Radio },
      { label: 'PropLine', path: '/providers/propline', icon: Coins, badgeKey: 'propline', locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Odds / Prices', path: '/providers/odds', icon: Coins, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Provider Capabilities', path: '/providers/capabilities', icon: Grid3x3, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Provider Schema Changes', path: '/providers/schema-drift', icon: FileDiff, badgeKey: 'schemaDrift', locked: true, lockReason: NOT_IMPLEMENTED },
    ],
  },
  {
    id: 'workers-pipelines', label: 'Workers & Pipelines', items: [
      { label: 'Queues', path: '/workers/queues', icon: ListOrdered, badgeKey: 'queues', locked: true, lockReason: 'Locked — admin queue control/read contract is not complete.' },
      { label: 'Workers', path: '/workers', icon: Cpu, locked: true, lockReason: 'Locked — worker registry/health backend is not complete.' },
      { label: 'Jobs', path: '/workers/jobs', icon: ClipboardList, locked: true, lockReason: 'Locked — admin job control/read contract is not complete.' },
      { label: 'Dead Letter Queue', path: '/workers/dlq', icon: Inbox, badgeKey: 'dlq', locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Scheduler', path: '/workers/scheduler', icon: Clock, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Cron / Automation', path: '/workers/cron', icon: Repeat, locked: true, lockReason: NOT_IMPLEMENTED },
    ],
  },
  {
    id: 'models', label: 'Models', items: [
      { label: 'Model Registry', path: '/models', icon: Boxes, locked: true, lockReason: 'Locked — model execution/control backend is not started.' },
      { label: 'Active Model', path: '/models/active', icon: Star, locked: true, lockReason: 'Locked — model execution/control backend is not started.' },
      { label: 'Candidates', path: '/models/candidates', icon: FlaskConical, locked: true, lockReason: 'Locked — model execution/control backend is not started.' },
      { label: 'Shadow Testing', path: '/models/shadow', icon: Eye, locked: true, lockReason: 'Locked — model evaluation backend is not started.' },
      { label: 'Evaluation', path: '/models/evaluation', icon: BarChart3, locked: true, lockReason: 'Locked — model evaluation backend is not started.' },
      { label: 'Drift', path: '/models/drift', icon: TrendingUp, badgeKey: 'drift', locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Calibration', path: '/models/calibration', icon: SlidersHorizontal, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Rollback', path: '/models/rollback', icon: Undo2, locked: true, lockReason: NOT_IMPLEMENTED },
    ],
  },
  {
    id: 'security-control', label: 'Security & Control', items: [
      { label: 'Admin Users', path: '/security/admins', icon: Users, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Roles & Permissions', path: '/security/roles', icon: KeyRound, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Audit Log', path: '/security/audit', icon: ScrollText, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Secrets / Rotation Status', path: '/security/secrets', icon: Lock, badgeKey: 'secrets', locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Rate Limits', path: '/security/rate-limits', icon: Timer, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Jurisdiction / Geo Policy', path: '/security/jurisdiction', icon: MapPin, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Responsible Gambling Controls', path: '/security/responsible-gambling', icon: HeartHandshake, locked: true, lockReason: NOT_IMPLEMENTED },
    ],
  },
  {
    id: 'system', label: 'System', items: [
      { label: 'System Settings', path: '/settings', icon: Settings, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Feature Flags', path: '/settings/feature-flags', icon: Flag, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Environment', path: '/settings/environment', icon: Cloud, locked: true, lockReason: NOT_IMPLEMENTED },
      { label: 'Documentation / Runbooks', path: '/settings/docs', icon: BookOpen, locked: true, lockReason: 'Locked — operational documentation surface is not connected yet.' },
    ],
  },
]
