export interface LiveCountry {
  id: string
  code: string
  name: string
}

export interface LiveCompetition {
  id: string
  country_id: string
  name: string
  supported_seasons: number
  seasons: number[]
}

export interface ProviderCatalogLive {
  countries: LiveCountry[]
  competitions: LiveCompetition[]
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Provider catalog RPC ${name} failed (${response.status}): ${detail}`)
  }
  return response.json() as Promise<T>
}

export async function fetchProviderCatalogLive(): Promise<ProviderCatalogLive> {
  const options = await rpc<{
    countries: LiveCountry[]
    competitions: Array<{ id: string; country_id: string; name: string }>
    registered_seasons: Array<{ provider: string; competition_id: string; season: number; status: string }>
  }>('admin_archive_campaign_options', {})

  const seasonsByCompetition = new Map<string, number[]>()
  for (const row of options.registered_seasons ?? []) {
    if (row.provider !== 'api-football' || row.status !== 'SUPPORTED') continue
    const list = seasonsByCompetition.get(row.competition_id) ?? []
    list.push(row.season)
    seasonsByCompetition.set(row.competition_id, list)
  }

  return {
    countries: options.countries ?? [],
    competitions: (options.competitions ?? []).map((c) => {
      const seasons = [...new Set(seasonsByCompetition.get(c.id) ?? [])].sort((a, b) => b - a)
      return { ...c, seasons, supported_seasons: seasons.length }
    }),
  }
}
