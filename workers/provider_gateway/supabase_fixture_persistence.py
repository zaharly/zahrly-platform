from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


def persist_fixture(fixture: dict[str, object]) -> dict[str, object]:
    url = os.environ.get("PROVIDER_FIXTURE_PERSISTENCE_URL")
    secret = os.environ.get("PROVIDER_GATEWAY_SECRET")
    if not url or not secret:
        raise RuntimeError("fixture persistence credentials not configured")

    body = json.dumps({"fixture": fixture}).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-provider-gateway-secret": secret.strip(),
        },
    )
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get("persisted") is not True:
        raise RuntimeError(f"fixture persistence failed: {result}")
    return result
