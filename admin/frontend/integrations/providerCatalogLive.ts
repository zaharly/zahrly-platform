import { supabase } from '../lib/supabase'

export interface LiveCountry {
  id: string
  code: string
  name: string
  status: string
  processing_state: 'ENABLED' | 'DISABLED' | null
  processing_reason: string | null
  league_count: number
  enabled_league_count: number
  backfill_job_count: number
  archive_manifest_count: number
  archive_completeness: number
}

export interface LiveSeasonState {
  season: number
  status: string
  provider_status: string
  endpoints: string[]
  checked_at: string | null
  blocked_reason: string | null
  backfill: { total: number; queued: number; running: number; succeeded: number; failed: number; progress: number; requests_used?: number }
  archive: { manifest_count: number; completeness: number }
  campaigns?: { total: number; queued: number; running: number; succeeded: number; failed: number }
}

export interface LiveCompetition {
  id: string
  country_id: string
  name: string
  status: string
  processing_state: 'ENABLED' | 'DISABLED' | null
  processing_reason: string | null
  registered_seasons: number
  seasons: LiveSeasonState[]
  backfill_jobs: { total: number; queued: number; running: number; succeeded: number; failed: number; progress: number; requests_used?: number }
  archive: { manifest_count: number; completeness: number }
}

export interface ProviderCatalogLive {
  countries: LiveCountry[]
  competitions: LiveCompetition[]
  provider_capabilities: Array<{ id: string; provider: string; competition_id: string; season: number; endpoint: string; market: string | null; status: string; checked_at: string | null }>
  backfill_jobs: unknown[]
  archive: unknown[]
  audit?: unknown[]
}

export async function fetchProviderCatalogLive(): Promise<ProviderCatalogLive> {
  const { data, error } = await supabase.rpc('admin_data_control_catalog')
  if (error) throw error
  return (data ?? { countries: [], competitions: [], provider_capabilities: [], backfill_jobs: [], archive: [], audit: [] }) as ProviderCatalogLive
}

export async function setDataControl(scopeType: 'country' | 'competition', scopeId: string, state: 'ENABLED' | 'DISABLED', reason?: string) {
  const { data, error } = await supabase.rpc('admin_set_data_control', {
    p_scope_type: scopeType,
    p_scope_id: scopeId,
    p_state: state,
    p_reason: reason ?? null,
  })
  if (error) throw error
  return data
}
