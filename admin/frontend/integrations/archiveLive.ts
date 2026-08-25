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
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  worker_job_id: string | null
  queue_name: string | null
  worker_status: string | null
  worker_attempts: number | null
  worker_started_at: string | null
  worker_finished_at: string | null
  worker_error_code: string | null
  worker_error_message: string | null
}

export interface ArchiveSeasonLive {
  season: number
  campaigns: number
  succeeded: number
  failed: number
  active: number
  avg_completeness: number
}

export interface ArchiveLiveSnapshot {
  campaigns: ArchiveCampaignLive[]
  seasons: ArchiveSeasonLive[]
}

export interface ArchiveCampaignCountryOption {
  id: string
  code: string
  name: string
}

export interface ArchiveCampaignCompetitionOption {
  id: string
  country_id: string
  name: string
}

export interface ArchiveCampaignRuleOption {
  dataset_type: string
  policy_version: string
  required_threshold: number
}

export interface ArchiveCampaignOptions {
  countries: ArchiveCampaignCountryOption[]
  competitions: ArchiveCampaignCompetitionOption[]
  rules: ArchiveCampaignRuleOption[]
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Archive RPC ${name} failed (${response.status}): ${detail}`)
  }

  return response.json() as Promise<T>
}

export async function fetchArchiveLive(): Promise<ArchiveLiveSnapshot> {
  return rpc<ArchiveLiveSnapshot>('admin_archive_snapshot', {})
}

export async function fetchArchiveCampaignOptions(): Promise<ArchiveCampaignOptions> {
  return rpc<ArchiveCampaignOptions>('admin_archive_campaign_options', {})
}

export interface CreateArchiveCampaignInput {
  country_id: string
  competition_id: string
  season: number
  dataset_type: string
  provider: string
  date_start: string
  date_end: string
  team_set_hash: string
  schema_version: string
  completeness_score: number
  completeness_policy_version?: string | null
  auto_queue?: boolean
}

export interface CreatedArchiveCampaign {
  campaign_id: string
  worker_job_id: string | null
  status: string
  scope_state: string
  dataset_type: string
  provider: string
  season: number
  completeness_score: number
  completeness_policy_version: string
}

export async function createArchiveCampaign(input: CreateArchiveCampaignInput): Promise<CreatedArchiveCampaign> {
  return rpc<CreatedArchiveCampaign>('admin_create_archive_campaign', {
    p_country_id: input.country_id,
    p_competition_id: input.competition_id,
    p_season: input.season,
    p_dataset_type: input.dataset_type,
    p_provider: input.provider,
    p_date_start: input.date_start,
    p_date_end: input.date_end,
    p_team_set_hash: input.team_set_hash,
    p_schema_version: input.schema_version,
    p_completeness_score: input.completeness_score,
    p_completeness_policy_version: input.completeness_policy_version ?? null,
    p_auto_queue: input.auto_queue ?? true,
  })
}
