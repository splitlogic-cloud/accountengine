import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import { writeAudit }          from '@/lib/accounting/audit'
import type {
  CreateJournalEntryDTO,
  JournalEntry,
  JournalLine,
  NormalSide,
  Result,
} from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class JournalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'JournalError'
  }
}

export interface PostedEntryResult {
  id:           string
  entry_number: string
  entry_date:   string
  description:  string
  status:       string
  lines:        JournalLine[]
}

interface EntryBalance {
  debit:    number
  credit:   number
  diff:     number
  balanced: boolean
}

// ---------------------------------------------------------------------------
// validateEntryLines — pure, no DB, unit testable
// ---------------------------------------------------------------------------
export function validateEntryLines(
  lines: CreateJournalEntryDTO['lines'],
): Result<EntryBalance, JournalError> {
  if (!lines || lines.length < 2) {
    return err(new JournalError(
      'A journal entry must have at least 2 lines.',
      'INSUFFICIENT_LINES',
      { line_count: lines?.length ?? 0 },
    ))
  }

  let debit  = 0
  let credit = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (!line.account_number?.match(/^\d{4}(-[A-Z0-9]+)?$/)) {
      return err(new JournalError(
        `Line ${i + 1}: invalid account number "${line.account_number}".`,
        'INVALID_ACCOUNT_NUMBER',
        { line_index: i, account_number: line.account_number },
      ))
    }

    if (typeof line.amount !== 'number' || line.amount <= 0 || !isFinite(line.amount)) {
      return err(new JournalError(
        `Line ${i + 1}: amount must be a positive finite number (got ${line.amount}).`,
        'INVALID_AMOUNT',
        { line_index: i, amount: line.amount },
      ))
    }

    if (line.side === 'debit') debit  += line.amount
    else                       credit += line.amount
  }

  const diff     = Math.abs(debit - credit)
  const balanced = diff < 0.005

  if (!balanced) {
    return err(new JournalError(
      `Entry does not balance: Debit=${debit.toFixed(2)} Credit=${credit.toFixed(2)} (diff=${diff.toFixed(2)}).`,
      'UNBALANCED_ENTRY',
      { debit, credit, diff },
    ))
  }

  return { ok: true, value: { debit, credit, diff, balanced } }
}

// ---------------------------------------------------------------------------
// createDraftEntry
// ---------------------------------------------------------------------------
export async function createDraftEntry(
  dto:    CreateJournalEntryDTO,
  userId: string,
): Promise<Result<JournalEntry, JournalError>> {
  const balanceResult = validateEntryLines(dto.lines)
  if (!balanceResult.ok) return balanceResult

  const supabase    = createServiceClient()
  const entryDate   = new Date(dto.entry_date)
  const fiscalYear  = entryDate.getFullYear()
  const periodMonth = entryDate.getMonth() + 1

  const accountNumbers = [...new Set(dto.lines.map(l => l.account_number))]
  const { data: accounts, error: acctError } = await supabase
    .from('accounts')
    .select('id, account_number, name, is_active')
    .eq('company_id', dto.company_id)
    .in('account_number', accountNumbers)

  if (acctError) {
    return err(new JournalError('Failed to fetch accounts.', 'DB_ERROR', { pg_error: acctError.message }))
  }

  const accountMap = new Map((accounts ?? []).map(a => [a.account_number, a]))

  for (const num of accountNumbers) {
    const account = accountMap.get(num)
    if (!account) {
      return err(new JournalError(`Account ${num} does not exist in chart of accounts.`, 'ACCOUNT_NOT_FOUND', { account_number: num }))
    }
    if (!account.is_active) {
      return err(new JournalError(`Account ${num} is inactive.`, 'ACCOUNT_INACTIVE', { account_number: num }))
    }
  }

  const { data, error: rpcError } = await supabase.rpc('create_journal_entry_draft', {
    p_company_id:   dto.company_id,
    p_entry_date:   dto.entry_date,
    p_fiscal_year:  fiscalYear,
    p_period_month: periodMonth,
    p_description:  dto.description,
    p_source:       dto.source ?? 'manual',
    p_source_ref:   dto.source_ref ?? null,
    p_created_by:   userId,
    p_lines: dto.lines.map((l, i) => {
      const account = accountMap.get(l.account_number)!
      return {
        line_number:    i + 1,
        side:           l.side,
        account_id:     account.id,
        account_number: l.account_number,
        account_name:   account.name,
        amount:         l.amount,
        currency:       l.currency ?? 'SEK',
        description:    l.description ?? null,
        vat_code:       l.vat_code ?? null,
        vat_amount:     l.vat_amount ?? 0,
        cost_center:    null,
        project_code:   null,
      }
    }),
  })

  if (rpcError) {
    return err(new JournalError(`Failed to create draft: ${rpcError.message}`, 'DB_ERROR', { pg_error: rpcError.message }))
  }

  return ok(data as JournalEntry)
}

// ---------------------------------------------------------------------------
// postEntry — returns PostedEntryResult with entry_number
// ---------------------------------------------------------------------------
export async function postEntry(
  entryId:   string,
  companyId: string,
  userId:    string,
): Promise<Result<PostedEntryResult, JournalError>> {
  const supabase = createServiceClient()

  const { data: entry, error: fetchError } = await supabase
    .from('journal_entries')
    .select('*, lines:journal_lines(*)')
    .eq('id', entryId)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !entry) {
    return err(new JournalError(`Entry ${entryId} not found.`, 'NOT_FOUND'))
  }

  if (entry.status === 'posted') {
    return err(new JournalError(`Entry ${entry.entry_number} is already posted.`, 'ALREADY_POSTED'))
  }

  if (entry.status === 'reversed' || entry.status === 'void') {
    return err(new JournalError(`Entry ${entry.entry_number} cannot be posted (status: ${entry.status}).`, 'INVALID_STATUS'))
  }

  // App-level balance check (DB trigger is belt-and-suspenders)
  const lines: CreateJournalEntryDTO['lines'] = (entry.lines ?? []).map((l: JournalLine) => ({
    side:           l.side,
    account_number: l.account_number,
    amount:         l.amount,
  }))

  const balanceResult = validateEntryLines(lines)
  if (!balanceResult.ok) return balanceResult

  const { data: posted, error: postError } = await supabase
    .from('journal_entries')
    .update({
      status:    'posted',
      posted_by: userId,
      posted_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('company_id', companyId)
    .select('*, lines:journal_lines(*)')
    .single()

  if (postError) {
    const msg = postError.message
    if (msg.includes('does not balance')) return err(new JournalError(msg, 'UNBALANCED_ENTRY'))
    if (msg.includes('locked period'))    return err(new JournalError(msg, 'PERIOD_LOCKED'))
    if (msg.includes('closed period'))    return err(new JournalError(msg, 'PERIOD_CLOSED'))
    return err(new JournalError(`Failed to post: ${msg}`, 'POST_FAILED'))
  }

  await writeAudit({
    company_id:  companyId,
    action:      'journal_entry.posted',
    entity_type: 'journal_entry',
    entity_id:   entryId,
    after_data: {
      entry_number: posted.entry_number,
      entry_date:   posted.entry_date,
      description:  posted.description,
    },
  })

  return ok({
    id:           posted.id,
    entry_number: posted.entry_number,
    entry_date:   posted.entry_date,
    description:  posted.description,
    status:       posted.status,
    lines:        posted.lines ?? [],
  })
}

// ---------------------------------------------------------------------------
// reverseEntry
// ---------------------------------------------------------------------------
export async function reverseEntry(
  entryId:   string,
  companyId: string,
  userId:    string,
  opts:      { reversal_date: string; description?: string },
): Promise<Result<PostedEntryResult, JournalError>> {
  const supabase = createServiceClient()

  const { data: original, error: fetchError } = await supabase
    .from('journal_entries')
    .select('*, lines:journal_lines(*)')
    .eq('id', entryId)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !original) {
    return err(new JournalError(`Entry ${entryId} not found.`, 'NOT_FOUND'))
  }

  if (original.status !== 'posted') {
    return err(new JournalError(`Only posted entries can be reversed.`, 'INVALID_STATUS'))
  }

  if (original.reversed_by) {
    return err(new JournalError(`Entry ${original.entry_number} is already reversed.`, 'ALREADY_REVERSED'))
  }

  const reversalLines: CreateJournalEntryDTO['lines'] = (original.lines ?? []).map((l: JournalLine) => ({
    side:           l.side === 'debit' ? 'credit' as NormalSide : 'debit' as NormalSide,
    account_number: l.account_number,
    amount:         l.amount,
    currency:       l.currency,
    description:    l.description ?? undefined,
    vat_code:       l.vat_code ?? undefined,
    vat_amount:     l.vat_amount,
  }))

  const draftResult = await createDraftEntry({
    company_id:  companyId,
    entry_date:  opts.reversal_date,
    description: opts.description ?? `Reversering av ${original.entry_number}: ${original.description}`,
    source:      'correction',
    source_ref:  original.entry_number,
    lines:       reversalLines,
  }, userId)

  if (!draftResult.ok) return draftResult

  const postResult = await postEntry(draftResult.value.id, companyId, userId)
  if (!postResult.ok) return postResult

  await supabase
    .from('journal_entries')
    .update({ reversed_by: draftResult.value.id })
    .eq('id', entryId)

  await supabase
    .from('journal_entries')
    .update({ reversal_of: entryId })
    .eq('id', draftResult.value.id)

  return postResult
}

// ---------------------------------------------------------------------------
// getEntry
// ---------------------------------------------------------------------------
export async function getEntry(
  entryId:   string,
  companyId: string,
): Promise<Result<JournalEntry & { lines: JournalLine[] }, JournalError>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*, lines:journal_lines(*)')
    .eq('id', entryId)
    .eq('company_id', companyId)
    .single()

  if (error || !data) {
    return err(new JournalError(`Entry ${entryId} not found.`, 'NOT_FOUND'))
  }

  return ok(data as JournalEntry & { lines: JournalLine[] })
}

// ---------------------------------------------------------------------------
// listEntries
// ---------------------------------------------------------------------------
export interface ListEntriesOptions {
  company_id:    string
  fiscal_year?:  number
  period_month?: number
  status?:       string
  source?:       string
  from_date?:    string
  to_date?:      string
  page?:         number
  page_size?:    number
}

export interface ListEntriesResult {
  entries:     JournalEntry[]
  total:       number
  page:        number
  page_size:   number
  total_pages: number
}

export async function listEntries(
  opts: ListEntriesOptions,
): Promise<Result<ListEntriesResult, JournalError>> {
  const supabase  = createServiceClient()
  const page      = opts.page      ?? 1
  const page_size = opts.page_size ?? 50
  const from      = (page - 1) * page_size
  const to        = from + page_size - 1

  let query = supabase
    .from('journal_entries')
    .select('*', { count: 'exact' })
    .eq('company_id', opts.company_id)
    .order('entry_date',   { ascending: false })
    .order('entry_number', { ascending: false })
    .range(from, to)

  if (opts.fiscal_year)  query = query.eq('fiscal_year',  opts.fiscal_year)
  if (opts.period_month) query = query.eq('period_month', opts.period_month)
  if (opts.status)       query = query.eq('status',       opts.status)
  if (opts.source)       query = query.eq('source',       opts.source)
  if (opts.from_date)    query = query.gte('entry_date',  opts.from_date)
  if (opts.to_date)      query = query.lte('entry_date',  opts.to_date)

  const { data, error, count } = await query

  if (error) {
    return err(new JournalError('Failed to list entries.', 'DB_ERROR', { pg_error: error.message }))
  }

  const total      = count ?? 0
  const totalPages = Math.ceil(total / page_size)

  return ok({
    entries:     (data ?? []) as JournalEntry[],
    total,
    page,
    page_size,
    total_pages: totalPages,
  })
}
