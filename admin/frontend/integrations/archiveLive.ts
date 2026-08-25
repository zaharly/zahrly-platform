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

export interface ArchiveSeasonLive { season: number; campaigns: number; succeeded: number; failed: number; active: number; avg_completeness: number }
export interface ArchiveLiveSnapshot { campaigns: ArchiveCampaignLive[]; seasons: ArchiveSeasonLive[] }
export interface ArchiveCampaignCountryOption { id: string; code: string; name: string }
export interface ArchiveCampaignCompetitionOption { id: string; country_id: string; name: string }
export interface ArchiveCampaignRuleOption { dataset_type: string; policy_version: string; required_threshold: number }
export interface ArchiveRegisteredSeasonOption { provider: string; competition_id: string; season: number; endpoint: string; market: string | null; status: string; checked_at: string | null }
export interface ArchiveCampaignOptions { countries: ArchiveCampaignCountryOption[]; competitions: ArchiveCampaignCompetitionOption[]; rules: ArchiveCampaignRuleOption[]; registered_seasons: ArchiveRegisteredSeasonOption[] }
export interface BackfillSeasonJobResult { job_id: string; country_id: string | null; competition_id: string | null; season: number; dataset_type: string; status: string; priority: number }
export interface ProviderSeasonTriggerResult { accepted: true; season: number; workflow: string }

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token?.trim()
  if (!token) throw new Error('Admin authentication required. Please sign in again.')
  return token
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY')
  const accessToken = await getAccessToken()
  const response = await fetch(`${supabase.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Archive RPC ${name} failed (${response.status}): ${detail}`)
  }
  return response.json() as Promise<T>
}

export async function fetchArchiveLive(): Promise<ArchiveLiveSnapshot> { return rpc('admin_archive_snapshot', {}) }
export async function fetchArchiveCampaignOptions(): Promise<ArchiveCampaignOptions> { return rpc('admin_archive_campaign_options', {}) }
export async function queueBackfillSeason(competitionId: string, season: number, datasetType: string, priority = 0): Promise<BackfillSeasonJobResult> {
  return rpc('admin_queue_backfill_season', { p_competition_id: competitionId, p_season: season, p_dataset_type: datasetType, p_priority: priority })
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
