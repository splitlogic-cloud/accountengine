import 'server-only'

import type {
  Rule,
  RuleCondition,
  JournalLineTemplate,
  Transaction,
  TransactionTaxResult,
  ClassificationResult,
  Result,
} from '@/types/database'
import { ok, err } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class RuleEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'RuleEngineError'
  }
}

export interface RuleMatchResult {
  matched:    boolean
  rule:       Rule | null
  action:     'auto_post' | 'queue' | 'skip' | null
  template:   JournalLineTemplate[] | null
  confidence: number   // 0–100: 100 = rule match, lower = AI confidence
}

export interface TransactionWithTax extends Transaction {
  tax_result?: TransactionTaxResult
}

// ---------------------------------------------------------------------------
// Field extraction
// Map rule condition field names to transaction values.
// ---------------------------------------------------------------------------

function getTransactionField(
  tx:    TransactionWithTax,
  field: RuleCondition['field'],
): string {
  switch (field) {
    case 'source':            return tx.source ?? ''
    case 'transaction_type':  return tx.transaction_type ?? ''
    case 'tax_treatment':     return tx.tax_result?.tax_treatment ?? ''
    case 'customer_country':  return tx.customer_country ?? ''
    case 'customer_type':     return tx.customer_type ?? ''
    case 'counterpart_name':  return tx.counterpart_name ?? ''
    case 'counterpart_ref':   return tx.counterpart_ref ?? ''
    case 'amount':            return String(Math.abs(tx.amount) ?? 0)
    default:                  return ''
  }
}

// ---------------------------------------------------------------------------
// Single condition evaluation (pure function — unit testable)
// ---------------------------------------------------------------------------

export function evaluateCondition(
  tx:        TransactionWithTax,
  condition: RuleCondition,
): boolean {
  const raw   = getTransactionField(tx, condition.field)
  const value = raw.toLowerCase().trim()
  const cmp   = condition.value.toLowerCase().trim()

  switch (condition.operator) {
    case 'equals':
      return value === cmp

    case 'not_equals':
      return value !== cmp

    case 'contains':
      return value.includes(cmp)

    case 'starts_with':
      return value.startsWith(cmp)

    case 'ends_with':
      return value.endsWith(cmp)

    case 'greater_than': {
      const n = parseFloat(value)
      const c = parseFloat(cmp)
      return !isNaN(n) && !isNaN(c) && n > c
    }

    case 'less_than': {
      const n = parseFloat(value)
      const c = parseFloat(cmp)
      return !isNaN(n) && !isNaN(c) && n < c
    }

    case 'between': {
      const n  = parseFloat(value)
      const lo = parseFloat(cmp)
      const hi = parseFloat((condition.value2 ?? '').toLowerCase().trim())
      return !isNaN(n) && !isNaN(lo) && !isNaN(hi) && n >= lo && n <= hi
    }

    case 'in': {
      const options = cmp.split(',').map(s => s.trim())
      return options.includes(value)
    }

    case 'not_in': {
      const options = cmp.split(',').map(s => s.trim())
      return !options.includes(value)
    }

    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Validate rule template integrity
// Each side's percentages must sum to 100.
// ---------------------------------------------------------------------------

export function validateRuleTemplate(
  template: JournalLineTemplate[],
): Result<true, RuleEngineError> {
  if (!template || template.length < 2) {
    return err(new RuleEngineError(
      'Rule template must have at least 2 lines (one debit, one credit).',
      'INVALID_TEMPLATE',
    ))
  }

  const debitLines  = template.filter(l => l.side === 'debit')
  const creditLines = template.filter(l => l.side === 'credit')

  if (debitLines.length === 0) {
    return err(new RuleEngineError('Rule template has no debit lines.', 'INVALID_TEMPLATE'))
  }
  if (creditLines.length === 0) {
    return err(new RuleEngineError('Rule template has no credit lines.', 'INVALID_TEMPLATE'))
  }

  const debitPct  = debitLines.reduce((s, l) => s + l.percent, 0)
  const creditPct = creditLines.reduce((s, l) => s + l.percent, 0)

  if (Math.abs(debitPct - 100) > 0.01) {
    return err(new RuleEngineError(
      `Debit percentages sum to ${debitPct}%, must be 100%.`,
      'INVALID_TEMPLATE',
      { debit_pct: debitPct },
    ))
  }
  if (Math.abs(creditPct - 100) > 0.01) {
    return err(new RuleEngineError(
      `Credit percentages sum to ${creditPct}%, must be 100%.`,
      'INVALID_TEMPLATE',
      { credit_pct: creditPct },
    ))
  }

  return ok(true)
}

// ---------------------------------------------------------------------------
// evaluateRules
// Evaluates all rules against a transaction. Returns first match.
// Rules are pre-sorted by priority (lower = higher priority).
// Pure function — no DB calls, unit testable.
// ---------------------------------------------------------------------------

export function evaluateRules(
  tx:    TransactionWithTax,
  rules: Rule[],
): RuleMatchResult {
  // Sort by priority ascending (1 beats 100)
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)

  for (const rule of sorted) {
    if (!rule.is_active) continue
    if (!rule.conditions || rule.conditions.length === 0) continue

    // All conditions must match (AND logic)
    const allMatch = rule.conditions.every(cond => evaluateCondition(tx, cond))

    if (allMatch) {
      return {
        matched:    true,
        rule,
        action:     rule.action,
        template:   rule.journal_template,
        confidence: 100,  // rule match = 100% confidence
      }
    }
  }

  return {
    matched:    false,
    rule:       null,
    action:     null,
    template:   null,
    confidence: 0,
  }
}

// ---------------------------------------------------------------------------
// generateJournalLines
// Applies a journal_template to a transaction amount.
// Handles rounding: last line absorbs rounding difference to ensure balance.
// ---------------------------------------------------------------------------

export interface GeneratedLine {
  side:           'debit' | 'credit'
  account_number: string
  amount:         number
  description:    string
  vat_amount:     number
}

export function generateJournalLines(
  tx:       TransactionWithTax,
  template: JournalLineTemplate[],
  opts: {
    description?: string
    vat_rate?:    number
  } = {},
): Result<GeneratedLine[], RuleEngineError> {
  const templateResult = validateRuleTemplate(template)
  if (!templateResult.ok) return templateResult

  const baseAmount = Math.abs(tx.amount_sek ?? tx.amount)
  const vatRate    = opts.vat_rate ?? tx.tax_result?.vat_rate ?? 0
  const desc       = opts.description ?? tx.description ?? 'Import'

  // Calculate amounts for each side
  const debitLines  = template.filter(l => l.side === 'debit')
  const creditLines = template.filter(l => l.side === 'credit')

  const buildLines = (
    lines:       JournalLineTemplate[],
    totalAmount: number,
  ): GeneratedLine[] => {
    const result: GeneratedLine[] = []
    let allocated = 0

    for (let i = 0; i < lines.length; i++) {
      const line    = lines[i]!
      const isLast  = i === lines.length - 1
      let amount: number

      if (isLast) {
        // Last line absorbs rounding difference
        amount = Math.round((totalAmount - allocated) * 100) / 100
      } else {
        amount = Math.round((totalAmount * line.percent / 100) * 100) / 100
        allocated += amount
      }

      // Calculate VAT amount for this line
      // Convention: if vat_code indicates this is a VAT line, amount IS the VAT
      // Otherwise vat_amount is 0 and the VAT line is separate
      const vatAmount = 0  // VAT amounts are explicit in template, not derived

      result.push({
        side:           line.side,
        account_number: line.account_number,
        amount:         Math.abs(amount),
        description:    line.description ?? desc,
        vat_amount:     vatAmount,
      })
    }

    return result
  }

  const generatedDebit  = buildLines(debitLines,  baseAmount)
  const generatedCredit = buildLines(creditLines, baseAmount)

  // Final balance check
  const totalDebit  = generatedDebit.reduce((s, l) => s + l.amount, 0)
  const totalCredit = generatedCredit.reduce((s, l) => s + l.amount, 0)

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    return err(new RuleEngineError(
      `Generated lines do not balance: D=${totalDebit} K=${totalCredit}`,
      'GENERATION_BALANCE_ERROR',
      { debit: totalDebit, credit: totalCredit },
    ))
  }

  return ok([...generatedDebit, ...generatedCredit])
}

// ---------------------------------------------------------------------------
// classifyTransaction
// Runs the full classification pipeline for a single transaction.
// 1. Match against rules (deterministic, fast, free)
// 2. If no match or action=queue: return needs_ai flag
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  action:     'auto_post' | 'queue' | 'skip'
  rule_match: RuleMatchResult
  template:   JournalLineTemplate[] | null
  lines:      GeneratedLine[] | null
  needs_ai:   boolean
}

export function classifyTransaction(
  tx:    TransactionWithTax,
  rules: Rule[],
): Result<ClassifyResult, RuleEngineError> {
  const match = evaluateRules(tx, rules)

  if (!match.matched || match.action === 'queue') {
    return ok({
      action:     'queue',
      rule_match: match,
      template:   null,
      lines:      null,
      needs_ai:   true,
    })
  }

  if (match.action === 'skip') {
    return ok({
      action:     'skip',
      rule_match: match,
      template:   match.template,
      lines:      null,
      needs_ai:   false,
    })
  }

  // auto_post: generate lines
  if (!match.template) {
    return err(new RuleEngineError(
      `Rule "${match.rule?.name}" has action=auto_post but no journal_template.`,
      'MISSING_TEMPLATE',
    ))
  }

  const linesResult = generateJournalLines(tx, match.template)
  if (!linesResult.ok) return linesResult

  return ok({
    action:     'auto_post',
    rule_match: match,
    template:   match.template,
    lines:      linesResult.value,
    needs_ai:   false,
  })
}
