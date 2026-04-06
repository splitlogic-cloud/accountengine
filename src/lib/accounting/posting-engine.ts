import 'server-only'

import { createHash }            from 'crypto'
import { createServiceClient }   from '@/lib/supabase/server'
import { evaluateRules, generateJournalLines } from '@/lib/rules/engine'
import { classifyTaxDeterministic }            from '@/lib/tax/classifier'
import { writeAuditChain }       from '@/lib/accounting/audit-chain'
import type {
  Rule,
  TaxTreatment,
  Result,
  NormalSide,
} from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class PostingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'PostingError'
  }
}

export type BlockerCode =
  | 'MISSING_VAT_RATE'
  | 'UNKNOWN_COUNTRY'
  | 'UNBALANCED_ENTRY'
  | 'MISSING_ACCOUNT'
  | 'INACTIVE_ACCOUNT'
  | 'NO_MATCHING_RULE'
  | 'PERIOD_LOCKED'
  | 'PERIOD_CLOSED'
  | 'MISSING_EXCHANGE_RATE'
  | 'INVALID_AMOUNT'
  | 'DUPLICATE_EVENT'
  | 'TAX_CONFLICT'
  | 'MISSING_CUSTOMER_COUNTRY'
  | 'REVERSAL_CHAIN_ERROR'

export interface Blocker {
  code:     BlockerCode
  severity: 'error' | 'warning' | 'info'
  message:  string              // Swedish, shown to user
  context:  Record<string, unknown>
}

export interface FinancialEventInput {
  company_id:          string
  event_type:          string
  occurred_at:         string
  source:              string
  source_id:           string
  source_ref?:         string
  amount:              number
  currency:            string
  amount_sek?:         number
  exchange_rate?:      number
  payload:             Record<string, unknown>
  // Enriched fields (from connector normalisation)
  customer_country?:   string | null
  customer_type?:      'b2b' | 'b2c' | 'unknown'
  customer_vat_number?: string | null
  transaction_type?:   string
}

export interface ProposedLine {
  side:           NormalSide
  account_number: string
  amount:         number
  description:    string
  vat_code:       string | null
  vat_amount:     number
}

export interface RuleExecutionResult {
  action:           'auto_post' | 'queue' | 'skip' | 'blocked'
  matched_rule_id:  string | null
  matched_rule_name: string | null
  tax_treatment:    TaxTreatment | null
  proposed_lines:   ProposedLine[]
  generated_hash:   string
  blockers:         Blocker[]
  rule_version_tag: string
  execution_ms:     number
}

// ---------------------------------------------------------------------------
// computeIdempotencyKey
// Deterministic key for an event. Same source event always produces same key.
// ---------------------------------------------------------------------------
export function computeIdempotencyKey(
  companyId: string,
  source:    string,
  sourceId:  string,
): string {
  return createHash('sha256')
    .update(`${companyId}:${source}:${sourceId}`)
    .digest('hex')
}

// ---------------------------------------------------------------------------
// computePayloadHash
// ---------------------------------------------------------------------------
export function computePayloadHash(payload: Record<string, unknown>): string {
  // Deterministic JSON: sorted keys
  const sorted = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(sorted).digest('hex')
}

// ---------------------------------------------------------------------------
// computeGeneratedHash
// Hash of the proposed lines — proves reproducibility.
// Given same event + same rule version → same hash.
// ---------------------------------------------------------------------------
export function computeGeneratedHash(lines: ProposedLine[]): string {
  const normalized = JSON.stringify(
    lines.map(l => ({
      side:    l.side,
      account: l.account_number,
      amount:  Math.round(l.amount * 100),  // integer öre to avoid float drift
    })).sort((a, b) => `${a.side}${a.account}`.localeCompare(`${b.side}${b.account}`))
  )
  return createHash('sha256').update(normalized).digest('hex')
}

// ---------------------------------------------------------------------------
// BlockerEngine
// Pure function — no DB calls. Returns all blockers for a given event.
// Blockers of severity 'error' prevent posting.
// Blockers of severity 'warning' allow posting but notify.
// ---------------------------------------------------------------------------
export function runBlockerEngine(
  event:    FinancialEventInput,
  accounts: Set<string>,    // Set of active account numbers in this company
): Blocker[] {
  const blockers: Blocker[] = []

  // Invalid amount
  if (!isFinite(event.amount) || isNaN(event.amount)) {
    blockers.push({
      code:     'INVALID_AMOUNT',
      severity: 'error',
      message:  `Ogiltigt belopp: ${event.amount}. Kontrollera källdata.`,
      context:  { amount: event.amount },
    })
  }

  // Missing exchange rate for foreign currency
  if (event.currency !== 'SEK' && !event.amount_sek) {
    blockers.push({
      code:     'MISSING_EXCHANGE_RATE',
      severity: 'error',
      message:  `Saknar valutakurs för ${event.currency}. Kontrollera att ECB-kurser är importerade.`,
      context:  { currency: event.currency, date: event.occurred_at },
    })
  }

  // Missing customer country for taxable events
  const taxableTypes = ['stripe_charge', 'shopify_order', 'paypal_payment']
  if (taxableTypes.includes(event.event_type) && !event.customer_country) {
    blockers.push({
      code:     'MISSING_CUSTOMER_COUNTRY',
      severity: 'warning',
      message:  `Kundland saknas för händelse ${event.source_id}. Momsklassificering kan vara felaktig.`,
      context:  { source_id: event.source_id },
    })
  }

  return blockers
}

// ---------------------------------------------------------------------------
// runDeterministicEngine
// Pure function: given an event and rules, produces a deterministic result.
// No side effects. Can be called multiple times with same result.
// ---------------------------------------------------------------------------
export function runDeterministicEngine(
  event:            FinancialEventInput,
  rules:            Rule[],
  ruleVersionTag:   string,
  activeAccounts:   Set<string>,
): RuleExecutionResult {
  const startTime = Date.now()

  // 1. Run blocker engine first
  const blockers = runBlockerEngine(event, activeAccounts)
  const hardBlockers = blockers.filter(b => b.severity === 'error')

  if (hardBlockers.length > 0) {
    return {
      action:            'blocked',
      matched_rule_id:   null,
      matched_rule_name: null,
      tax_treatment:     null,
      proposed_lines:    [],
      generated_hash:    computeGeneratedHash([]),
      blockers,
      rule_version_tag:  ruleVersionTag,
      execution_ms:      Date.now() - startTime,
    }
  }

  // 2. Tax classification (deterministic — no AI here, AI only in async enrichment)
  const taxInput = {
    amount:              event.amount,
    currency:            event.currency,
    transaction_type:    event.transaction_type ?? 'sale',
    customer_country:    event.customer_country ?? null,
    customer_type:       event.customer_type ?? 'unknown',
    customer_vat_number: event.customer_vat_number ?? null,
    source:              event.source,
    description:         null,
    company_country:     'SE',
  }

  const taxResult = classifyTaxDeterministic(taxInput)

  // 3. Build transaction-like object for rule engine
  const txLike = {
    id:                  event.source_id,
    company_id:          event.company_id,
    source:              event.source,
    transaction_type:    (event.transaction_type ?? 'sale') as any,
    amount:              event.amount,
    currency:            event.currency,
    amount_sek:          event.amount_sek ?? event.amount,
    customer_country:    event.customer_country ?? null,
    customer_type:       (event.customer_type ?? 'unknown') as any,
    customer_vat_number: event.customer_vat_number ?? null,
    description:         null,
    counterpart_name:    null,
    counterpart_ref:     null,
    tax_result: taxResult ? {
      tax_treatment: taxResult.treatment,
      vat_rate:      taxResult.vat_rate,
      vat_amount:    taxResult.vat_amount,
    } : undefined,
  } as any

  // 4. Run rules
  const ruleMatch = evaluateRules(txLike, rules)

  if (!ruleMatch.matched || ruleMatch.action === 'skip') {
    return {
      action:            ruleMatch.action === 'skip' ? 'skip' : 'queue',
      matched_rule_id:   null,
      matched_rule_name: null,
      tax_treatment:     taxResult?.treatment ?? null,
      proposed_lines:    [],
      generated_hash:    computeGeneratedHash([]),
      blockers,
      rule_version_tag:  ruleVersionTag,
      execution_ms:      Date.now() - startTime,
    }
  }

  // 5. Generate lines
  const linesResult = generateJournalLines(txLike, ruleMatch.template!, {
    description: `${event.event_type} — ${event.source_id}`,
    vat_rate:    taxResult?.vat_rate ?? undefined,
  })

  if (!linesResult.ok) {
    blockers.push({
      code:     'UNBALANCED_ENTRY',
      severity: 'error',
      message:  `Konteringsrader balanserar inte: ${linesResult.error.message}`,
      context:  { rule_name: ruleMatch.rule?.name },
    })
    return {
      action:            'blocked',
      matched_rule_id:   ruleMatch.rule?.id ?? null,
      matched_rule_name: ruleMatch.rule?.name ?? null,
      tax_treatment:     taxResult?.treatment ?? null,
      proposed_lines:    [],
      generated_hash:    computeGeneratedHash([]),
      blockers,
      rule_version_tag:  ruleVersionTag,
      execution_ms:      Date.now() - startTime,
    }
  }

  // 6. Verify all accounts exist
  for (const line of linesResult.value) {
    if (!activeAccounts.has(line.account_number)) {
      blockers.push({
        code:     'MISSING_ACCOUNT',
        severity: 'error',
        message:  `Konto ${line.account_number} finns inte eller är inaktivt i kontoplanen.`,
        context:  { account_number: line.account_number, rule: ruleMatch.rule?.name },
      })
    }
  }

  const proposedLines: ProposedLine[] = linesResult.value.map(l => ({
    side:           l.side,
    account_number: l.account_number,
    amount:         l.amount,
    description:    l.description,
    vat_code:       null,
    vat_amount:     l.vat_amount,
  }))

  return {
    action:            blockers.some(b => b.severity === 'error') ? 'blocked' : 'auto_post',
    matched_rule_id:   ruleMatch.rule?.id ?? null,
    matched_rule_name: ruleMatch.rule?.name ?? null,
    tax_treatment:     taxResult?.treatment ?? null,
    proposed_lines:    proposedLines,
    generated_hash:    computeGeneratedHash(proposedLines),
    blockers,
    rule_version_tag:  ruleVersionTag,
    execution_ms:      Date.now() - startTime,
  }
}

// ---------------------------------------------------------------------------
// recordFinancialEvent
// Persists an event to the event store. Idempotent.
// ---------------------------------------------------------------------------
export async function recordFinancialEvent(
  input:   FinancialEventInput,
): Promise<Result<{ event_id: string; was_duplicate: boolean }, PostingError>> {
  const supabase         = createServiceClient()
  const idempotencyKey   = computeIdempotencyKey(input.company_id, input.source, input.source_id)
  const payloadHash      = computePayloadHash(input.payload)

  const { data, error } = await supabase
    .from('financial_events')
    .upsert({
      company_id:          input.company_id,
      event_type:          input.event_type,
      occurred_at:         input.occurred_at,
      source:              input.source,
      source_id:           input.source_id,
      source_ref:          input.source_ref ?? null,
      amount:              input.amount,
      currency:            input.currency,
      amount_sek:          input.amount_sek ?? null,
      exchange_rate:       input.exchange_rate ?? null,
      payload:             input.payload,
      payload_hash:        payloadHash,
      idempotency_key:     idempotencyKey,
      processing_status:   'pending',
      created_by:          'system',
    }, {
      onConflict:       'company_id,idempotency_key',
      ignoreDuplicates: false,
    })
    .select('id, processing_status')
    .single()

  if (error) {
    return err(new PostingError(
      `Failed to record financial event: ${error.message}`,
      'DB_ERROR',
      { pg_error: error.message },
    ))
  }

  const wasDuplicate = data.processing_status !== 'pending'

  return ok({ event_id: data.id, was_duplicate: wasDuplicate })
}

// ---------------------------------------------------------------------------
// executeRulesForEvent
// Runs the deterministic engine and persists the execution record.
// ---------------------------------------------------------------------------
export async function executeRulesForEvent(
  eventId:   string,
  companyId: string,
): Promise<Result<RuleExecutionResult, PostingError>> {
  const supabase = createServiceClient()

  // Fetch event
  const { data: event, error: evtErr } = await supabase
    .from('financial_events')
    .select('*')
    .eq('id', eventId)
    .eq('company_id', companyId)
    .single()

  if (evtErr || !event) {
    return err(new PostingError(`Event ${eventId} not found.`, 'NOT_FOUND'))
  }

  if (event.processing_status === 'posted') {
    return err(new PostingError(`Event ${eventId} is already posted.`, 'ALREADY_POSTED'))
  }

  // Fetch current rule version
  const { data: ruleVersion } = await supabase
    .from('rule_versions')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_current', true)
    .single()

  const versionTag = ruleVersion?.version_tag ?? `${new Date().toISOString().split('T')[0]}_v0`

  // Fetch active rules (from snapshot if versioned, otherwise live)
  let rules: Rule[]
  if (ruleVersion?.rules_snapshot) {
    rules = ruleVersion.rules_snapshot as Rule[]
  } else {
    const { data: liveRules } = await supabase
      .from('rules')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('priority')
    rules = (liveRules ?? []) as Rule[]
  }

  // Fetch active accounts
  const { data: accounts } = await supabase
    .from('accounts')
    .select('account_number')
    .eq('company_id', companyId)
    .eq('is_active', true)

  const activeAccounts = new Set((accounts ?? []).map(a => a.account_number as string))

  // Build event input
  const input: FinancialEventInput = {
    company_id:       companyId,
    event_type:       event.event_type,
    occurred_at:      event.occurred_at,
    source:           event.source,
    source_id:        event.source_id,
    source_ref:       event.source_ref,
    amount:           event.amount,
    currency:         event.currency,
    amount_sek:       event.amount_sek,
    exchange_rate:    event.exchange_rate,
    payload:          event.payload,
    // Extract enriched fields from payload
    customer_country:    event.payload?.['customer_country'] as string ?? null,
    customer_type:       event.payload?.['customer_type'] as any ?? 'unknown',
    customer_vat_number: event.payload?.['customer_vat_number'] as string ?? null,
    transaction_type:    event.payload?.['transaction_type'] as string ?? undefined,
  }

  // Run deterministic engine
  const result = runDeterministicEngine(input, rules, versionTag, activeAccounts)

  // Persist execution record
  const { error: execErr } = await supabase
    .from('rule_executions')
    .insert({
      event_id:          eventId,
      company_id:        companyId,
      rule_version_id:   ruleVersion?.id ?? null,
      rule_version_tag:  versionTag,
      matched_rule_id:   result.matched_rule_id,
      matched_rule_name: result.matched_rule_name,
      action_taken:      result.action,
      tax_treatment:     result.tax_treatment,
      generated_lines:   result.proposed_lines,
      generated_hash:    result.generated_hash,
      blockers:          result.blockers,
      execution_time_ms: result.execution_ms,
    })

  if (execErr) {
    return err(new PostingError(
      `Failed to persist rule execution: ${execErr.message}`,
      'DB_ERROR',
    ))
  }

  // Persist blockers as individual rows for querying
  if (result.blockers.length > 0) {
    await supabase.from('event_blockers').insert(
      result.blockers.map(b => ({
        event_id:    eventId,
        company_id:  companyId,
        blocker_code: b.code,
        severity:    b.severity,
        message:     b.message,
        context:     b.context,
      }))
    )
  }

  // Update event status
  const newStatus = result.action === 'blocked' ? 'blocked' :
                    result.action === 'skip'    ? 'validated' : 'validated'
  await supabase
    .from('financial_events')
    .update({ processing_status: newStatus })
    .eq('id', eventId)

  return ok(result)
}

// ---------------------------------------------------------------------------
// postEvent
// Final step: calls the DB-level atomic posting function.
// ---------------------------------------------------------------------------
export async function postEvent(
  eventId:   string,
  companyId: string,
  actorId:   string,
): Promise<Result<{ entry_id: string; entry_number: string }, PostingError>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('process_financial_event', {
    p_event_id:  eventId,
    p_actor_id:  actorId,
  })

  if (error) {
    return err(new PostingError(
      `Failed to post event: ${error.message}`,
      'POST_FAILED',
      { pg_error: error.message },
    ))
  }

  if (data.status === 'blocked') {
    return err(new PostingError(
      `Event has blockers: ${JSON.stringify(data.blockers)}`,
      'HAS_BLOCKERS',
      { blockers: data.blockers },
    ))
  }

  if (data.status === 'skipped') {
    return err(new PostingError(
      `Event was skipped by rule engine.`,
      'EVENT_SKIPPED',
    ))
  }

  return ok({
    entry_id:     data.journal_entry_id,
    entry_number: data.entry_number,
  })
}

// ---------------------------------------------------------------------------
// Full pipeline: record → classify → post
// ---------------------------------------------------------------------------
export async function processEvent(
  input:   FinancialEventInput,
  actorId: string,
): Promise<Result<
  { event_id: string; entry_id?: string; entry_number?: string; status: string },
  PostingError
>> {
  // 1. Record event (idempotent)
  const recordResult = await recordFinancialEvent(input)
  if (!recordResult.ok) return recordResult

  const { event_id, was_duplicate } = recordResult.value

  if (was_duplicate) {
    return ok({ event_id, status: 'duplicate_skipped' })
  }

  // 2. Run deterministic engine
  const execResult = await executeRulesForEvent(event_id, input.company_id)
  if (!execResult.ok) return execResult

  const { action } = execResult.value

  if (action !== 'auto_post') {
    return ok({ event_id, status: action })
  }

  // 3. Post atomically
  const postResult = await postEvent(event_id, input.company_id, actorId)
  if (!postResult.ok) return postResult

  return ok({
    event_id,
    entry_id:     postResult.value.entry_id,
    entry_number: postResult.value.entry_number,
    status:       'posted',
  })
}
