import { supabase } from './supabase'

export type AdminProvider = {
  provider: string
  status: 'healthy' | 'degraded' | 'unknown'
  daily_budget: number | null
  quota_used: number
  protected_production_budget: number
  backfill_budget: number
  quota_pct: number | null
  rate_limit_per_minute: number | null
  rate_used: number
  last_provider_status: number | null
  last_rate_remaining: number | null
  requests_24h: number
  completed_24h: number
  failed_24h: number
  last_completed_at: string | null
  capability_rows: number
  supported_rows: number
  last_checked_at: string | null
  observed_at: string
}

export type CommandCenterSnapshot = {
  production: {
    due_fixtures: number
    with_baseline: number
    coverage_pct: number
  }
  queues: Array<{
    queue_name: string
    queued: number
    running: number
    retrying: number
    dead_letter: number
    total: number
  }>
  incidents: {
    dead_letter_jobs: number
    provider_failures_24h: number
  }
  providers: AdminProvider[]
  bootstrap: {
    campaign: Record<string, unknown>
    seasons: Array<Record<string, any>>
    tranche_queue: Array<Record<string, any>>
    archive_output: Array<Record<string, any>>
    quota: Record<string, any>
  }
  active_model: { version?: string; status?: string; family?: string }
  captured_at: string
}

export type ProviderCatalogSnapshot = {
  countries: number
  competitions: number
  seasons: number
  current_seasons: number
  available_seasons: number
  sync_state: Record<string, any>
}

export type IngestionControlSnapshot = {
  countries: Array<{
    id: string
    catalog_country_id: string | null
    code: string | null
    name: string
    status: string
    enabled: boolean
    priority: number
    notes: string | null
  }>
  competitions: Array<{
    id: string
    catalog_competition_id: string | null
    country_id: string | null
    name: string
    status: string
    enabled: boolean
    priority: number
    notes: string | null
  }>
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const fetchCommandCenterSnapshot = () => rpc<CommandCenterSnapshot>('admin_command_center_snapshot')
export const fetchProviderSnapshot = () => rpc<{ providers: AdminProvider[] }>('admin_provider_snapshot')
export const fetchProviderCatalogSnapshot = () => rpc<ProviderCatalogSnapshot>('admin_provider_catalog_snapshot')
export const fetchIngestionControlSnapshot = () => rpc<IngestionControlSnapshot>('admin_ingestion_control_snapshot')

export const setCountryIngestionEnabled = (catalogCountryId: string, enabled: boolean, priority: number, notes: string | null) =>
  rpc('admin_set_country_ingestion_enabled', {
    p_catalog_country_id: catalogCountryId,
    p_enabled: enabled,
    p_priority: priority,
    p_notes: notes,
  })

export const setCompetitionIngestionEnabled = (catalogCompetitionId: string, enabled: boolean, priority: number, notes: string | null) =>
  rpc('admin_set_competition_ingestion_enabled', {
    p_catalog_competition_id: catalogCompetitionId,
    p_enabled: enabled,
    p_priority: priority,
    p_notes: notes,
  })
