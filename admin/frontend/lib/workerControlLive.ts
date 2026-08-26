import { supabase } from './supabase'

export type WorkerQueueLive = {
  queue_name: string
  total: number
  queued: number
  running: number
  retrying: number
  failed: number
  dead_letter: number
  workers: number
  oldest_active_at: string | null
  last_finished_at: string | null
}

export type WorkerJobLive = {
  job_id: string
  queue_name: string
  status: string
  attempts: number
  worker_id: string | null
  next_retry_at: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  error_code: string | null
  error_message: string | null
  dead_lettered_at: string | null
}

export type CronControlLive = {
  job_id: number
  label: string
  schedule: string
  active: boolean
  category: 'scheduler' | 'automation'
  last_run_at: string | null
  last_end_at: string | null
  last_run_status: string | null
  last_run_message: string | null
}

export type WorkerControlSnapshot = {
  captured_at: string
  queues: WorkerQueueLive[]
  jobs: WorkerJobLive[]
  scheduler: CronControlLive[]
  automation: CronControlLive[]
}

export async function fetchWorkerControlSnapshot(): Promise<WorkerControlSnapshot> {
  const { data, error } = await supabase.rpc('admin_worker_control_snapshot')
  if (error) throw new Error(error.message)
  return data as WorkerControlSnapshot
}
