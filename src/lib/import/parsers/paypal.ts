// ---------------------------------------------------------------------------
// PayPal CSV parser
// Supports: PayPal Activity Download (CSV)
// Download from: Activity → All Transactions → Download
// ---------------------------------------------------------------------------

import type { ParsedTransaction, ParseResult } from './stripe'

export function parsePayPalCSV(content: string): ParseResult {
  const errors: string[] = []

  // PayPal CSV uses comma-separated with quoted fields
  // Headers vary by locale — handle Swedish and English
  const lines = content.split('\n').filter(l => l.trim())

  if (lines.length < 2) {
    return { ok: false, transactions: [], errors: ['Filen är tom.'], source: 'paypal', count: 0 }
  }

  // Detect encoding — PayPal exports sometimes have BOM
  const firstLine = lines[0]!.replace(/^\uFEFF/, '')
  const header    = parseCSVLine(firstLine).map(h =>
    h.toLowerCase()
      .replace(/["""]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
  )

  const transactions: ParsedTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row    = Object.fromEntries(header.map((h, j) => [h, (values[j] ?? '').replace(/["""]/g, '').trim()]))

    // PayPal column names (EN/SV variants)
    const date          = row['date'] ?? row['datum'] ?? ''
    const type          = row['type'] ?? row['transaktionstyp'] ?? row['typ'] ?? ''
    const name          = row['name'] ?? row['namn'] ?? ''
    const email         = row['from_email_address'] ?? row['email'] ?? row['epostadress'] ?? ''
    const gross         = row['gross'] ?? row['brutto'] ?? row['amount'] ?? row['belopp'] ?? '0'
    const fee           = row['fee'] ?? row['avgift'] ?? '0'
    const net           = row['net'] ?? row['netto'] ?? '0'
    const currency      = (row['currency'] ?? row['valuta'] ?? 'USD').toUpperCase()
    const transactionId = row['transaction_id'] ?? row['transaktions_id'] ?? row['id'] ?? `pp_${i}`
    const country       = row['country'] ?? row['land'] ?? null

    // Skip non-monetary rows
    if (!gross || type.toLowerCase().includes('authorization')) continue

    // Map PayPal transaction types
    const eventType = mapPayPalType(type)
    if (!eventType) continue

    const grossAmt = parsePayPalAmount(gross)
    const feeAmt   = Math.abs(parsePayPalAmount(fee))
    const netAmt   = parsePayPalAmount(net)

    if (grossAmt === 0) continue

    transactions.push({
      source_id:        transactionId,
      event_type:       eventType,
      occurred_at:      parsePayPalDate(date),
      amount:           Math.abs(grossAmt),
      fee:              feeAmt,
      net:              netAmt,
      currency,
      description:      `PayPal ${type}${name ? ` · ${name}` : ''}`,
      customer_name:    name || undefined,
      customer_email:   email || undefined,
      customer_country: country || undefined,
      raw:              row,
    })
  }

  if (transactions.length === 0 && errors.length === 0) {
    errors.push('Inga importerbara transaktioner hittades. Kontrollera att du exporterat Activity-rapporten från PayPal.')
  }

  return {
    ok:           transactions.length > 0,
    transactions,
    errors,
    source:       'paypal',
    count:        transactions.length,
  }
}

function mapPayPalType(type: string): string | null {
  const t = type.toLowerCase()

  // Swedish PayPal type names
  if (t.includes('betalning') || t.includes('payment') || t.includes('purchase') ||
      t.includes('köp') || t.includes('express checkout')) return 'paypal_payment'

  if (t.includes('återbet') || t.includes('refund') || t.includes('reversal'))
    return 'paypal_refund'

  if (t.includes('avgift') || t.includes('fee'))
    return 'paypal_fee'

  if (t.includes('överföring') || t.includes('transfer') || t.includes('withdrawal') ||
      t.includes('uttag'))
    return 'stripe_payout'  // use same treatment as payout

  if (t.includes('invoice'))
    return 'paypal_payment'

  if (t.includes('subscription') || t.includes('prenumeration'))
    return 'paypal_payment'

  return null
}

function parsePayPalAmount(val: string): number {
  // PayPal amounts: "1.234,56" (SV) or "1,234.56" (EN) or "-123.45"
  if (!val) return 0

  const clean = val
    .replace(/["""]/g, '')
    .replace(/\s/g, '')
    .trim()

  // Detect Swedish format (period as thousands separator, comma as decimal)
  if (/^\-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.')) || 0
  }

  // Standard format
  return parseFloat(clean.replace(/,/g, '')) || 0
}

function parsePayPalDate(val: string): string {
  if (!val) return new Date().toISOString()
  try {
    // PayPal formats: "3/15/2024", "15.03.2024", "2024-03-15"
    let d: Date

    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(val)) {
      // US format M/D/YYYY
      const [m, day, year] = val.split(/[/ ]/)
      d = new Date(`${year}-${(m ?? '1').padStart(2,'0')}-${(day ?? '1').padStart(2,'0')}`)
    } else if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(val)) {
      // EU format D.M.YYYY
      const [day, m, year] = val.split('.')
      d = new Date(`${year}-${(m ?? '1').padStart(2,'0')}-${(day ?? '1').padStart(2,'0')}`)
    } else {
      d = new Date(val)
    }

    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current  = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"' || ch === '\u201C' || ch === '\u201D') {
      inQuotes = !inQuotes
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
