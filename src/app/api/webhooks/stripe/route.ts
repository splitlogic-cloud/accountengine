import { NextRequest, NextResponse } from 'next/server'
import Stripe                        from 'stripe'
import { createServiceClient }       from '@/lib/supabase/server'
import { processEvent }              from '@/lib/accounting/posting-engine'
import { normalizeStripeTransaction } from '@/lib/import/connectors/stripe'

export async function POST(request: NextRequest) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 })
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' })
  const body      = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    )
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Find company by Stripe account ID (stored in integrations table)
  const stripeAccountId = (event.account ?? event.data?.object as any)?.object === 'account'
    ? event.account
    : null

  // Look up which company this webhook belongs to
  const { data: integration } = await supabase
    .from('integrations')
    .select('company_id, config')
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .or(`config->>'account_id'.eq.${stripeAccountId ?? ''},config->>'webhook_id'.eq.${event.id}`)
    .limit(1)
    .single()

  if (!integration) {
    // Try to find by checking all active stripe integrations
    // For single-tenant setups, just use the first active one
    const { data: fallback } = await supabase
      .from('integrations')
      .select('company_id')
      .eq('provider', 'stripe')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!fallback) {
      console.warn('[stripe/webhook] No company found for event:', event.id)
      return NextResponse.json({ received: true })  // 200 to prevent Stripe retries
    }

    return handleStripeEvent(event, fallback.company_id)
  }

  return handleStripeEvent(event, integration.company_id)
}

async function handleStripeEvent(
  event:     Stripe.Event,
  companyId: string,
): Promise<NextResponse> {

  const obj = event.data.object as any

  // Map Stripe event types to our financial event types
  const typeMap: Record<string, string> = {
    'charge.succeeded':         'stripe_charge',
    'charge.refunded':          'stripe_refund',
    'payment_intent.succeeded': 'stripe_charge',
    'payout.paid':              'stripe_payout',
    'transfer.created':         'stripe_payout',
  }

  // Handle fee events from balance transactions
  if (event.type === 'charge.succeeded') {
    // Main charge event
    const tx = normalizeStripeTransaction(obj, 'charge')
    if (tx) {
      await processEvent({
        company_id:  companyId,
        event_type:  'stripe_charge',
        occurred_at: new Date(obj.created * 1000).toISOString(),
        source:      'stripe',
        source_id:   obj.id,
        amount:      obj.amount / 100,
        currency:    obj.currency.toUpperCase(),
        payload:     obj,
        customer_country:    obj.billing_details?.address?.country ?? null,
        customer_type:       obj.customer ? 'b2c' : 'unknown',
        transaction_type:    'sale',
      }, 'system')
    }
  }

  if (event.type === 'charge.refunded') {
    await processEvent({
      company_id:  companyId,
      event_type:  'stripe_refund',
      occurred_at: new Date(obj.created * 1000).toISOString(),
      source:      'stripe',
      source_id:   `refund_${obj.id}`,
      amount:      obj.amount_refunded / 100,
      currency:    obj.currency.toUpperCase(),
      payload:     obj,
      transaction_type: 'refund',
    }, 'system')
  }

  if (event.type === 'payout.paid') {
    await processEvent({
      company_id:  companyId,
      event_type:  'stripe_payout',
      occurred_at: new Date(obj.arrival_date * 1000).toISOString(),
      source:      'stripe',
      source_id:   obj.id,
      amount:      obj.amount / 100,
      currency:    obj.currency.toUpperCase(),
      payload:     obj,
      transaction_type: 'payout',
    }, 'system')
  }

  return NextResponse.json({ received: true })
}
