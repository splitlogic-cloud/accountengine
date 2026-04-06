const FORTNOX_BASE = 'https://api.fortnox.se/3'
const FORTNOX_AUTH = 'https://apps.fortnox.se/oauth-v1'

export function getFortnoxAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.FORTNOX_CLIENT_ID!,
    redirect_uri:  process.env.FORTNOX_REDIRECT_URI!,
    scope:         'companyinformation voucher account customer supplier invoice',
    response_type: 'code',
    access_type:   'offline',
    state,
  })
  return `${FORTNOX_AUTH}/auth?${params}`
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(`${FORTNOX_AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      client_id:     process.env.FORTNOX_CLIENT_ID!,
      client_secret: process.env.FORTNOX_CLIENT_SECRET!,
      redirect_uri:  process.env.FORTNOX_REDIRECT_URI!,
    }),
  })
  if (!res.ok) throw new Error(`Fortnox token error: ${res.status}`)
  return res.json()
}

export async function refreshFortnoxToken(refreshToken: string) {
  const res = await fetch(`${FORTNOX_AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     process.env.FORTNOX_CLIENT_ID!,
      client_secret: process.env.FORTNOX_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) throw new Error(`Fortnox refresh error: ${res.status}`)
  return res.json()
}

// Generisk Fortnox API-anrop med automatisk token refresh
export async function fortnoxRequest<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${FORTNOX_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Fortnox API ${endpoint}: ${res.status} ${err}`)
  }
  return res.json()
}
