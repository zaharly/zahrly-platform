from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from training.archive_oos import run_historical_training_with_recovery as recovery
from workers.prediction_engine import historical_training_job
from workers.prediction_engine.archive_payload_adapters import walk_fixture_rows


def _load_payload_candidates(client, bucket, key, expected_checksum):
    current = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    current_checksum = hashlib.sha256(current).hexdigest()
    current_rows = list(walk_fixture_rows(current))
    if current_checksum == expected_checksum and current_rows:
        return current, current_rows, "CURRENT"

    version_error = None
    try:
        paginator = client.get_paginator("list_object_versions")
        versions = []
        for page in paginator.paginate(Bucket=bucket, Prefix=key, MaxKeys=1000):
            versions.extend(v for v in page.get("Versions", []) if v.get("Key") == key)
        for version in sorted(
            versions,
            key=lambda item: item.get("LastModified") or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        ):
            version_id = version.get("VersionId")
            if not version_id or version.get("IsLatest"):
                continue
            try:
                candidate = client.get_object(Bucket=bucket, Key=key, VersionId=version_id)["Body"].read()
                rows = list(walk_fixture_rows(candidate))
            except Exception:
                continue
            if rows:
                digest = hashlib.sha256(candidate).hexdigest()
                print(json.dumps({"archive_payload_recovery": {
                    "key": key,
                    "status": "RECOVERED_S3_VERSION",
                    "version_id": version_id,
                    "current_checksum": current_checksum,
                    "catalog_checksum": expected_checksum,
                    "version_checksum": digest,
                    "parsed_rows": len(rows),
                }}, sort_keys=True), flush=True)
                return candidate, rows, version_id
    except Exception as exc:
        version_error = type(exc).__name__

    marker = "/dataset=fixtures/"
    sibling_prefix = key.split(marker, 1)[0] + marker if marker in key else key.rsplit("/", 1)[0] + "/"

    objects = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=sibling_prefix, MaxKeys=1000):
        objects.extend(page.get("Contents", []))

    recovered = []
    for item in objects:
        candidate_key = item.get("Key")
        if not candidate_key or candidate_key == key or not candidate_key.endswith(".json"):
            continue
        try:
            candidate = client.get_object(Bucket=bucket, Key=candidate_key)["Body"].read()
            rows = list(walk_fixture_rows(candidate))
        except Exception:
            continue
        if rows:
            recovered.append((len(rows), item.get("LastModified"), candidate_key, candidate, rows))

    if recovered:
        recovered.sort(key=lambda item: (item[0], item[1] or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
        row_count, _, candidate_key, candidate, rows = recovered[0]
        digest = hashlib.sha256(candidate).hexdigest()
        print(json.dumps({"archive_payload_recovery": {
            "key": key,
            "status": "RECOVERED_S3_SIBLING",
            "candidate_key": candidate_key,
            "current_checksum": current_checksum,
            "catalog_checksum": expected_checksum,
            "candidate_checksum": digest,
            "parsed_rows": row_count,
            "version_probe_error": version_error,
        }}, sort_keys=True), flush=True)
        return candidate, rows, f"SIBLING:{candidate_key}"

    raise RuntimeError(
        f"historical archive payload unavailable:no-usable-version-or-sibling:{key}:version_probe={version_error}"
    )


recovery._load_payload_candidates = _load_payload_candidates

if __name__ == "__main__":
    historical_training_job.main()
