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

export interface HistoricalBootstrapScope {
  season: number
  countries: HistoricalBootstrapCountryScope[]
  competitions: HistoricalBootstrapLeagueScope[]
  enabled_country_count: number
  enabled_league_count: number
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
  }) as HistoricalBootstrapScope
}
