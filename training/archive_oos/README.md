# Zahrly Prediction Training Archive/OOS Runner

This directory is intentionally isolated from production campaign execution.

It reads historical archive manifests from Supabase, downloads referenced AWS S3 artifacts, validates checksums/metadata, builds a deterministic fixture-level dataset, and emits a run artifact. It MUST NOT write to `public.fixtures`, `internal.worker_jobs`, campaign tables, or production prediction queues.

The runner is designed to be invoked manually or from a dedicated CI job with read-only archive access and isolated training credentials.

## Required environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`

Optional:

- `AWS_SESSION_TOKEN`
- `ARCHIVE_SEASONS` (comma-separated; default: all seasons returned by archive catalog)
- `OOS_MIN_SEASONS` (default: 3)
- `OOS_MIN_MATCHES` (default: 3000)
