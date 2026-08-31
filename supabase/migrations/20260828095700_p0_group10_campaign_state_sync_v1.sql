CREATE OR REPLACE FUNCTION internal.sync_historical_campaign_state()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'internal', 'public', 'pg_catalog'
AS $function$
DECLARE
  c internal.historical_backfill_campaigns%rowtype;
  v_total_jobs bigint;
  v_succeeded_jobs bigint;
  v_terminal_failed_jobs bigint;
  v_open_jobs bigint;
  v_requests_used bigint;
  v_last_success_at timestamptz;
  v_watermark jsonb;
  v_new_status text;
BEGIN
  FOR c IN
    SELECT *
    FROM internal.historical_backfill_campaigns
    WHERE status IN ('PLANNED','RUNNING','PAUSED')
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    SELECT count(*),
           count(*) FILTER (WHERE b.status='SUCCEEDED'),
           count(*) FILTER (WHERE b.status IN ('FAILED','DEAD_LETTER')),
           count(*) FILTER (WHERE b.status IN ('QUEUED','RUNNING','RETRYABLE','RETRYING')),
           coalesce(sum(b.requests_used),0),
           max(b.updated_at) FILTER (WHERE b.status='SUCCEEDED')
    INTO v_total_jobs, v_succeeded_jobs, v_terminal_failed_jobs, v_open_jobs, v_requests_used, v_last_success_at
    FROM internal.backfill_jobs b
    WHERE b.historical_campaign_id = c.campaign_id;

    v_watermark := jsonb_build_object(
      'last_successful_job_at', v_last_success_at,
      'succeeded_jobs', v_succeeded_jobs,
      'terminal_failed_jobs', v_terminal_failed_jobs,
      'open_jobs', v_open_jobs,
      'total_jobs', v_total_jobs
    );

    v_new_status := c.status;
    IF v_total_jobs > 0 AND v_open_jobs = 0 THEN
      IF v_terminal_failed_jobs = 0 AND v_succeeded_jobs = v_total_jobs THEN
        v_new_status := 'COMPLETED';
      ELSIF v_terminal_failed_jobs > 0 THEN
        v_new_status := 'FAILED';
      END IF;
    ELSIF c.status = 'PLANNED' AND now() >= c.planned_start_at THEN
      v_new_status := 'RUNNING';
    END IF;

    UPDATE internal.historical_backfill_campaigns
    SET requests_used = v_requests_used,
        last_successful_watermark = v_watermark,
        status = v_new_status,
        updated_at = CASE
          WHEN updated_at < coalesce(v_last_success_at, updated_at) THEN coalesce(v_last_success_at, now())
          ELSE now()
        END
    WHERE campaign_id = c.campaign_id;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION internal.sync_historical_campaign_state() IS
'P0 Group 10: reconcile historical campaign parent control state from child backfill execution. Keeps request totals/watermark/status synchronized without redefining completeness semantics.';

SELECT cron.alter_job(
  job_id := 25,
  command := $$select internal.ensure_provider_quota_snapshot(); select internal.allocate_backfill_budget(); select internal.sync_historical_campaign_state();$$
);
