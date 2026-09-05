CREATE OR REPLACE FUNCTION public.prediction_training_archive_catalog()
RETURNS TABLE(
  manifest_id uuid,
  season integer,
  dataset_type text,
  object_uri text,
  checksum text,
  row_count bigint,
  completeness_score numeric,
  schema_version text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'internal', 'pg_catalog'
AS $function$
  SELECT
    a.manifest_id,
    a.season,
    a.dataset_type,
    a.object_uri,
    a.checksum,
    a.row_count,
    a.completeness_score,
    a.schema_version
  FROM internal.archive_catalog a
  WHERE a.provider = 'api-football'
    AND NOT EXISTS (
      SELECT 1
      FROM internal.historical_backfill_campaigns c
      WHERE upper(trim(c.status)) = 'RUNNING'
        AND a.season BETWEEN c.target_start_season AND c.target_end_season
    )
  ORDER BY a.season ASC, a.dataset_type ASC, a.created_at ASC;
$function$;
