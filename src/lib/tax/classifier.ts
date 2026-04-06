import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import type {
  Transaction,
  TransactionTaxResult,
  TaxTreatment,
  ClassificationResult,
  Result,
} from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI',
  'FR','GR','HR','HU','IE','IT','LT','LU','LV','MT',
  'NL','PL','PT','RO','SE','SI','SK',
])

// Swedish standard VAT rates
const SE_VAT_RATES: Record<string, number> = {
  standard:   25,
  reduced:    12,
  low:         6,
  zero:        0,
}

// EU OSS rates by country (representative subset — full list in config)
const EU_OSS_RATES: Record<string, number> = {
  DE: 19, FR: 20, NL: 21, IT: 22, ES: 21,
  DK: 25, FI: 25, NO: 25, PL: 23, PT: 23,
  BE: 21, AT: 20, IE: 23, CZ: 21, RO: 19,
  HU: 27, HR: 25, BG: 20, EE: 22, LV: 21,
  LT: 21, SK: 20, SI: 22, LU: 17, CY: 19,
  MT: 18, GR: 24,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class TaxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'TaxError'
  }
}

interface TaxClassificationInput {
  amount:              number
  currency:            string
  transaction_type:    string
  customer_country:    string | null
  customer_type:       string
  customer_vat_number: string | null
  source:              string
  description:         string | null
  company_country:     string   // company's home country (SE for Swedish companies)
}

// ---------------------------------------------------------------------------
// Deterministic rule-based classifier
// Fast, free, no API calls. Handles the majority of cases.
// ---------------------------------------------------------------------------

export function classifyTaxDeterministic(
  input: TaxClassificationInput,
): ClassificationResult | null {
  const {
    customer_country,
    customer_type,
    customer_vat_number,
    company_country,
    transaction_type,
  } = input

  // Non-taxable transaction types — fees, payouts, transfers have no VAT
  if (['fee', 'payout', 'transfer', 'adjustment', 'chargeback'].includes(transaction_type)) {
    return {
      treatment:    'outside_scope',
      vat_rate:     null,
      vat_amount:   0,
      taxable:      0,
      jurisdiction: null,
      scheme:       'none',
      confidence:   100,
      reasoning:    `Transaktion av typen '${transaction_type}' är utanför momsens tillämpningsområde.`,
      classified_by: 'rule',
    }
  }

  // Must be a sale or refund to classify VAT
  if (!['sale', 'refund', 'subscription'].includes(transaction_type)) {
    return null  // Let AI handle it
  }

  const absAmount = Math.abs(input.amount)

  // Domestic (SE → SE)
  if (!customer_country || customer_country === company_country) {
    const vatRate   = SE_VAT_RATES.standard!
    const vatAmount = Math.round(absAmount * (vatRate / (100 + vatRate)) * 100) / 100
    return {
      treatment:    'domestic_vat',
      vat_rate:     vatRate,
      vat_amount:   vatAmount,
      taxable:      Math.round((absAmount - vatAmount) * 100) / 100,
      jurisdiction: company_country,
      scheme:       'standard',
      confidence:   100,
      reasoning:    `Inrikes försäljning ${company_country}→${customer_country ?? company_country}. Utgående moms ${vatRate}%.`,
      classified_by: 'rule',
    }
  }

  // Outside EU → export
  if (!EU_COUNTRIES.has(customer_country)) {
    return {
      treatment:    'export_outside_eu',
      vat_rate:     0,
      vat_amount:   0,
      taxable:      absAmount,
      jurisdiction: customer_country,
      scheme:       'none',
      confidence:   100,
      reasoning:    `Export till ${customer_country} utanför EU. Momsfri export, 0%.`,
      classified_by: 'rule',
    }
  }

  // EU country
  if (customer_type === 'b2b' && customer_vat_number) {
    // EU B2B with valid VAT number → reverse charge
    return {
      treatment:    'eu_b2b_reverse_charge',
      vat_rate:     0,
      vat_amount:   0,
      taxable:      absAmount,
      jurisdiction: customer_country,
      scheme:       'reverse_charge',
      confidence:   95,
      reasoning:    `EU B2B med VAT-nr ${customer_vat_number}. Omvänd skattskyldighet, köparen redovisar moms.`,
      classified_by: 'rule',
    }
  }

  if (customer_type === 'b2c' || customer_type === 'unknown') {
    // EU B2C → OSS
    const ossRate   = EU_OSS_RATES[customer_country] ?? 20
    const vatAmount = Math.round(absAmount * (ossRate / (100 + ossRate)) * 100) / 100
    return {
      treatment:    'eu_oss',
      vat_rate:     ossRate,
      vat_amount:   vatAmount,
      taxable:      Math.round((absAmount - vatAmount) * 100) / 100,
      jurisdiction: customer_country,
      scheme:       'oss',
      confidence:   customer_type === 'b2c' ? 98 : 75,
      reasoning:    `EU B2C i ${customer_country}. OSS-moms ${ossRate}%. ${customer_type === 'unknown' ? 'Kundtyp okänd — verifiera.' : ''}`,
      classified_by: 'rule',
    }
  }

  return null  // Cannot determine — fall through to AI
}

// ---------------------------------------------------------------------------
// AI classifier (Claude)
// Called when deterministic classifier cannot make a confident decision.
// Returns structured JSON via tool use.
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: 'classify_transaction',
  description: 'Klassificerar en transaktion för svensk momsredovisning',
  input_schema: {
    type: 'object' as const,
    properties: {
      tax_treatment: {
        type: 'string',
        enum: ['domestic_vat', 'eu_oss', 'eu_b2b_reverse_charge', 'export_outside_eu', 'outside_scope', 'exempt', 'unknown'],
        description: 'Momsbehandling för transaktionen',
      },
      vat_rate: {
        type: 'number',
        description: 'Momssats i procent (0, 6, 12 eller 25). Null om utanför scope.',
      },
      jurisdiction: {
        type: 'string',
        description: 'ISO 3166-1 alpha-2 landkod för var momsen ska redovisas.',
      },
      scheme: {
        type: 'string',
        enum: ['standard', 'oss', 'reverse_charge', 'none'],
      },
      confidence: {
        type: 'number',
        description: 'Konfidens 0–100. Under 70 = skickas till manuell granskning.',
      },
      reasoning: {
        type: 'string',
        description: 'Förklaring på svenska för varför denna klassificering valdes.',
      },
    },
    required: ['tax_treatment', 'confidence', 'reasoning'],
  },
}

export async function classifyTaxWithAI(
  tx: Transaction,
): Promise<Result<ClassificationResult, TaxError>> {
  const prompt = `
Du är en svensk redovisningsexpert specialiserad på momsfrågor.
Klassificera följande transaktion för momsredovisning.

TRANSAKTION:
- Typ: ${tx.transaction_type}
- Belopp: ${tx.amount} ${tx.currency}
- Källa: ${tx.source}
- Datum: ${tx.transaction_date}
- Motpart: ${tx.counterpart_name ?? 'okänd'}
- Beskrivning: ${tx.description ?? 'ingen'}
- Kundland: ${tx.customer_country ?? 'okänt'}
- Kundtyp: ${tx.customer_type}
- Kund VAT-nr: ${tx.customer_vat_number ?? 'saknas'}

REGLER ATT TILLÄMPA:
1. SE → SE B2C/B2B: domestic_vat 25% (standard), 12% eller 6% (reducerade varor)
2. SE → EU B2C: eu_oss med landets lokala momssats
3. SE → EU B2B med VAT-nr: eu_b2b_reverse_charge 0%
4. SE → Utanför EU: export_outside_eu 0%
5. Avgifter, payouts, transfers: outside_scope
6. Om kundtyp är okänd för EU-land: sänk konfidensen och ange eu_oss som troligast

Svara ENBART via verktyget classify_transaction.
`.trim()

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 512,
      tools:      [CLASSIFICATION_TOOL],
      tool_choice: { type: 'tool', name: 'classify_transaction' },
      messages:   [{ role: 'user', content: prompt }],
    })

    // Extract tool use block
    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return err(new TaxError(
        'AI did not return a tool use block.',
        'AI_NO_TOOL_USE',
      ))
    }

    const input = toolUse.input as {
      tax_treatment: TaxTreatment
      vat_rate?:     number
      jurisdiction?: string
      scheme?:       string
      confidence:    number
      reasoning:     string
    }

    const absAmount = Math.abs(tx.amount_sek ?? tx.amount)
    const vatRate   = input.vat_rate ?? 0
    const vatAmount = vatRate > 0
      ? Math.round(absAmount * (vatRate / (100 + vatRate)) * 100) / 100
      : 0

    return ok({
      treatment:    input.tax_treatment,
      vat_rate:     input.vat_rate ?? null,
      vat_amount:   vatAmount,
      taxable:      Math.round((absAmount - vatAmount) * 100) / 100,
      jurisdiction: input.jurisdiction ?? null,
      scheme:       (input.scheme as ClassificationResult['scheme']) ?? null,
      confidence:   input.confidence,
      reasoning:    input.reasoning,
      classified_by: 'ai',
    })
  } catch (e) {
    return err(new TaxError(
      `AI classification failed: ${e instanceof Error ? e.message : String(e)}`,
      'AI_ERROR',
    ))
  }
}

// ---------------------------------------------------------------------------
// classifyTransaction
// Main entry point: deterministic first, AI fallback.
// ---------------------------------------------------------------------------

export async function classifyTransaction(
  tx:            Transaction,
  companyCountry: string = 'SE',
): Promise<Result<ClassificationResult, TaxError>> {
  // 1. Try deterministic classification
  const input: TaxClassificationInput = {
    amount:              tx.amount,
    currency:            tx.currency,
    transaction_type:    tx.transaction_type,
    customer_country:    tx.customer_country,
    customer_type:       tx.customer_type,
    customer_vat_number: tx.customer_vat_number,
    source:              tx.source,
    description:         tx.description,
    company_country:     companyCountry,
  }

  const deterministicResult = classifyTaxDeterministic(input)
  if (deterministicResult && deterministicResult.confidence >= 90) {
    return ok(deterministicResult)
  }

  // 2. AI fallback for uncertain or unknown cases
  const aiResult = await classifyTaxWithAI(tx)
  if (!aiResult.ok) {
    // If AI fails and we have a deterministic result with lower confidence, use it
    if (deterministicResult) {
      return ok({
        ...deterministicResult,
        confidence: deterministicResult.confidence * 0.7,  // penalise confidence
        reasoning:  `${deterministicResult.reasoning} (AI-klassificering misslyckades, lägre konfidens.)`,
      })
    }
    return aiResult
  }

  return aiResult
}
