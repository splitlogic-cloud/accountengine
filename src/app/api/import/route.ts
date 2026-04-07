import { NextRequest, NextResponse } from 'next/server'
import { createUserClient, createServiceClient } from '@/lib/supabase/server'
import { parseStripeCSV }   from '@/lib/import/parsers/stripe'
import { parseShopifyCSV, parseShopifyJSON } from '@/lib/import/parsers/shopify'
import { parsePayPalCSV }   from '@/lib/import/parsers/paypal'
import { classifyTaxDeterministic } from '@/lib/tax/classifier'
import { computeIdempotencyKey, computePayloadHash } from '@/lib/accounting/posting-engine'

export async function POST(request: NextRequest) {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData   = await request.formData()
  const file       = formData.get('file') as File
  const companyId  = formData.get('company_id') as string
  const source     = formData.get('source') as string  // 'stripe' | 'shopify' | 'paypal'
  const preview    = formData.get('preview') === 'true'

  if (!file || !companyId || !source) {
    return NextResponse.json({ error: 'file, company_id och source krävs' }, { status: 400 })
  }

  const service = createServiceClient()

  // Verify access
  const { data: member } = await service
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const content  = await file.text()
  const fileName = file.name.toLowerCase()

  // Parse the file
  let parseResult
  try {
    if (source === 'stripe') {
      parseResult = parseStripeCSV(content)
    } else if (source === 'shopify') {
      if (fileName.endsWith('.json')) {
        parseResult = parseShopifyJSON(content)
      } else {
        parseResult = parseShopifyCSV(content, 'auto')
      }
    } else if (source === 'paypal') {
      parseResult = parsePayPalCSV(content)
    } else {
      return NextResponse.json({ error: `Okänd källa: ${source}` }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: `Parsningsfel: ${err instanceof Error ? err.message : 'Okänt fel'}` }, { status: 400 })
  }

  if (!parseResult.ok && parseResult.transactions.length === 0) {
    return NextResponse.json({
      ok:     false,
      errors: parseResult.errors,
      count:  0,
    })
  }

  // Enrich with tax classification
  const enriched = parseResult.transactions.map(tx => {
    const taxResult = classifyTaxDeterministic({
      amount:              tx.amount,
      currency:            tx.currency,
      transaction_type:    tx.event_type.replace(`${source}_`, ''),
      customer_country:    tx.customer_country ?? null,
      customer_type:       'b2c',  // default; override if known
      customer_vat_number: null,
      source,
      company_country:     'SE',
    })

    return {
      ...tx,
      tax_treatment:  taxResult?.treatment ?? 'unknown',
      vat_rate:       taxResult?.vat_rate ?? 0,
      vat_amount:     taxResult?.vat_amount ?? 0,
      tax_confidence: taxResult ? (taxResult.confidence >= 90 ? 'high' : taxResult.confidence >= 70 ? 'medium' : 'low') : 'low',
      tax_reason:     taxResult?.reasoning ?? '',
    }
  })

  // If preview — return without saving
  if (preview) {
    return NextResponse.json({
      ok:           true,
      preview:      true,
      transactions: enriched.slice(0, 50),  // show first 50 in preview
      total:        enriched.length,
      errors:       parseResult.errors,
      summary: {
        by_treatment: groupBy(enriched, 'tax_treatment'),
        by_currency:  groupBy(enriched, 'currency'),
        total_amount: enriched.reduce((s, t) => s + t.amount, 0),
      },
    })
  }

  // Create import record
  const { data: importRecord } = await service
    .from('imports')
    .insert({
      company_id:      companyId,
      source,
      file_name:       file.name,
      file_size_bytes: file.size,
      status:          'processing',
      row_count:       enriched.length,
      created_by:      user.id,
    })
    .select('id')
    .single()

  const importId = importRecord?.id

  // Insert financial events (idempotent)
  let created = 0
  let skipped = 0
  const errors: string[] = []

  for (const tx of enriched) {
    try {
      const idempotencyKey = computeIdempotencyKey(companyId, source, tx.source_id)
      const payloadHash    = computePayloadHash(tx.raw)

      const { error } = await service
        .from('financial_events')
        .upsert({
          company_id:       companyId,
          event_type:       tx.event_type,
          occurred_at:      tx.occurred_at,
          source,
          source_id:        tx.source_id,
          source_ref:       tx.source_ref ?? null,
          amount:           tx.amount,
          currency:         tx.currency,
          payload: {
            ...tx.raw,
            customer_country:   tx.customer_country ?? null,
            customer_type:      'b2c',
            transaction_type:   tx.event_type.replace(`${source}_`, ''),
            tax_treatment:      tx.tax_treatment,
            vat_rate:           tx.vat_rate,
          },
          payload_hash:     payloadHash,
          processing_status: 'pending',
          idempotency_key:  idempotencyKey,
          import_id:        importId ?? null,
          created_by:       'system',
        }, {
          onConflict:       'company_id,idempotency_key',
          ignoreDuplicates: true,
        })

      if (error) {
        if (error.code === '23505') {
          skipped++
        } else {
          errors.push(`${tx.source_id}: ${error.message}`)
        }
      } else {
        created++
      }
    } catch (err) {
      errors.push(`${tx.source_id}: ${err instanceof Error ? err.message : 'Okänt fel'}`)
    }
  }

  // Update import status
  if (importId) {
    await service
      .from('imports')
      .update({
        status:       errors.length > 0 ? 'completed' : 'completed',
        row_count:    enriched.length,
        metadata:     { created, skipped, errors: errors.slice(0, 10) },
      })
      .eq('id', importId)
  }

  return NextResponse.json({
    ok:      true,
    created,
    skipped,
    errors:  errors.slice(0, 10),
    total:   enriched.length,
    import_id: importId,
  })
}

function groupBy<T extends Record<string, any>>(arr: T[], key: string): Record<string, number> {
  return arr.reduce((acc, item) => {
    const k = item[key] ?? 'unknown'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
}
