import { supabase } from '../lib/supabase'

export interface ArchiveCampaignLive {
  campaign_id: string
  country_id: string | null
  competition_id: string | null
  season: number
  dataset_type: string
  provider: string
  scope_state: string
  status: string
  completeness_score: number | null
  manifest_id: string | null
  object_uri: string | null
  checksum: string | null
  row_count: number | null
  attempts: number
  started_at: string | null
  finished_at: string | null
  worker_job_id: string | null
  queue_name: string | null
  worker_status: string | null
  worker_attempts: number | null
  worker_started_at: string | null
  worker_finished_at: string | null
  worker_error_code: string | null
  worker_error_message: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface ArchiveSeasonLive {
  season: number
  campaigns: number
  succeeded: number
  failed: number
  active: number
  avg_completeness: number
}

export interface ArchiveLiveSnapshot { campaigns: ArchiveCampaignLive[]; seasons: ArchiveSeasonLive[] }

export interface HistoricalCampaignLive {
  campaign_id: string
  target_start_season: number
  target_end_season: number
  planned_start_at: string
  minimum_target_end_at: string
  status: string
  quota_policy_version: string | null
  production_reserve_policy_version: string | null
  last_successful_watermark: Record<string, unknown> | null
  completeness_score: number | null
  requests_used: number
  created_at: string
  updated_at: string
}

export interface HistoricalSeasonProgress {
  season: number
  supported_leagues: number
  provider_leagues: number
  backfill_jobs: number
  backfill_succeeded: number
  backfill_active: number
  backfill_failed: number
  backfill_progress: number
  archive_campaigns: number
  archive_succeeded: number
  archive_completeness: number
  gate_state: string
  ready_for_archive: boolean
}

export interface HistoricalBootstrapSnapshot {
  campaign: HistoricalCampaignLive | Record<string, never>
  seasons: HistoricalSeasonProgress[]
  tranche_queue: Array<Record<string, unknown>>
  blocked_scopes: Array<Record<string, unknown>>
  archive_output: Array<Record<string, unknown>>
  quota: Record<string, unknown>
}

export interface HistoricalSeasonPrepareResult {
  season: number
  historical_campaign_id: string
  provider_competitions: number
  jobs_created: number
  jobs_existing: number
  jobs_total: number
  dataset_type: string
  status: 'PREPARED' | 'BLOCKED'
}

export interface ProviderSeasonTriggerResult { accepted: true; season: number; workflow: string }

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token?.trim()
  if (!token) throw new Error('Admin authentication required. Please sign in again.')
  return token
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  const accessToken = await getAccessToken()
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Historical RPC ${name} failed (${response.status}): ${detail}`)
  }
  return response.json() as Promise<T>
}

export async function fetchHistoricalBootstrapSnapshot(): Promise<HistoricalBootstrapSnapshot> {
  return rpc('admin_historical_bootstrap_snapshot', {})
}

export async function startHistoricalCampaign(startSeason: number, endSeason: number): Promise<HistoricalCampaignLive & { created?: boolean }> {
  return rpc('admin_start_historical_campaign', { p_start_season: startSeason, p_end_season: endSeason })
}

export async function prepareHistoricalSeason(season: number, priority = 100): Promise<HistoricalSeasonPrepareResult> {
  return rpc('admin_prepare_historical_season', { p_season: season, p_priority: priority })
}

export async function triggerProviderSeason(season: number): Promise<ProviderSeasonTriggerResult> {
  const accessToken = await getAccessToken()
  const response = await fetch('/api/provider-season', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
    body: JSON.stringify({ season }),
  })
  const detail = await response.text().catch(() => '')
  if (!response.ok) throw new Error(detail || `Provider season trigger failed (${response.status})`)
  return JSON.parse(detail) as ProviderSeasonTriggerResult
}
