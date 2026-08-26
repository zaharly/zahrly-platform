import { supabase } from '../lib/supabase'

export interface HistoricalBootstrapCountryScope {
  id: string
  code: string | null
  name: string
  provider_country_id: number | null
}

export interface HistoricalBootstrapLeagueScope {
  id: string
  provider_competition_id: number
  country_id: string
  name: string
  season: number
  enabled: boolean
}

export interface HistoricalBootstrapDatasetPlan {
  dataset_key: string
  label: string
  category: 'CORE' | 'ENRICHMENT' | 'MARKET'
  endpoint: string
  required_for_archive: boolean
  execution_supported: boolean
  available_count: number
  scope_count: number
  total_count: number
  processed_count: number
  succeeded_count: number
  failed_count: number
  remaining_count: number
  priority?: number | null
  dependency_keys?: string[] | null
}

export interface HistoricalBootstrapQuota {
  daily_budget?: number
  quota_used?: number
  backfill_budget?: number
  protected_production_budget?: number
  window_start?: string
  window_end?: string
  reserve_policy_version?: string | null
}

export interface HistoricalBootstrapCampaignInfo {
  campaign_id?: string
  status?: string
  planned_start_at?: string
  minimum_target_end_at?: string
  requests_used?: number
  completeness_score?: number | null
}

export interface HistoricalBootstrapScope {
  season: number
  countries: HistoricalBootstrapCountryScope[]
  competitions: HistoricalBootstrapLeagueScope[]
  enabled_country_count: number
  enabled_league_count: number
  available_league_count: number
  dataset_plan: HistoricalBootstrapDatasetPlan[]
  quota: HistoricalBootstrapQuota
  campaign: HistoricalBootstrapCampaignInfo
}

export async function fetchHistoricalBootstrapScope(season: number): Promise<HistoricalBootstrapScope> {
  const { data, error } = await supabase.rpc('admin_historical_bootstrap_scope', { p_season: season })
  if (error) throw error
  return (data ?? {
    season,
    countries: [],
    competitions: [],
    enabled_country_count: 0,
    enabled_league_count: 0,
    available_league_count: 0,
    dataset_plan: [],
    quota: {},
    campaign: {},
  }) as HistoricalBootstrapScope
}
