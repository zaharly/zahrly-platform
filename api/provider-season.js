const json = (res, status, body) => {
  res.status(status).setHeader('content-type', 'application/json').json(body)
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed', allowed: ['POST'] })

  const season = Number(req.body?.season)
  if (!Number.isInteger(season) || season < 1900 || season > 2100) {
    return json(res, 400, { error: 'invalid_season' })
  }

  const githubToken = process.env.GITHUB_ACTIONS_TOKEN?.trim()
  const authorization = req.headers.authorization

  if (!githubToken) return json(res, 500, { error: 'provider_season_trigger_not_configured' })

  // The dashboard currently has no user-auth session contract in its React shell.
  // Keep the trigger server-side and use the repository-scoped GitHub token only here.
  // Season is strictly validated above and the downstream workflow remains the policy boundary.
  if (!authorization) {
    return json(res, 401, { error: 'admin_authorization_required' })
  }

  const dispatch = await fetch(
    'https://api.github.com/repos/zaharly/zahrly-platform/actions/workflows/provider-quota-gateway.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { season: String(season) } }),
    },
  )

  if (!dispatch.ok) {
    const detail = await dispatch.text().catch(() => '')
    return json(res, 502, { error: 'github_workflow_dispatch_failed', detail })
  }

  return json(res, 202, { accepted: true, season, workflow: 'provider-worker-ci' })
}
