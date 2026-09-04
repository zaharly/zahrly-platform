from __future__ import annotations

import hashlib
import json
from datetime import datetime

from .archive_payload_adapters import walk_fixture_rows


def load_with_s3_version_recovery(client, bucket: str, key: str, expected_checksum: str):
    current = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    actual = hashlib.sha256(current).hexdigest()
    if actual != expected_checksum:
        raise RuntimeError(f"archive checksum mismatch for current object:{key}")
    rows = list(walk_fixture_rows(current))
    if rows:
        return current, rows, "CURRENT"
    try:
        versions = client.list_object_versions(Bucket=bucket, Key=key).get("Versions", [])
    except Exception as exc:
        print(json.dumps({"archive_payload_recovery": {"key": key, "status": "VERSION_LOOKUP_UNAVAILABLE", "error": type(exc).__name__}}, sort_keys=True), flush=True)
        return current, rows, "CURRENT"
    versions = sorted(versions, key=lambda v: (v.get("LastModified") or datetime.min), reverse=True)
    for version in versions:
        version_id = version.get("VersionId")
        if not version_id or version.get("IsLatest"):
            continue
        try:
            candidate = client.get_object(Bucket=bucket, Key=key, VersionId=version_id)["Body"].read()
            parsed = list(walk_fixture_rows(candidate))
        except Exception:
            continue
        if parsed:
            digest = hashlib.sha256(candidate).hexdigest()
            print(json.dumps({"archive_payload_recovery": {"key": key, "status": "RECOVERED_S3_VERSION", "version_id": version_id, "catalog_checksum": expected_checksum, "version_checksum": digest, "parsed_rows": len(parsed)}}, sort_keys=True), flush=True)
            return candidate, parsed, version_id
    return current, rows, "CURRENT"
