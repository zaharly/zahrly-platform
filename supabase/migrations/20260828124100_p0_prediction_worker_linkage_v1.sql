alter table internal.prediction_jobs
  add column if not exists worker_job_id uuid references internal.worker_jobs(job_id);

create index if not exists prediction_jobs_worker_idx on internal.prediction_jobs(worker_job_id);
