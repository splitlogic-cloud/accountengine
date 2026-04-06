import 'server-only'

import { createServiceClient }       from '@/lib/supabase/server'
import { writeAudit }                from '@/lib/accounting/audit'
import { evaluateRules, generateJournalLines } from '@/lib/rules/engine'
import type {
  Batch,
  BatchPreview,
  PreviewLine,
  BatchBlocker,
  Transaction,
  Rule,
  PostBatchParams,
  Result,
} from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class BatchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'BatchError'
  }
}

// ---------------------------------------------------------------------------
// previewBatch
// Computes what the journal entry would look like without writing anything.
// This is the "review before posting" step.
// ---------------------------------------------------------------------------

export async function previewBatch(
  batchId:   string,
  companyId: string,
): Promise<Result<BatchPreview, BatchError>> {
  const supabase = createServiceClient()

  // 1. Fetch batch
  const { data: batch, error: batchErr } = await supabase
    .from('batches')
    .select('*')
    .eq('id', batchId)
    .eq('company_id', companyId)
    .single()

  if (batchErr || !batch) {
    return err(new BatchError(`Batch ${batchId} not found.`, 'NOT_FOUND'))
  }

  if (batch.status === 'posted') {
    return err(new BatchError(`Batch ${batchId} is already posted.`, 'ALREADY_POSTED'))
  }

  // 2. Fetch transactions in this batch with tax results
  const { data: batchTxs, error: txErr } = await supabase
    .from('batch_transactions')
    .select(`
      transaction_id,
      transactions (
        *,
        tax_result:transaction_tax_results (*)
      )
    `)
    .eq('batch_id', batchId)

  if (txErr) {
    return err(new BatchError(`Failed to fetch batch transactions: ${txErr.message}`, 'DB_ERROR'))
  }

  const transactions = (batchTxs ?? [])
    .map((bt: any) => bt.transactions)
    .filter(Boolean) as Array<Transaction & { tax_result?: any }>

  if (transactions.length === 0) {
    return err(new BatchError('Batch has no transactions.', 'EMPTY_BATCH'))
  }

  // 3. Fetch active rules for this company
  const { data: rules } = await supabase
    .from('rules')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('priority')

  const activeRules = (rules ?? []) as Rule[]

  // 4. Build preview lines and collect blockers
  const previewLines: PreviewLine[] = []
  const blockers:     BatchBlocker[] = []

  for (const tx of transactions) {
    // Check tax result exists
    if (!tx.tax_result && !['fee', 'payout', 'transfer'].includes(tx.transaction_type)) {
      blockers.push({
        type:    'unclassified_tx',
        message: `Transaction ${tx.id} has no tax classification. Classify it before posting.`,
        tx_id:   tx.id,
      })
      continue
    }

    // Run rule engine
    const classification = evaluateRules(tx as any, activeRules)

    if (!classification.matched || classification.action === 'skip') {
      continue  // skipped transactions don't generate lines
    }

    if (!classification.template) {
      blockers.push({
        type:    'unclassified_tx',
        message: `Transaction ${tx.id} matched no rule and has no template.`,
        tx_id:   tx.id,
      })
      continue
    }

    // Generate lines
    const linesResult = generateJournalLines(tx as any, classification.template, {
      description: `${tx.source} ${tx.external_ref ?? tx.external_id ?? tx.id}`,
    })

    if (!linesResult.ok) {
      blockers.push({
        type:    'rule_error',
        message: linesResult.error.message,
        tx_id:   tx.id,
      })
      continue
    }

    // Verify all accounts exist
    const accountNumbers = [...new Set(linesResult.value.map(l => l.account_number))]
    const { data: existingAccounts } = await supabase
      .from('accounts')
      .select('account_number, name, is_active')
      .eq('company_id', companyId)
      .in('account_number', accountNumbers)

    const existingSet = new Set(
      (existingAccounts ?? []).filter(a => a.is_active).map(a => a.account_number)
    )

    for (const acctNum of accountNumbers) {
      if (!existingSet.has(acctNum)) {
        blockers.push({
          type:           'missing_account',
          message:        `Account ${acctNum} referenced by rule "${classification.rule?.name}" does not exist or is inactive.`,
          tx_id:          tx.id,
          account_number: acctNum,
        })
      }
    }

    // Add to preview
    for (const line of linesResult.value) {
      const acct = (existingAccounts ?? []).find(a => a.account_number === line.account_number)
      previewLines.push({
        side:           line.side,
        account_number: line.account_number,
        account_name:   acct?.name ?? line.account_number,
        amount:         line.amount,
        description:    line.description,
        vat_code:       tx.tax_result?.vat_code ?? null,
        vat_amount:     line.vat_amount,
        source_tx_ids:  [tx.id],
        rule_name:      classification.rule?.name ?? null,
        ai_confidence:  tx.tax_result?.ai_confidence ?? null,
      })
    }
  }

  // 5. Aggregate lines by account and side
  const aggregated = aggregateLines(previewLines)

  // 6. Check balance
  const totalDebit  = aggregated.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
  const totalCredit = aggregated.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.005

  if (!isBalanced) {
    blockers.push({
      type:    'rule_error',
      message: `Preview does not balance: Debit=${totalDebit.toFixed(2)} Credit=${totalCredit.toFixed(2)}`,
    })
  }

  // 7. VAT summary
  const vatSummary = buildVatSummary(transactions)

  const preview: BatchPreview = {
    entry_description: `${batch.source} ${batch.batch_ref ?? batch.id} — ${batch.period_month}/${batch.fiscal_year}`,
    lines:       aggregated,
    total_debit:  totalDebit,
    total_credit: totalCredit,
    is_balanced:  isBalanced,
    vat_summary:  vatSummary,
  }

  // 8. Save preview to batch
  await supabase
    .from('batches')
    .update({
      status:        blockers.length === 0 ? 'preview_ready' : 'pending',
      preview_data:  preview,
      blocker_count: blockers.length,
      blockers:      blockers.length > 0 ? blockers : null,
      total_debit:   totalDebit,
      total_credit:  totalCredit,
    })
    .eq('id', batchId)

  return ok(preview)
}

// ---------------------------------------------------------------------------
// postBatch
// Posts a batch as an atomic journal entry.
// Guaranteed idempotent: checks batch.status before proceeding.
// Uses DB transaction via RPC to ensure atomicity.
// ---------------------------------------------------------------------------

export async function postBatch(
  params: PostBatchParams,
): Promise<Result<{ entry_id: string; entry_number: string }, BatchError>> {
  const supabase = createServiceClient()

  // 1. Re-fetch batch with lock to prevent double posting
  const { data: batch, error: batchErr } = await supabase
    .from('batches')
    .select('*')
    .eq('id', params.batch_id)
    .eq('company_id', params.company_id)
    .single()

  if (batchErr || !batch) {
    return err(new BatchError(`Batch ${params.batch_id} not found.`, 'NOT_FOUND'))
  }

  // Idempotency check
  if (batch.status === 'posted') {
    // Return the existing entry rather than failing — caller can be idempotent
    return ok({
      entry_id:     batch.entry_id!,
      entry_number: `(already posted)`,
    })
  }

  if (batch.status !== 'approved') {
    return err(new BatchError(
      `Batch must be in 'approved' status before posting. Current status: ${batch.status}`,
      'INVALID_STATUS',
      { current_status: batch.status },
    ))
  }

  if (batch.blocker_count > 0) {
    return err(new BatchError(
      `Batch has ${batch.blocker_count} blocker(s). Resolve them before posting.`,
      'HAS_BLOCKERS',
      { blockers: batch.blockers },
    ))
  }

  if (!batch.preview_data) {
    return err(new BatchError(
      `Batch has no preview data. Run previewBatch() first.`,
      'NO_PREVIEW',
    ))
  }

  const preview = batch.preview_data as BatchPreview

  if (!preview.is_balanced) {
    return err(new BatchError(
      `Batch preview is not balanced. Cannot post.`,
      'UNBALANCED',
    ))
  }

  // 2. Set batch to 'posting' to prevent concurrent attempts
  const { error: lockErr } = await supabase
    .from('batches')
    .update({ status: 'posting' })
    .eq('id', params.batch_id)
    .eq('status', 'approved')  // Optimistic concurrency: only update if still 'approved'

  if (lockErr) {
    return err(new BatchError(
      `Failed to acquire posting lock on batch. It may be posting concurrently.`,
      'LOCK_FAILED',
    ))
  }

  // 3. Build lines for the entry
  const entryLines = preview.lines.map((l, i) => ({
    line_number:    i + 1,
    side:           l.side,
    account_number: l.account_number,
    amount:         l.amount,
    description:    l.description,
    vat_code:       l.vat_code,
    vat_amount:     l.vat_amount ?? 0,
  }))

  // 4. Call atomic RPC (creates entry + lines + updates batch + updates transactions)
  const { data: result, error: rpcErr } = await supabase.rpc('post_batch_atomic', {
    p_batch_id:    params.batch_id,
    p_company_id:  params.company_id,
    p_entry_date:  params.entry_date,
    p_description: params.description ?? preview.entry_description,
    p_posted_by:   params.approved_by,
    p_lines:       entryLines,
  })

  if (rpcErr) {
    // Rollback batch status to 'approved' so it can be retried
    await supabase
      .from('batches')
      .update({ status: 'approved', error_message: rpcErr.message })
      .eq('id', params.batch_id)

    return err(new BatchError(
      `Batch posting failed: ${rpcErr.message}`,
      'POST_FAILED',
      { pg_error: rpcErr.message },
    ))
  }

  // 5. Write audit
  await writeAudit({
    company_id:  params.company_id,
    action:      'batch.posted',
    entity_type: 'batch',
    entity_id:   params.batch_id,
    after_data:  {
      entry_id:     result.entry_id,
      entry_number: result.entry_number,
      tx_count:     batch.tx_count,
      total_debit:  preview.total_debit,
      total_credit: preview.total_credit,
    },
  })

  return ok({
    entry_id:     result.entry_id,
    entry_number: result.entry_number,
  })
}

// ---------------------------------------------------------------------------
// approveBatch
// ---------------------------------------------------------------------------

export async function approveBatch(
  batchId:   string,
  companyId: string,
  userId:    string,
): Promise<Result<true, BatchError>> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('batches')
    .update({
      status:      'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', batchId)
    .eq('company_id', companyId)
    .eq('status', 'preview_ready')

  if (error) {
    return err(new BatchError(`Failed to approve batch: ${error.message}`, 'DB_ERROR'))
  }

  return ok(true)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregateLines(lines: PreviewLine[]): PreviewLine[] {
  const map = new Map<string, PreviewLine>()

  for (const line of lines) {
    const key = `${line.side}:${line.account_number}`
    const existing = map.get(key)

    if (existing) {
      existing.amount      += line.amount
      existing.vat_amount  += line.vat_amount
      existing.source_tx_ids = [...existing.source_tx_ids, ...line.source_tx_ids]
    } else {
      map.set(key, { ...line, source_tx_ids: [...line.source_tx_ids] })
    }
  }

  // Round to 2 decimal places
  return Array.from(map.values()).map(l => ({
    ...l,
    amount:     Math.round(l.amount     * 100) / 100,
    vat_amount: Math.round(l.vat_amount * 100) / 100,
  }))
}

function buildVatSummary(transactions: Array<Transaction & { tax_result?: any }>): BatchPreview['vat_summary'] {
  const map = new Map<string, BatchPreview['vat_summary'][number]>()

  for (const tx of transactions) {
    if (!tx.tax_result) continue

    const key = `${tx.tax_result.tax_treatment}:${tx.tax_result.jurisdiction ?? ''}:${tx.tax_result.vat_rate ?? ''}`
    const existing = map.get(key)

    if (existing) {
      existing.taxable    += tx.tax_result.taxable_amount ?? 0
      existing.vat_amount += tx.tax_result.vat_amount ?? 0
      existing.tx_count   += 1
    } else {
      map.set(key, {
        treatment:    tx.tax_result.tax_treatment,
        jurisdiction: tx.tax_result.jurisdiction,
        vat_rate:     tx.tax_result.vat_rate,
        taxable:      tx.tax_result.taxable_amount ?? 0,
        vat_amount:   tx.tax_result.vat_amount ?? 0,
        tx_count:     1,
      })
    }
  }

  return Array.from(map.values())
}
