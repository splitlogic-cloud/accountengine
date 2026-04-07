import type { Result, ClassificationResult, Transaction, TaxTreatment } from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// Tax classifier — deterministic first, AI fallback for ambiguous cases
// ---------------------------------------------------------------------------

export interface TaxInput {
  amount:              number
  currency:            string
  transaction_type:    string
  customer_country:    string | null
  customer_type:       'b2b' | 'b2c' | 'unknown'
  customer_vat_number: string | null
  source:              string
  description?:        string | null
  company_country:     string
}

export interface TaxResult {
  treatment:    TaxTreatment
  vat_rate:     number
  vat_amount:   number
  taxable:      number
  jurisdiction: string | null
  scheme:       'standard' | 'oss' | 'reverse_charge' | 'none' | null
  confidence:   number
  reasoning:    string
  classified_by:'rule' | 'ai'
}

// EU VAT standard rates 2024
export const EU_VAT_RATES: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22,
  ES: 21, FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23,
  IT: 22, LT: 21, LU: 17, LV: 21, MT: 18, NL: 21, PL: 23, PT: 23,
  RO: 19, SE: 25, SI: 22, SK: 20, EL: 24,
}

const EU_COUNTRIES  = new Set(Object.keys(EU_VAT_RATES))
const EEA_NON_EU    = new Set(['NO', 'IS', 'LI'])

export function classifyTaxDeterministic(input: TaxInput): TaxResult | null {
  const { customer_country, customer_type, customer_vat_number, transaction_type } = input
  const normalizedType = transaction_type.toLowerCase()
  const absAmount = Math.abs(input.amount)

  // Non-taxable transaction types
  if (['payout', 'transfer', 'fee', 'adjustment', 'chargeback'].includes(normalizedType)) {
    return {
      treatment: 'outside_scope', vat_rate: 0, vat_amount: 0, taxable: 0,
      jurisdiction: customer_country?.toUpperCase() ?? input.company_country.toUpperCase(),
      scheme: 'none', confidence: 100, classified_by: 'rule',
      reasoning: `${normalizedType} är inte momspliktigt`,
    }
  }

  if (!['sale', 'refund'].includes(normalizedType)) return null

  const country  = (customer_country ?? input.company_country).toUpperCase()
  const isEU     = EU_COUNTRIES.has(country)
  const isSE     = country === 'SE'
  const hasVatNr = !!(customer_vat_number?.trim())
  const isB2B    = customer_type === 'b2b' || (hasVatNr && customer_type !== 'b2c')

  if (isSE) {
    const rate   = 25
    const vatAmt = round2(absAmount * rate / (100 + rate))
    return {
      treatment: 'domestic_vat', vat_rate: rate, vat_amount: vatAmt, taxable: round2(absAmount - vatAmt),
      jurisdiction: 'SE', scheme: 'standard', confidence: 100, classified_by: 'rule',
      reasoning: 'Svensk kund → SE moms 25%',
    }
  }

  if (isEU && isB2B && hasVatNr) {
    return {
      treatment: 'eu_b2b_reverse_charge', vat_rate: 0, vat_amount: 0, taxable: absAmount,
      jurisdiction: country, scheme: 'reverse_charge', confidence: 100, classified_by: 'rule',
      reasoning: 'EU B2B med VAT-nr → omvänd skattskyldighet',
    }
  }

  if (isEU) {
    const rate   = EU_VAT_RATES[country] ?? 20
    const vatAmt = round2(absAmount * rate / (100 + rate))
    const conf   = customer_type === 'b2c' ? 95 : 80
    return {
      treatment: 'eu_oss', vat_rate: rate, vat_amount: vatAmt, taxable: round2(absAmount - vatAmt),
      jurisdiction: country, scheme: 'oss', confidence: conf, classified_by: 'rule',
      reasoning: `EU OSS → ${country} ${rate}%`,
    }
  }

  if (EEA_NON_EU.has(country)) {
    return {
      treatment: 'export_outside_eu', vat_rate: 0, vat_amount: 0, taxable: absAmount,
      jurisdiction: country, scheme: 'none', confidence: 100, classified_by: 'rule',
      reasoning: `${country} (EEA ej EU) → export 0%`,
    }
  }

  return {
    treatment: 'export_outside_eu', vat_rate: 0, vat_amount: 0, taxable: absAmount,
    jurisdiction: country, scheme: 'none', confidence: 100, classified_by: 'rule',
    reasoning: `${country} utanför EU → export 0%`,
  }
}

function round2(n: number) { return Math.round(n * 100) / 100 }

export function getOSSAccounts() {
  return { revenue: '3109', vat: '2614' }
}

export function getDomesticVATAccounts(vatRate: number) {
  if (vatRate === 12) return { revenue: '3011', vat: '2620' }
  if (vatRate === 6)  return { revenue: '3012', vat: '2630' }
  return { revenue: '3010', vat: '2610' }
}

export function getExportAccounts() {
  return { revenue: '3106', vat: null }
}

export function getReverseChargeAccounts() {
  return { revenue: '3108', vat: null }
}

// Classify with AI fallback for ambiguous cases
export async function classifyTaxWithAI(input: TaxInput): Promise<TaxResult> {
  // First try deterministic
  const det = classifyTaxDeterministic(input)
  if (det && det.confidence >= 90) return det

  // For low/medium confidence, use Claude
  try {
    const { Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()

    const msg = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Klassificera momsbehandling för denna transaktion enligt svenska momsregler och EU OSS.
Svara ENDAST med JSON: {"treatment": "...", "vat_rate": 0, "reason": "..."}

Transaktion:
- Belopp: ${input.amount} ${input.currency}
- Kundland: ${input.customer_country ?? 'okänt'}
- Kundtyp: ${input.customer_type}
- VAT-nummer: ${input.customer_vat_number ?? 'saknas'}
- Transaktionstyp: ${input.transaction_type}
- Källa: ${input.source}

Möjliga behandlingar: domestic_vat, eu_oss, eu_b2b_reverse_charge, export_outside_eu, outside_scope, unknown`,
      }],
    })

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const parsed = JSON.parse(text.replace(/```json?|```/g, '').trim())
    const rate   = parsed.vat_rate ?? 0
    const vatAmt = rate > 0 ? round2(input.amount * rate / (100 + rate)) : 0

    return {
      treatment:    parsed.treatment ?? 'unknown',
      vat_rate:     rate,
      vat_amount:   vatAmt,
      taxable:      round2(Math.abs(input.amount) - vatAmt),
      jurisdiction: input.customer_country ?? input.company_country,
      scheme:       parsed.treatment === 'eu_oss' ? 'oss' :
                    parsed.treatment === 'eu_b2b_reverse_charge' ? 'reverse_charge' :
                    parsed.treatment === 'outside_scope' ? 'none' : 'standard',
      confidence:   75,
      reasoning:    parsed.reason ?? 'AI-klassificering',
      classified_by:'ai',
    }
  } catch {
    return det ?? {
      treatment: 'unknown', vat_rate: 0, vat_amount: 0, taxable: Math.abs(input.amount),
      jurisdiction: input.customer_country ?? input.company_country,
      scheme: null, confidence: 40, reasoning: 'Klassificering misslyckades', classified_by: 'ai',
    }
  }
}

export async function classifyTransaction(
  tx: Pick<Transaction, 'amount' | 'currency' | 'transaction_type' | 'customer_country' | 'customer_type' | 'customer_vat_number' | 'source' | 'description'>,
  companyCountry: string,
): Promise<Result<ClassificationResult>> {
  try {
    const baseInput: TaxInput = {
      amount: tx.amount,
      currency: tx.currency,
      transaction_type: tx.transaction_type,
      customer_country: tx.customer_country,
      customer_type: tx.customer_type,
      customer_vat_number: tx.customer_vat_number,
      source: tx.source,
      description: tx.description,
      company_country: companyCountry,
    }
    const result = classifyTaxDeterministic(baseInput) ?? await classifyTaxWithAI(baseInput)
    return ok({
      treatment: result.treatment as ClassificationResult['treatment'],
      vat_rate: result.vat_rate,
      vat_amount: result.vat_amount,
      taxable: result.taxable,
      jurisdiction: result.jurisdiction,
      scheme: result.scheme,
      confidence: result.confidence,
      reasoning: result.reasoning,
      classified_by: result.classified_by,
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
