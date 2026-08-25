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

export async function fetchArchiveLive(): Promise<ArchiveLiveSnapshot> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/admin_archive_snapshot`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Archive live read failed (${response.status}): ${detail}`)
  }

  return response.json() as Promise<ArchiveLiveSnapshot>
}
