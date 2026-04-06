import 'server-only'

import Stripe from 'stripe'
import { createHash } from 'crypto'
import { convertToSEK } from '@/lib/currency/rates'
import type { Company } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizedTransaction {
  company_id:          string
  source:              'stripe'
  external_id:         string
  external_ref:        string | null
  fingerprint:         string
  transaction_type:    'sale' | 'refund' | 'fee' | 'payout' | 'chargeback' | 'adjustment'
  amount:              number
  currency:            string
  amount_sek:          number | null
  exchange_rate:       number | null
  transaction_date:    string
  description:         string
  counterpart_name:    string | null
  counterpart_ref:     string | null
  customer_country:    string | null
  customer_type:       'b2b' | 'b2c' | 'unknown'
  customer_vat_number: string | null
  status:              'unprocessed'
  raw_data:            Record<string, unknown>
}

interface ConnectorConfig {
  from_date: string
  to_date:   string
}

// ---------------------------------------------------------------------------
// normalizeTransactions
// Entry point called by the import pipeline.
// Fetches all Stripe events in date range and normalises them.
// ---------------------------------------------------------------------------
export async function normalizeTransactions(
  company:     Company,
  credentials: Record<string, unknown>,
  config:      Record<string, unknown>,
  dateRange:   ConnectorConfig,
): Promise<NormalizedTransaction[]> {
  const apiKey = credentials['secret_key'] as string
  if (!apiKey) throw new Error('Stripe secret_key not found in integration credentials.')

  const stripe = new Stripe(apiKey, {
    apiVersion: '2025-02-24.acacia',
    maxNetworkRetries: 3,
    timeout: 30_000,
  })

  const fromTs = Math.floor(new Date(dateRange.from_date).getTime() / 1000)
  const toTs   = Math.floor(new Date(dateRange.to_date + 'T23:59:59Z').getTime() / 1000)

  const results: NormalizedTransaction[] = []

  // Fetch balance transactions (the authoritative source for all money movements)
  for await (const balanceTx of stripe.balanceTransactions.list({
    created: { gte: fromTs, lte: toTs },
    limit:   100,
    expand:  ['data.source'],
  })) {
    const normalized = await normalizeBalanceTx(balanceTx, company)
    if (normalized) results.push(normalized)
  }

  return results
}

// ---------------------------------------------------------------------------
// normalizeBalanceTx
// Maps a single Stripe BalanceTransaction to our internal format.
// ---------------------------------------------------------------------------
async function normalizeBalanceTx(
  bTx:     Stripe.BalanceTransaction,
  company: Company,
): Promise<NormalizedTransaction | null> {
  const txDate = new Date(bTx.created * 1000).toISOString().split('T')[0]!

  // Convert to SEK if needed
  const currency     = bTx.currency.toUpperCase()
  const amountRaw    = bTx.amount / 100   // Stripe amounts are in öre/cents
  let   amount_sek   = null
  let   exchange_rate = null

  if (currency !== company.currency) {
    const convResult = await convertToSEK(amountRaw, currency, txDate)
    if (convResult.ok) {
      amount_sek    = convResult.value.amount_sek
      exchange_rate = convResult.value.rate
    }
  } else {
    amount_sek = amountRaw
  }

  const source = bTx.source
  let externalRef: string | null = null
  let customerCountry: string | null = null
  let customerType: 'b2b' | 'b2c' | 'unknown' = 'unknown'
  let customerVatNumber: string | null = null
  let counterpartName: string | null = null
  let txType: NormalizedTransaction['transaction_type'] = 'adjustment'
  let description = bTx.description ?? bTx.type

  switch (bTx.type) {
    case 'charge': {
      txType = 'sale'
      const charge = source as Stripe.Charge
      externalRef    = charge.payment_intent as string | null
      counterpartName = charge.billing_details?.name ?? null
      description    = charge.description ?? `Stripe charge ${charge.id}`

      // Extract customer metadata
      if (typeof source === 'object' && source !== null) {
        const billingAddr = charge.billing_details?.address
        customerCountry   = billingAddr?.country ?? null

        // Check for VAT number in metadata
        const meta = charge.metadata ?? {}
        customerVatNumber = meta['vat_number'] ?? meta['tax_id'] ?? null

        // Determine B2B vs B2C
        if (customerVatNumber) {
          customerType = 'b2b'
        } else if (meta['customer_type']) {
          customerType = (meta['customer_type'] as 'b2b' | 'b2c') || 'unknown'
        }
      }
      break
    }

    case 'refund': {
      txType = 'refund'
      const refund = source as Stripe.Refund
      description  = `Återbetalning ${refund.id}`
      // Refunds are negative amounts
      break
    }

    case 'stripe_fee':
    case 'application_fee': {
      txType      = 'fee'
      description = 'Stripe-avgift'
      break
    }

    case 'payout': {
      txType = 'payout'
      const payout = source as Stripe.Payout
      externalRef  = payout.id
      description  = payout.description ?? `Utbetalning ${payout.id}`
      break
    }

    case 'adjustment':
    case 'transfer':
    default: {
      if ((bTx.type as string) === 'dispute') {
        txType      = 'chargeback'
        description = `Tvist (chargeback) ${bTx.id}`
        break
      }
      txType = 'adjustment'
      break
    }
  }

  // Generate deterministic fingerprint for deduplication
  const fingerprint = createHash('sha256')
    .update(`${company.id}:stripe:${bTx.id}:${bTx.created}:${bTx.amount}:${currency}`)
    .digest('hex')

  return {
    company_id:          company.id,
    source:              'stripe',
    external_id:         bTx.id,
    external_ref:        externalRef,
    fingerprint,
    transaction_type:    txType,
    amount:              amountRaw,
    currency,
    amount_sek,
    exchange_rate,
    transaction_date:    txDate,
    description,
    counterpart_name:    counterpartName,
    counterpart_ref:     null,
    customer_country:    customerCountry,
    customer_type:       customerType,
    customer_vat_number: customerVatNumber,
    status:              'unprocessed',
    raw_data:            {
      id:          bTx.id,
      type:        bTx.type,
      amount:      bTx.amount,
      currency:    bTx.currency,
      created:     bTx.created,
      description: bTx.description,
    },
  }
}
