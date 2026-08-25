const providerSeasonHandler = require('../../api/provider-season.js')

exports.handler = async (event) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
  )

  const req = {
    method: event.httpMethod || 'GET',
    body: event.body ? JSON.parse(event.body) : undefined,
    headers,
  }

  let statusCode = 200
  let responseHeaders = { 'content-type': 'application/json' }
  let responseBody = ''

  const res = {
    status(code) {
      statusCode = code
      return res
    },
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value
      return res
    },
    json(body) {
      responseBody = JSON.stringify(body)
      return res
    },
  }

  try {
    await providerSeasonHandler(req, res)
    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody,
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: 'provider_season_function_error',
        detail: error instanceof Error ? error.message : String(error),
      }),
    }
  }
}
