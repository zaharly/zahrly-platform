# Isolated execution contract

1. Input source: `internal.archive_catalog` metadata and the S3 objects referenced by `object_uri`.
2. Integrity: every downloaded object is SHA-256 checked against the catalog checksum.
3. Eligibility: only complete archived seasons count toward the OOS minimum.
4. Default gate: 3 complete seasons and at least 3,000 fixture-like rows.
5. Isolation: the runner has no code path that writes to campaign, queue, fixture, prediction, model registry, baseline, evidence, market-state, or read-model tables.
6. Production promotion is deliberately outside this runner.
