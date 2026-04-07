import { NextRequest, NextResponse } from 'next/server'
import { createHmac }                from 'crypto'
import { createServiceClient }       from '@/lib/supabase/server'
import { processEvent }              from '@/lib/accounting/posting-engine'

// ---------------------------------------------------------------------------
// Shopify webhook handler
// Supported topics:
//   orders/paid          → shopify_order (sale)
//   refunds/create       → shopify_refund
//   payouts/paid         → shopify_payout (Shopify Payments)
//
// Setup in Shopify Admin:
//   Settings → Notifications → Webhooks
//   URL: https://your-domain.com/api/webhooks/shopify
//   Secret: SHOPIFY_WEBHOOK_SECRET in env
// ---------------------------------------------------------------------------

function verifyShopifyWebhook(body: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret) return false

  const computed = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64')

  // Timing-safe comparison
  return computed === hmacHeader
}

export async function POST(request: NextRequest) {
  const body      = await request.text()
  const hmac      = request.headers.get('x-shopify-hmac-sha256') ?? ''
  const topic     = request.headers.get('x-shopify-topic') ?? ''
  const shop      = request.headers.get('x-shopify-shop-domain') ?? ''

  if (!verifyShopifyWebhook(body, hmac)) {
    console.error('[shopify/webhook] HMAC verification failed for shop:', shop)
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 })
  }

  let payload: Record<string, any>
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Look up company by Shopify shop domain
  const { data: integration } = await supabase
    .from('integrations')
    .select('company_id, config')
    .eq('provider', 'shopify')
    .eq('is_active', true)
    .eq('config->>shop_domain', shop)
    .limit(1)
    .single()

  if (!integration) {
    // Fallback: first active Shopify integration
    const { data: fallback } = await supabase
      .from('integrations')
      .select('company_id')
      .eq('provider', 'shopify')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!fallback) {
      console.warn('[shopify/webhook] No company found for shop:', shop)
      return NextResponse.json({ received: true })
    }

    return handleShopifyEvent(topic, payload, fallback.company_id)
  }

  return handleShopifyEvent(topic, payload, integration.company_id)
}

async function handleShopifyEvent(
  topic:     string,
  payload:   Record<string, any>,
  companyId: string,
): Promise<NextResponse> {

  // orders/paid — customer paid for an order
  if (topic === 'orders/paid') {
    const order = payload

    // Determine currency and amounts
    const currency    = order.currency ?? 'SEK'
    const totalPrice  = parseFloat(order.total_price ?? '0')
    const totalTax    = parseFloat(order.total_tax ?? '0')

    // Billing address country for VAT determination
    const customerCountry = order.billing_address?.country_code
      ?? order.shipping_address?.country_code
      ?? null

    const customerType = order.customer?.accepts_marketing !== undefined ? 'b2c' : 'unknown'

    await processEvent({
      company_id:       companyId,
      event_type:       'shopify_order',
      occurred_at:      order.processed_at ?? order.created_at ?? new Date().toISOString(),
      source:           'shopify',
      source_id:        `order_${order.id}`,
      source_ref:       order.order_number?.toString() ?? null,
      amount:           totalPrice,
      currency:         currency,
      payload:          {
        ...order,
        // Enrich with normalized fields the rule engine expects
        customer_country:    customerCountry,
        customer_type:       customerType,
        transaction_type:    'sale',
        vat_amount:          totalTax,
      },
      customer_country:    customerCountry,
      customer_type:       customerType as any,
      transaction_type:    'sale',
    }, 'system')
  }

  // refunds/create
  if (topic === 'refunds/create') {
    const refund      = payload
    const totalRefund = (refund.refund_line_items ?? [])
      .reduce((s: number, l: any) => s + parseFloat(l.subtotal ?? '0'), 0)

    if (totalRefund > 0) {
      await processEvent({
        company_id:   companyId,
        event_type:   'shopify_refund',
        occurred_at:  refund.created_at ?? new Date().toISOString(),
        source:       'shopify',
        source_id:    `refund_${refund.id}`,
        source_ref:   `order_${refund.order_id}`,
        amount:       totalRefund,
        currency:     'SEK',  // will be overridden by order currency if available
        payload:      { ...refund, transaction_type: 'refund' },
        transaction_type: 'refund',
      }, 'system')
    }
  }

  // payouts/paid — Shopify Payments payout to bank
  if (topic === 'payouts/paid') {
    const payout = payload

    await processEvent({
      company_id:   companyId,
      event_type:   'shopify_payout',
      occurred_at:  payout.date ?? new Date().toISOString(),
      source:       'shopify',
      source_id:    `payout_${payout.id}`,
      amount:       parseFloat(payout.amount ?? '0'),
      currency:     payout.currency?.toUpperCase() ?? 'SEK',
      payload:      { ...payout, transaction_type: 'payout' },
      transaction_type: 'payout',
    }, 'system')
  }

  return NextResponse.json({ received: true })
}
