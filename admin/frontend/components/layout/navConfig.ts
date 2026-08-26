import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Siren, History, Globe, Trophy, CalendarDays, Gauge, AlertTriangle, Archive,
  Activity, ListTree, Layers, FileClock, CheckSquare, Dices, Server, Radio, Coins, Grid3x3, FileDiff,
  ListOrdered, Cpu, ClipboardList, Inbox, Clock, Repeat, Boxes, Star, FlaskConical, Eye, BarChart3,
  TrendingUp, SlidersHorizontal, Undo2, Users, KeyRound, ScrollText, Lock, Timer, MapPin, HeartHandshake,
  Settings, Flag, Cloud, BookOpen, Database, Sliders,
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

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'command-center', label: 'Command Center', items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Incidents', path: '/incidents', icon: Siren, badgeKey: 'incidents' },
    ],
  },
  {
    id: 'provider-control-plane', label: 'Provider Control Plane', items: [
      { label: 'Provider Catalog', path: '/providers/catalog', icon: Database },
      { label: 'Ingestion Controls', path: '/data/ingestion-controls', icon: Sliders },
    ],
  },
  {
    id: 'data-coverage', label: 'Data & Coverage', items: [
      { label: 'Historical Bootstrap', path: '/bootstrap', icon: History },
      { label: 'Countries', path: '/data/countries', icon: Globe },
      { label: 'Leagues', path: '/data/leagues', icon: Trophy },
      { label: 'Fixtures', path: '/data/fixtures', icon: CalendarDays },
      { label: 'Data Quality', path: '/data/quality', icon: Gauge, badgeKey: 'dataQuality' },
      { label: 'Provider Incidents', path: '/data/provider-incidents', icon: AlertTriangle, badgeKey: 'providerIncidents' },
      { label: 'Archive', path: '/data/archive', icon: Archive },
    ],
  },
  {
    id: 'predictions', label: 'Predictions', items: [
      { label: 'Prediction Monitor', path: '/predictions', icon: Activity },
      { label: 'Prediction Episodes', path: '/predictions/episodes', icon: ListTree },
      { label: 'Markets', path: '/markets', icon: Layers },
      { label: 'Evidence Updates', path: '/predictions/evidence', icon: FileClock },
      { label: 'Consistency', path: '/predictions/consistency', icon: CheckSquare, badgeKey: 'consistency' },
      { label: 'Simulation', path: '/predictions/simulation', icon: Dices },
    ],
  },
  {
    id: 'providers', label: 'Providers', items: [
      { label: 'Provider Overview', path: '/providers', icon: Server },
      { label: 'API-Football', path: '/providers/api-football', icon: Radio },
      { label: 'PropLine', path: '/providers/propline', icon: Coins, badgeKey: 'propline' },
      { label: 'Odds / Prices', path: '/providers/odds', icon: Coins },
      { label: 'Provider Capabilities', path: '/providers/capabilities', icon: Grid3x3 },
      { label: 'Provider Schema Changes', path: '/providers/schema-drift', icon: FileDiff, badgeKey: 'schemaDrift' },
    ],
  },
  {
    id: 'workers-pipelines', label: 'Workers & Pipelines', items: [
      { label: 'Queues', path: '/workers/queues', icon: ListOrdered, badgeKey: 'queues' },
      { label: 'Workers', path: '/workers', icon: Cpu },
      { label: 'Jobs', path: '/workers/jobs', icon: ClipboardList },
      { label: 'Dead Letter Queue', path: '/workers/dlq', icon: Inbox, badgeKey: 'dlq' },
      { label: 'Scheduler', path: '/workers/scheduler', icon: Clock },
      { label: 'Cron / Automation', path: '/workers/cron', icon: Repeat },
    ],
  },
  {
    id: 'models', label: 'Models', items: [
      { label: 'Model Registry', path: '/models', icon: Boxes },
      { label: 'Active Model', path: '/models/active', icon: Star },
      { label: 'Candidates', path: '/models/candidates', icon: FlaskConical },
      { label: 'Shadow Testing', path: '/models/shadow', icon: Eye },
      { label: 'Evaluation', path: '/models/evaluation', icon: BarChart3 },
      { label: 'Drift', path: '/models/drift', icon: TrendingUp, badgeKey: 'drift' },
      { label: 'Calibration', path: '/models/calibration', icon: SlidersHorizontal },
      { label: 'Rollback', path: '/models/rollback', icon: Undo2 },
    ],
  },
  {
    id: 'security-control', label: 'Security & Control', items: [
      { label: 'Admin Users', path: '/security/admins', icon: Users },
      { label: 'Roles & Permissions', path: '/security/roles', icon: KeyRound },
      { label: 'Audit Log', path: '/security/audit', icon: ScrollText },
      { label: 'Secrets / Rotation Status', path: '/security/secrets', icon: Lock, badgeKey: 'secrets' },
      { label: 'Rate Limits', path: '/security/rate-limits', icon: Timer },
      { label: 'Jurisdiction / Geo Policy', path: '/security/jurisdiction', icon: MapPin },
      { label: 'Responsible Gambling Controls', path: '/security/responsible-gambling', icon: HeartHandshake },
    ],
  },
  {
    id: 'system', label: 'System', items: [
      { label: 'System Settings', path: '/settings', icon: Settings },
      { label: 'Feature Flags', path: '/settings/feature-flags', icon: Flag },
      { label: 'Environment', path: '/settings/environment', icon: Cloud },
      { label: 'Documentation / Runbooks', path: '/settings/docs', icon: BookOpen },
    ],
  },
]
