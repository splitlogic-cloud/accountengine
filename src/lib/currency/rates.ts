import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import type { CurrencyRate, Result } from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// ECB Free API — daily reference rates
// Published weekdays at ~16:00 CET. No API key required.
// ---------------------------------------------------------------------------
const ECB_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D..SEK.SP00.A?format=jsondata&lastNObservations=1'

interface EcbResponse {
  dataSets: Array<{
    series: Record<string, {
      observations: Record<string, [number]>
    }>
  }>
  structure: {
    dimensions: {
      series: Array<{
        id: string
        values: Array<{ id: string; name: string }>
      }>
    }
  }
}

export class CurrencyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'CurrencyError'
  }
}

// ---------------------------------------------------------------------------
// fetchAndStoreECBRates
// Fetches latest ECB rates and upserts into currency_rates.
// Called daily by Inngest cron job.
// ---------------------------------------------------------------------------
export async function fetchAndStoreECBRates(): Promise<Result<number, CurrencyError>> {
  const supabase = createServiceClient()

  let data: EcbResponse
  try {
    const response = await fetch(ECB_URL, {
      headers: { 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      return err(new CurrencyError(
        `ECB API returned ${response.status}: ${response.statusText}`,
        'ECB_HTTP_ERROR',
      ))
    }

    data = await response.json() as EcbResponse
  } catch (e) {
    return err(new CurrencyError(
      `Failed to fetch ECB rates: ${e instanceof Error ? e.message : String(e)}`,
      'ECB_FETCH_ERROR',
    ))
  }

  // Parse response structure
  const currencyDimension = data.structure.dimensions.series.find(d => d.id === 'CURRENCY')
  if (!currencyDimension) {
    return err(new CurrencyError('Unexpected ECB response structure.', 'ECB_PARSE_ERROR'))
  }

  const today  = new Date().toISOString().split('T')[0]!
  const rates: Array<{
    rate_date:     string
    from_currency: string
    to_currency:   string
    rate:          number
    source:        string
  }> = []

  // ECB rates are quoted as USD/EUR/etc per SEK (inverse), so we need to invert
  // Actually ECB gives SEK per foreign currency, which is what we want
  for (const [seriesKey, seriesData] of Object.entries(data.dataSets[0]?.series ?? {})) {
    const seriesIdx  = parseInt(seriesKey.split(':')[0]!)
    const currency   = currencyDimension.values[seriesIdx]?.id

    if (!currency || currency === 'SEK') continue

    const obsValues = Object.values(seriesData.observations)
    const lastObs   = obsValues[obsValues.length - 1]
    const rate      = lastObs?.[0]

    if (!rate || isNaN(rate) || rate <= 0) continue

    rates.push({
      rate_date:     today,
      from_currency: currency,
      to_currency:   'SEK',
      rate,
      source:        'ecb',
    })
  }

  if (rates.length === 0) {
    return err(new CurrencyError('No valid rates parsed from ECB response.', 'ECB_NO_RATES'))
  }

  // Upsert all rates
  const { error } = await supabase
    .from('currency_rates')
    .upsert(rates, { onConflict: 'rate_date,from_currency,to_currency' })

  if (error) {
    return err(new CurrencyError(
      `Failed to store currency rates: ${error.message}`,
      'DB_ERROR',
    ))
  }

  return ok(rates.length)
}

// ---------------------------------------------------------------------------
// convertToSEK
// Converts an amount from a foreign currency to SEK using the closest
// available rate on or before the given date.
// ---------------------------------------------------------------------------
export async function convertToSEK(
  amount:       number,
  fromCurrency: string,
  date:         string,
): Promise<Result<{ amount_sek: number; rate: number; rate_id: string }, CurrencyError>> {
  if (fromCurrency === 'SEK') {
    return ok({ amount_sek: amount, rate: 1.0, rate_id: '' })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('currency_rates')
    .select('id, rate')
    .eq('from_currency', fromCurrency)
    .eq('to_currency', 'SEK')
    .lte('rate_date', date)
    .order('rate_date', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return err(new CurrencyError(
      `No exchange rate found for ${fromCurrency}→SEK on or before ${date}.`,
      'RATE_NOT_FOUND',
    ))
  }

  const amount_sek = Math.round(amount * data.rate * 100) / 100

  return ok({ amount_sek, rate: data.rate, rate_id: data.id })
}

// ---------------------------------------------------------------------------
// Inngest: daily ECB rate fetch
// ---------------------------------------------------------------------------
export { fetchAndStoreECBRates as ecbDailyFetch }
