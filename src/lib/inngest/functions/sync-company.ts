import { inngest }                       from '../client'
import { createServiceClient }           from '@/lib/supabase/server'
import { classifyTransaction as classifyTax } from '@/lib/tax/classifier'
import { classifyTransaction as classifyRule } from '@/lib/rules/engine'
import { writeAudit, AuditAction }       from '@/lib/accounting/audit'
import { decryptJSON }                   from '@/lib/vault/crypto'
import type { Transaction, Rule }        from '@/types/database'

// ---------------------------------------------------------------------------
// Event: company/sync.requested
// Payload: { company_id, from_date, to_date, triggered_by }
// ---------------------------------------------------------------------------

export const syncCompanyFn = inngest.createFunction(
  {
    id:          'sync-company',
    name:        'Synkronisera bolag',
    concurrency: {
      limit: 5,
      key:   'event.data.bureau_id',   // max 5 concurrent syncs per bureau
    },
    retries: 3,
    timeouts: {
      start:  '30s',   // must start within 30s of trigger
      finish: '15m',   // must complete within 15 minutes
    },
  },
  { event: 'company/sync.requested' as const },
  async ({ event, step, logger }) => {
    const {
      company_id,
      bureau_id,
      from_date,
      to_date,
      triggered_by,
    } = event.data as {
      company_id:   string
      bureau_id:    string
      from_date:    string
      to_date:      string
      triggered_by: string
    }

    logger.info('Starting sync', { company_id, from_date, to_date })

    // ── Step 1: Fetch company + integration ─────────────────────────────────
    const { company, integration } = await step.run('fetch-company', async () => {
      const supabase = createServiceClient()

      const { data: co, error: coErr } = await supabase
        .from('companies')
        .select('*')
        .eq('id', company_id)
        .single()

      if (coErr || !co) {
        throw new Error(`Company ${company_id} not found: ${coErr?.message}`)
      }

      const { data: intg } = await supabase
        .from('integrations')
        .select('*')
        .eq('company_id', company_id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()

      return { company: co, integration: intg }
    })

    if (!integration) {
      logger.warn('No active integration found for company', { company_id })
      return { skipped: true, reason: 'no_integration' }
    }

    // ── Step 2: Mark sync started ────────────────────────────────────────────
    await step.run('mark-syncing', async () => {
      const supabase = createServiceClient()
      await supabase
        .from('integrations')
        .update({ status: 'active', last_error: null })
        .eq('id', integration.id)

      await supabase
        .from('imports')
        .insert({
          company_id:     company_id,
          integration_id: integration.id,
          source:         integration.source,
          status:         'processing',
          from_date,
          to_date,
          started_at:     new Date().toISOString(),
          created_by:     triggered_by,
        })
    })

    // ── Step 3: Fetch and normalize transactions ──────────────────────────────
    const { importId, txCount, skipCount } = await step.run('fetch-transactions', async () => {
      const supabase = createServiceClient()

      // Decrypt credentials
      let credentials: Record<string, unknown> = {}
      if (integration.credentials) {
        credentials = decryptJSON(integration.credentials)
      }

      // Fetch normalised transactions from the appropriate connector
      // (Connectors are imported dynamically to keep bundle small)
      const { normalizeTransactions } = await import(`@/lib/import/connectors/${integration.source}`)
      const normalized = await normalizeTransactions(
        company,
        credentials,
        integration.config,
        { from_date, to_date },
      )

      // Upsert transactions (fingerprint deduplication handled by UNIQUE constraint)
      let imported = 0
      let skipped  = 0

      const CHUNK = 100
      for (let i = 0; i < normalized.length; i += CHUNK) {
        const chunk = normalized.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('transactions')
          .upsert(chunk, {
            onConflict:      'company_id,fingerprint',
            ignoreDuplicates: true,
          })
          .select('id')

        if (error) {
          logger.error('Transaction upsert error', { chunk_start: i, error: error.message })
          throw new Error(`Transaction upsert failed: ${error.message}`)
        }

        const inserted = (data ?? []).length
        imported += inserted
        skipped  += chunk.length - inserted
      }

      // Update import record
      const { data: imp } = await supabase
        .from('imports')
        .update({
          status:       'completed',
          raw_count:    normalized.length,
          tx_count:     imported,
          skip_count:   skipped,
          completed_at: new Date().toISOString(),
        })
        .eq('company_id', company_id)
        .eq('status', 'processing')
        .select('id')
        .single()

      return { importId: imp?.id, txCount: imported, skipCount: skipped }
    })

    logger.info('Import complete', { importId, txCount, skipCount })

    // ── Step 4: Classify unprocessed transactions ─────────────────────────────
    const { classifiedCount, queuedCount } = await step.run('classify-transactions', async () => {
      const supabase = createServiceClient()

      // Fetch unprocessed transactions
      const { data: txs } = await supabase
        .from('transactions')
        .select('*')
        .eq('company_id', company_id)
        .eq('status', 'unprocessed')
        .limit(1000)

      if (!txs || txs.length === 0) {
        return { classifiedCount: 0, queuedCount: 0 }
      }

      // Fetch active rules
      const { data: rules } = await supabase
        .from('rules')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .order('priority')

      const activeRules = (rules ?? []) as Rule[]
      let classified = 0
      let queued     = 0

      for (const tx of txs as Transaction[]) {
        try {
          // 1. Tax classification
          const taxResult = await classifyTax(tx, company.country)

          if (!taxResult.ok) {
            logger.warn('Tax classification failed', { tx_id: tx.id, error: taxResult.error.message })
            continue
          }

          // Upsert tax result
          await supabase.from('transaction_tax_results').upsert({
            transaction_id:   tx.id,
            company_id:       company_id,
            tax_treatment:    taxResult.value.treatment,
            vat_rate:         taxResult.value.vat_rate,
            vat_amount:       taxResult.value.vat_amount,
            taxable_amount:   taxResult.value.taxable,
            jurisdiction:     taxResult.value.jurisdiction,
            scheme:           taxResult.value.scheme,
            classified_by:    taxResult.value.classified_by,
            ai_confidence:    taxResult.value.classified_by === 'ai' ? taxResult.value.confidence : null,
            ai_reasoning:     taxResult.value.classified_by === 'ai' ? taxResult.value.reasoning  : null,
            needs_review:     taxResult.value.confidence < 70,
            evidence: {
              customer_country:    tx.customer_country,
              customer_type:       tx.customer_type,
              customer_vat_number: tx.customer_vat_number,
              transaction_type:    tx.transaction_type,
              source:              tx.source,
            },
          }, { onConflict: 'transaction_id' })

          // 2. Rule classification
          const txWithTax = { ...tx, tax_result: { tax_treatment: taxResult.value.treatment } }
          const ruleResult = classifyRule(txWithTax as any, activeRules)

          if (ruleResult.ok) {
            const newStatus = ruleResult.value.action === 'auto_post' ? 'classified' : 'classified'
            await supabase
              .from('transactions')
              .update({ status: newStatus })
              .eq('id', tx.id)

            if (ruleResult.value.action === 'queue' || ruleResult.value.needs_ai) {
              queued++
            } else {
              classified++
            }
          }
        } catch (e) {
          logger.error('Classification error', { tx_id: tx.id, error: String(e) })
        }
      }

      return { classifiedCount: classified, queuedCount: queued }
    })

    logger.info('Classification complete', { classifiedCount, queuedCount })

    // ── Step 5: Write audit ───────────────────────────────────────────────────
    await step.run('write-audit', async () => {
      await writeAudit({
        company_id,
        action:      AuditAction.IMPORT_COMPLETED,
        entity_type: 'import',
        entity_id:   importId,
        after_data: {
          tx_count:        txCount,
          skip_count:      skipCount,
          classified:      classifiedCount,
          queued:          queuedCount,
          triggered_by,
          from_date,
          to_date,
        },
      })
    })

    return {
      company_id,
      import_id:       importId,
      tx_imported:     txCount,
      tx_skipped:      skipCount,
      tx_classified:   classifiedCount,
      tx_queued:       queuedCount,
    }
  }
)

// ---------------------------------------------------------------------------
// Event: company/batch.create_requested
// Groups classified transactions into batches for posting.
// ---------------------------------------------------------------------------

export const createBatchesFn = inngest.createFunction(
  {
    id:      'create-batches',
    name:    'Skapa bokföringsbatchar',
    retries: 2,
  },
  { event: 'company/batch.create_requested' as const },
  async ({ event, step, logger }) => {
    const { company_id } = event.data as { company_id: string; fiscal_year: number; period_month: number }

    const batches = await step.run('group-into-batches', async () => {
      const supabase = createServiceClient()

      // Fetch classified, unbatched transactions
      const { data: txs } = await supabase
        .from('transactions')
        .select('id, source, external_ref, transaction_date')
        .eq('company_id', company_id)
        .eq('status', 'classified')
        .not('id', 'in',
          supabase.from('batch_transactions').select('transaction_id')
        )
        .order('transaction_date')

      if (!txs?.length) return []

      // Group by source + external_ref (e.g. Stripe payout_id) + period
      const groups = new Map<string, typeof txs>()
      for (const tx of txs) {
        const date    = new Date(tx.transaction_date)
        const year    = date.getFullYear()
        const month   = date.getMonth() + 1
        const ref     = tx.external_ref ?? 'no-ref'
        const key     = `${tx.source}:${ref}:${year}:${month}`
        const existing = groups.get(key) ?? []
        groups.set(key, [...existing, tx])
      }

      const createdBatches: string[] = []

      for (const [key, groupTxs] of groups) {
        const [source, batchRef, year, month] = key.split(':') as [string, string, string, string]
        const date = new Date(groupTxs[0]!.transaction_date)

        // Create batch
        const { data: batch, error } = await supabase
          .from('batches')
          .upsert({
            company_id,
            source,
            batch_ref:    batchRef === 'no-ref' ? null : batchRef,
            fiscal_year:  parseInt(year),
            period_month: parseInt(month),
            tx_count:     groupTxs.length,
          }, {
            onConflict:       'company_id,source,batch_ref,fiscal_year,period_month',
            ignoreDuplicates: false,
          })
          .select('id')
          .single()

        if (error || !batch) {
          logger.error('Failed to create batch', { key, error: error?.message })
          continue
        }

        // Link transactions to batch
        await supabase.from('batch_transactions').upsert(
          groupTxs.map(tx => ({
            batch_id:       batch.id,
            transaction_id: tx.id,
          })),
          { onConflict: 'transaction_id', ignoreDuplicates: true }
        )

        // Update transaction status
        await supabase
          .from('transactions')
          .update({ status: 'batched' })
          .in('id', groupTxs.map(tx => tx.id))

        createdBatches.push(batch.id)
        logger.info('Batch created', { batch_id: batch.id, tx_count: groupTxs.length, key })
      }

      return createdBatches
    })

    return { company_id, batches_created: batches.length, batch_ids: batches }
  }
)
