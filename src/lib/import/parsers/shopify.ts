// ---------------------------------------------------------------------------
// Shopify parser
// Supports:
//   1. Shopify Payments payouts CSV (from Payments → Payouts → Export)
//   2. Shopify Orders CSV (from Orders → Export)
//   3. Shopify Payouts JSON (from API)
// ---------------------------------------------------------------------------

import type { ParsedTransaction, ParseResult } from './stripe'

export function parseShopifyCSV(content: string, fileType: 'payouts' | 'orders' | 'auto' = 'auto'): ParseResult {
  const lines  = content.split('\n').filter(l => l.trim())
  const errors: string[] = []

  if (lines.length < 2) {
    return { ok: false, transactions: [], errors: ['Filen är tom.'], source: 'shopify', count: 0 }
  }

  const header = lines[0]!.toLowerCase().split(',').map(h =>
    h.replace(/"/g, '').trim().replace(/\s+/g, '_')
  )

  // Auto-detect file type
  const detectedType = fileType === 'auto'
    ? (header.includes('payout_id') || header.includes('payout_date') ? 'payouts' : 'orders')
    : fileType

  const transactions: ParsedTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue

    const values = line.split(',').map(v => v.replace(/"/g, '').trim())
    const row    = Object.fromEntries(header.map((h, j) => [h, values[j] ?? '']))

    if (detectedType === 'orders') {
      // Shopify Orders CSV
      const name        = row['name'] ?? row['order_id'] ?? `order_${i}`
      const totalPrice  = parseFloat(row['total'] ?? row['total_price'] ?? '0')
      const currency    = (row['currency'] ?? 'SEK').toUpperCase()
      const createdAt   = row['created_at'] ?? row['date'] ?? ''
      const financialStatus = row['financial_status'] ?? ''

      // Only import paid orders
      if (!['paid', 'partially_refunded'].includes(financialStatus.toLowerCase())) continue

      const billingCountry  = row['billing_country'] ?? row['billing_address_country'] ?? null
      const shippingCountry = row['shipping_country'] ?? row['shipping_address_country'] ?? null
      const country         = billingCountry || shippingCountry || null

      transactions.push({
        source_id:        `shopify_order_${name}`,
        source_ref:       name,
        event_type:       'shopify_order',
        occurred_at:      parseDate(createdAt),
        amount:           Math.abs(totalPrice),
        fee:              0,
        net:              Math.abs(totalPrice),
        currency,
        description:      `Shopify order ${name}`,
        customer_name:    [row['billing_name'], row['shipping_name']].find(Boolean) ?? undefined,
        customer_email:   row['email'] ?? undefined,
        customer_country: country ?? undefined,
        raw:              row,
      })

      // Refund rows
      if (financialStatus.toLowerCase() === 'partially_refunded') {
        const refundAmount = parseFloat(row['refunded_amount'] ?? '0')
        if (refundAmount > 0) {
          transactions.push({
            source_id:    `shopify_refund_${name}`,
            source_ref:   name,
            event_type:   'shopify_refund',
            occurred_at:  parseDate(createdAt),
            amount:       refundAmount,
            fee:          0,
            net:          refundAmount,
            currency,
            description:  `Shopify återbetalning ${name}`,
            raw:          row,
          })
        }
      }

    } else {
      // Shopify Payments Payout CSV
      const id        = row['id'] ?? row['payout_id'] ?? `payout_${i}`
      const type      = row['type'] ?? 'payout'
      const amount    = parseFloat(row['amount'] ?? row['net_amount'] ?? '0')
      const currency  = (row['currency'] ?? 'SEK').toUpperCase()
      const date      = row['payout_date'] ?? row['date'] ?? ''

      const eventType = type.toLowerCase().includes('refund') ? 'shopify_refund' :
                        type.toLowerCase().includes('fee')    ? 'stripe_fee' :
                        type.toLowerCase().includes('payout') ? 'shopify_payout' :
                        'shopify_order'

      transactions.push({
        source_id:   `shopify_${id}`,
        event_type:  eventType,
        occurred_at: parseDate(date),
        amount:      Math.abs(amount),
        fee:         parseFloat(row['fee'] ?? '0'),
        net:         amount,
        currency,
        description: row['description'] ?? `Shopify ${type}`,
        raw:         row,
      })
    }
  }

  return {
    ok:           transactions.length > 0,
    transactions,
    errors,
    source:       'shopify',
    count:        transactions.length,
  }
}

export function parseShopifyJSON(content: string): ParseResult {
  const errors: string[] = []
  let data: any

  try {
    data = JSON.parse(content)
  } catch {
    return { ok: false, transactions: [], errors: ['Ogiltig JSON.'], source: 'shopify', count: 0 }
  }

  // Handle both {orders: [...]} and direct array
  const orders: any[] = Array.isArray(data) ? data : (data.orders ?? data.payouts ?? [data])
  const transactions: ParsedTransaction[] = []

  for (const order of orders) {
    if (!order.id) continue

    const totalPrice = parseFloat(order.total_price ?? order.amount ?? '0')
    const currency   = (order.currency ?? 'SEK').toUpperCase()
    const country    = order.billing_address?.country_code
      ?? order.shipping_address?.country_code ?? null

    transactions.push({
      source_id:        `shopify_${order.id}`,
      source_ref:       order.order_number?.toString() ?? order.name,
      event_type:       'shopify_order',
      occurred_at:      order.processed_at ?? order.created_at ?? new Date().toISOString(),
      amount:           Math.abs(totalPrice),
      fee:              0,
      net:              Math.abs(totalPrice),
      currency,
      description:      `Shopify order ${order.name ?? order.id}`,
      customer_name:    order.customer ? `${order.customer.first_name ?? ''} ${order.customer.last_name ?? ''}`.trim() : undefined,
      customer_email:   order.customer?.email ?? order.email ?? undefined,
      customer_country: country ?? undefined,
      raw:              order,
    })
  }

  return { ok: true, transactions, errors, source: 'shopify', count: transactions.length }
}

function parseDate(val: string): string {
  if (!val) return new Date().toISOString()
  try {
    const d = new Date(val)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}
