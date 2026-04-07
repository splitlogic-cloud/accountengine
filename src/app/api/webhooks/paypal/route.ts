import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient }       from '@/lib/supabase/server'
import { processEvent }              from '@/lib/accounting/posting-engine'

// ---------------------------------------------------------------------------
// PayPal webhook handler
// Supported event types:
//   PAYMENT.SALE.COMPLETED      → paypal_payment
//   PAYMENT.CAPTURE.COMPLETED   → paypal_payment
//   PAYMENT.SALE.REFUNDED       → paypal_refund
//   PAYMENT.CAPTURE.REFUNDED    → paypal_refund
//   INVOICING.INVOICE.PAID      → paypal_payment
//
// Setup in PayPal Developer Dashboard:
//   https://developer.paypal.com/dashboard/ → Webhooks
//   URL: https://your-domain.com/api/webhooks/paypal
//
// Env vars needed:
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_WEBHOOK_ID  (from PayPal dashboard after creating webhook)
// ---------------------------------------------------------------------------

async function verifyPayPalWebhook(
  request:    NextRequest,
  body:       string,
  payload:    Record<string, any>,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (!webhookId) {
    console.warn('[paypal/webhook] PAYPAL_WEBHOOK_ID not set — skipping verification in dev')
    return process.env.NODE_ENV === 'development'
  }

  try {
    // Get PayPal access token
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    })
    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token

    // Verify webhook signature
    const verifyRes = await fetch('https://api-m.paypal.com/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        transmission_id:   request.headers.get('paypal-transmission-id'),
        transmission_time: request.headers.get('paypal-transmission-time'),
        cert_url:          request.headers.get('paypal-cert-url'),
        auth_algo:         request.headers.get('paypal-auth-algo'),
        transmission_sig:  request.headers.get('paypal-transmission-sig'),
        webhook_id:        webhookId,
        webhook_event:     payload,
      }),
    })

    const verifyData = await verifyRes.json()
    return verifyData.verification_status === 'SUCCESS'
  } catch (err) {
    console.error('[paypal/webhook] Verification error:', err)
    return false
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()

  let payload: Record<string, any>
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Verify signature
  const isValid = await verifyPayPalWebhook(request, body, payload)
  if (!isValid) {
    console.error('[paypal/webhook] Signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const supabase   = createServiceClient()
  const eventType  = payload.event_type as string
  const resource   = payload.resource ?? {}

  // Look up company
  const { data: integration } = await supabase
    .from('integrations')
    .select('company_id')
    .eq('provider', 'paypal')
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!integration) {
    console.warn('[paypal/webhook] No active PayPal integration found')
    return NextResponse.json({ received: true })
  }

  const companyId = integration.company_id

  // PAYMENT.SALE.COMPLETED or PAYMENT.CAPTURE.COMPLETED
  if (['PAYMENT.SALE.COMPLETED', 'PAYMENT.CAPTURE.COMPLETED'].includes(eventType)) {
    const amount       = parseFloat(resource.amount?.value ?? resource.seller_receivable_breakdown?.gross_amount?.value ?? '0')
    const currency     = (resource.amount?.currency_code ?? resource.currency_code ?? 'USD').toUpperCase()
    const fee          = parseFloat(resource.transaction_fee?.value ?? resource.seller_receivable_breakdown?.paypal_fee?.value ?? '0')
    const net          = parseFloat(resource.seller_receivable_breakdown?.net_amount?.value ?? (amount - fee).toFixed(2))

    // Main payment event
    await processEvent({
      company_id:       companyId,
      event_type:       'paypal_payment',
      occurred_at:      resource.create_time ?? new Date().toISOString(),
      source:           'paypal',
      source_id:        resource.id,
      source_ref:       resource.invoice_id ?? resource.custom_id ?? null,
      amount:           amount,
      currency:         currency,
      payload: {
        ...resource,
        event_type:          eventType,
        transaction_type:    'sale',
        fee_amount:          fee,
        net_amount:          net,
        customer_country:    resource.shipping_address?.country_code ?? null,
        customer_type:       'unknown',
      },
      customer_country: resource.shipping_address?.country_code ?? null,
      customer_type:    'unknown',
      transaction_type: 'sale',
    }, 'system')

    // Separate fee event
    if (fee > 0) {
      await processEvent({
        company_id:    companyId,
        event_type:    'paypal_fee',
        occurred_at:   resource.create_time ?? new Date().toISOString(),
        source:        'paypal',
        source_id:     `fee_${resource.id}`,
        source_ref:    resource.id,
        amount:        fee,
        currency:      currency,
        payload: { ...resource, transaction_type: 'fee' },
        transaction_type: 'fee',
      }, 'system')
    }
  }

  // PAYMENT.SALE.REFUNDED or PAYMENT.CAPTURE.REFUNDED
  if (['PAYMENT.SALE.REFUNDED', 'PAYMENT.CAPTURE.REFUNDED'].includes(eventType)) {
    const amount   = parseFloat(resource.amount?.value ?? '0')
    const currency = (resource.amount?.currency_code ?? 'USD').toUpperCase()

    await processEvent({
      company_id:    companyId,
      event_type:    'paypal_refund',
      occurred_at:   resource.create_time ?? new Date().toISOString(),
      source:        'paypal',
      source_id:     resource.id,
      source_ref:    resource.sale_id ?? resource.capture_id ?? null,
      amount:        amount,
      currency:      currency,
      payload: { ...resource, transaction_type: 'refund' },
      transaction_type: 'refund',
    }, 'system')
  }

  // INVOICING.INVOICE.PAID
  if (eventType === 'INVOICING.INVOICE.PAID') {
    const invoice  = resource
    const amount   = parseFloat(invoice.amount?.value ?? '0')
    const currency = (invoice.amount?.currency_code ?? 'USD').toUpperCase()

    await processEvent({
      company_id:    companyId,
      event_type:    'paypal_payment',
      occurred_at:   invoice.metadata?.last_payment_time ?? new Date().toISOString(),
      source:        'paypal',
      source_id:     `inv_${invoice.id}`,
      source_ref:    invoice.detail?.invoice_number ?? null,
      amount:        amount,
      currency:      currency,
      payload: {
        ...invoice,
        transaction_type:    'sale',
        customer_country:    invoice.primary_recipients?.[0]?.billing_info?.address?.country_code ?? null,
      },
      customer_country: invoice.primary_recipients?.[0]?.billing_info?.address?.country_code ?? null,
      transaction_type: 'sale',
    }, 'system')
  }

  return NextResponse.json({ received: true })
}
