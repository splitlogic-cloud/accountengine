// ---------------------------------------------------------------------------
// Stripe CSV parser
// Supports: Balance history export from Stripe Dashboard
// Format: id, Type, Source, Amount, Fee, Net, Currency, Created (UTC), ...
// ---------------------------------------------------------------------------

export interface ParsedTransaction {
  source_id:         string
  source_ref?:       string
  event_type:        string
  occurred_at:       string
  amount:            number
  fee:               number
  net:               number
  currency:          string
  description:       string
  customer_name?:    string
  customer_email?:   string
  customer_country?: string
  raw:               Record<string, string>
}

export interface ParseResult {
  ok:           boolean
  transactions: ParsedTransaction[]
  errors:       string[]
  source:       string
  count:        number
}

export function parseStripeCSV(content: string): ParseResult {
  const lines   = content.split('\n').filter(l => l.trim())
  const errors: string[] = []

  if (lines.length < 2) {
    return { ok: false, transactions: [], errors: ['Filen är tom eller har fel format.'], source: 'stripe', count: 0 }
  }

  // Parse header — Stripe uses comma-separated with quoted fields
  const header = parseCSVLine(lines[0]!)
    .map(h => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))

  const transactions: ParsedTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row    = Object.fromEntries(header.map((h, j) => [h, values[j] ?? '']))

    // Stripe balance history columns vary by export type
    const id       = row['id'] ?? row['balance_transaction_id'] ?? `stripe_${i}`
    const type     = row['type'] ?? row['reporting_category'] ?? ''
    const amount   = parseStripeAmount(row['amount'] ?? row['gross'] ?? '0')
    const fee      = parseStripeAmount(row['fee'] ?? '0')
    const net      = parseStripeAmount(row['net'] ?? '0')
    const currency = (row['currency'] ?? row['presentment_currency'] ?? 'sek').toUpperCase()
    const created  = row['created_utc'] ?? row['created'] ?? row['date'] ?? ''
    const desc     = row['description'] ?? row['statement_descriptor'] ?? ''

    if (!id || !type) {
      errors.push(`Rad ${i + 1}: saknar id eller typ`)
      continue
    }

    const eventType = mapStripeType(type)
    if (!eventType) continue  // skip unknown/internal types

    transactions.push({
      source_id:    id,
      event_type:   eventType,
      occurred_at:  parseStripeDate(created),
      amount:       Math.abs(amount),
      fee:          Math.abs(fee),
      net:          net,
      currency:     currency,
      description:  desc,
      customer_name:    row['customer_name'] ?? row['customer_description'] ?? undefined,
      customer_email:   row['customer_email'] ?? undefined,
      customer_country: row['customer_address_country'] ?? undefined,
      raw:          row,
    })
  }

  return {
    ok:           errors.length === 0 || transactions.length > 0,
    transactions,
    errors,
    source:       'stripe',
    count:        transactions.length,
  }
}

function mapStripeType(type: string): string | null {
  const t = type.toLowerCase()
  if (t.includes('charge') || t.includes('payment'))   return 'stripe_charge'
  if (t.includes('refund'))                             return 'stripe_refund'
  if (t.includes('fee') || t.includes('stripe_fee'))   return 'stripe_fee'
  if (t.includes('payout') || t.includes('transfer'))  return 'stripe_payout'
  if (t.includes('adjustment'))                        return 'stripe_charge'
  return null
}

function parseStripeAmount(val: string): number {
  // Stripe exports amounts as "1,234.56" or "1234.56" or "-123.45"
  const clean = val.replace(/[,\s]/g, '').replace('€', '').replace('$', '').trim()
  return parseFloat(clean) || 0
}

function parseStripeDate(val: string): string {
  if (!val) return new Date().toISOString()
  try {
    // Stripe formats: "2024-03-15 14:22:08", "2024-03-15T14:22:08Z"
    const d = new Date(val.includes('T') ? val : val.replace(' ', 'T') + 'Z')
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}
