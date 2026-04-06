import { describe, it, expect, beforeEach } from 'vitest'
import {
  evaluateCondition,
  evaluateRules,
  generateJournalLines,
  validateRuleTemplate,
  classifyTransaction,
} from '@/lib/rules/engine'
import {
  validateEntryLines,
} from '@/lib/accounting/journal-service'
import type {
  Rule,
  RuleCondition,
  JournalLineTemplate,
  Transaction,
  TransactionTaxResult,
} from '@/types/database'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id:                  'tx-test-1',
    company_id:          'co-test-1',
    import_id:           null,
    source:              'stripe',
    external_id:         'ch_test_123',
    external_ref:        'po_test_456',
    fingerprint:         'abc123',
    transaction_type:    'sale',
    amount:              1250,        // 1250 SEK including 25% VAT
    currency:            'SEK',
    amount_sek:          1250,
    exchange_rate:       null,
    exchange_rate_id:    null,
    transaction_date:    '2026-03-15',
    value_date:          null,
    description:         'Stripe charge',
    counterpart_name:    'Spotify AB',
    counterpart_ref:     null,
    customer_country:    'SE',
    customer_type:       'b2b',
    customer_vat_number: null,
    status:              'classified',
    raw_data:            null,
    created_at:          '2026-03-15T10:00:00Z',
    updated_at:          '2026-03-15T10:00:00Z',
    ...overrides,
  }
}

function makeTaxResult(overrides: Partial<TransactionTaxResult> = {}): TransactionTaxResult {
  return {
    id:               'tax-test-1',
    transaction_id:   'tx-test-1',
    company_id:       'co-test-1',
    tax_treatment:    'domestic_vat',
    vat_rate:         25,
    vat_amount:       250,
    taxable_amount:   1000,
    jurisdiction:     'SE',
    scheme:           'standard',
    classified_by:    'rule',
    rule_id:          null,
    ai_confidence:    null,
    ai_reasoning:     null,
    ai_model:         null,
    evidence:         {},
    needs_review:     false,
    reviewed_by:      null,
    reviewed_at:      null,
    created_at:       '2026-03-15T10:00:00Z',
    updated_at:       '2026-03-15T10:00:00Z',
    ...overrides,
  }
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id:                       'rule-test-1',
    company_id:               'co-test-1',
    bureau_id:                null,
    scope:                    'company',
    name:                     'Stripe SE 25%',
    description:              null,
    priority:                 10,
    is_active:                true,
    action:                   'auto_post',
    auto_post_min_confidence: 90,
    conditions:               [
      { field: 'source',           operator: 'equals', value: 'stripe' },
      { field: 'tax_treatment',    operator: 'equals', value: 'domestic_vat' },
      { field: 'customer_country', operator: 'equals', value: 'SE' },
    ],
    journal_template: [
      { side: 'debit',  account_number: '1930', percent: 100 },
      { side: 'credit', account_number: '3010', percent: 80  },
      { side: 'credit', account_number: '2610', percent: 20  },
    ],
    match_count:     0,
    last_matched_at: null,
    version:         1,
    created_by:      null,
    created_at:      '2026-01-01T00:00:00Z',
    updated_at:      '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// evaluateCondition tests
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  const tx = { ...makeTx(), tax_result: makeTaxResult() } as any

  it('equals: matches exact value case-insensitively', () => {
    const cond: RuleCondition = { field: 'source', operator: 'equals', value: 'STRIPE' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('equals: does not match partial value', () => {
    const cond: RuleCondition = { field: 'source', operator: 'equals', value: 'strip' }
    expect(evaluateCondition(tx, cond)).toBe(false)
  })

  it('contains: matches substring', () => {
    const cond: RuleCondition = { field: 'counterpart_name', operator: 'contains', value: 'spotify' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('contains: does not match unrelated string', () => {
    const cond: RuleCondition = { field: 'counterpart_name', operator: 'contains', value: 'telia' }
    expect(evaluateCondition(tx, cond)).toBe(false)
  })

  it('contains: null field → false', () => {
    const txNull = { ...tx, counterpart_name: null }
    const cond: RuleCondition = { field: 'counterpart_name', operator: 'contains', value: 'spotify' }
    expect(evaluateCondition(txNull, cond)).toBe(false)
  })

  it('starts_with: matches prefix', () => {
    const cond: RuleCondition = { field: 'counterpart_name', operator: 'starts_with', value: 'spotify' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('ends_with: matches suffix', () => {
    const cond: RuleCondition = { field: 'counterpart_name', operator: 'ends_with', value: 'ab' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('greater_than: numeric comparison', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'greater_than', value: '1000' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('less_than: numeric comparison', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'less_than', value: '2000' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('between: inclusive range', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'between', value: '1000', value2: '2000' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('between: outside range', () => {
    const cond: RuleCondition = { field: 'amount', operator: 'between', value: '2000', value2: '5000' }
    expect(evaluateCondition(tx, cond)).toBe(false)
  })

  it('in: value in list', () => {
    const cond: RuleCondition = { field: 'source', operator: 'in', value: 'stripe,shopify,paypal' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('not_in: value not in list', () => {
    const cond: RuleCondition = { field: 'source', operator: 'not_in', value: 'shopify,paypal' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('not_equals: different value', () => {
    const cond: RuleCondition = { field: 'source', operator: 'not_equals', value: 'shopify' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('tax_treatment field: reads from nested tax_result', () => {
    const cond: RuleCondition = { field: 'tax_treatment', operator: 'equals', value: 'domestic_vat' }
    expect(evaluateCondition(tx, cond)).toBe(true)
  })

  it('tax_treatment field: no tax_result → empty string → no match', () => {
    const txNoTax = { ...tx, tax_result: undefined }
    const cond: RuleCondition = { field: 'tax_treatment', operator: 'equals', value: 'domestic_vat' }
    expect(evaluateCondition(txNoTax, cond)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// evaluateRules tests
// ---------------------------------------------------------------------------

describe('evaluateRules', () => {
  const tx = { ...makeTx(), tax_result: makeTaxResult() } as any

  it('matches rule when all conditions pass', () => {
    const rule   = makeRule()
    const result = evaluateRules(tx, [rule])
    expect(result.matched).toBe(true)
    expect(result.rule?.name).toBe('Stripe SE 25%')
    expect(result.confidence).toBe(100)
  })

  it('does not match rule when one condition fails', () => {
    const rule = makeRule({
      conditions: [
        { field: 'source',           operator: 'equals', value: 'shopify' },  // fails
        { field: 'customer_country', operator: 'equals', value: 'SE' },
      ],
    })
    const result = evaluateRules(tx, [rule])
    expect(result.matched).toBe(false)
  })

  it('skips inactive rules', () => {
    const rule   = makeRule({ is_active: false })
    const result = evaluateRules(tx, [rule])
    expect(result.matched).toBe(false)
  })

  it('skips rules with empty conditions', () => {
    const rule   = makeRule({ conditions: [] })
    const result = evaluateRules(tx, [rule])
    expect(result.matched).toBe(false)
  })

  it('respects priority: lower number wins', () => {
    const highPriority = makeRule({ id: 'r1', name: 'High',  priority: 1  })
    const lowPriority  = makeRule({ id: 'r2', name: 'Low',   priority: 100 })
    const result = evaluateRules(tx, [lowPriority, highPriority])
    expect(result.rule?.name).toBe('High')
  })

  it('returns no match when rules list is empty', () => {
    const result = evaluateRules(tx, [])
    expect(result.matched).toBe(false)
    expect(result.rule).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateRuleTemplate tests
// ---------------------------------------------------------------------------

describe('validateRuleTemplate', () => {
  it('accepts valid balanced template', () => {
    const template: JournalLineTemplate[] = [
      { side: 'debit',  account_number: '1930', percent: 100 },
      { side: 'credit', account_number: '3010', percent: 80  },
      { side: 'credit', account_number: '2610', percent: 20  },
    ]
    const result = validateRuleTemplate(template)
    expect(result.ok).toBe(true)
  })

  it('rejects template with < 2 lines', () => {
    const template: JournalLineTemplate[] = [
      { side: 'debit', account_number: '1930', percent: 100 },
    ]
    const result = validateRuleTemplate(template)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_TEMPLATE')
  })

  it('rejects template with no debit lines', () => {
    const template: JournalLineTemplate[] = [
      { side: 'credit', account_number: '3010', percent: 80 },
      { side: 'credit', account_number: '2610', percent: 20 },
    ]
    const result = validateRuleTemplate(template)
    expect(result.ok).toBe(false)
  })

  it('rejects template where debit pct ≠ 100', () => {
    const template: JournalLineTemplate[] = [
      { side: 'debit',  account_number: '1930', percent: 90 },  // 90 not 100
      { side: 'credit', account_number: '3010', percent: 80 },
      { side: 'credit', account_number: '2610', percent: 20 },
    ]
    const result = validateRuleTemplate(template)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generateJournalLines tests
// ---------------------------------------------------------------------------

describe('generateJournalLines', () => {
  const tx = { ...makeTx(), tax_result: makeTaxResult() } as any
  const template: JournalLineTemplate[] = [
    { side: 'debit',  account_number: '1930', percent: 100 },
    { side: 'credit', account_number: '3010', percent: 80  },
    { side: 'credit', account_number: '2610', percent: 20  },
  ]

  it('generates correct amounts for 1250 SEK', () => {
    const result = generateJournalLines(tx, template)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const debit  = result.value.find(l => l.side === 'debit')!
    const credit3010 = result.value.find(l => l.account_number === '3010')!
    const credit2610 = result.value.find(l => l.account_number === '2610')!

    expect(debit.amount).toBe(1250)
    expect(credit3010.amount).toBe(1000)
    expect(credit2610.amount).toBe(250)
  })

  it('generated lines always balance', () => {
    const result = generateJournalLines(tx, template)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const totalDebit  = result.value.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
    const totalCredit = result.value.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.005)
  })

  it('handles rounding correctly for odd amounts', () => {
    const txOdd = { ...tx, amount: 1000, amount_sek: 333.33 }  // Will have rounding
    const tplSimple: JournalLineTemplate[] = [
      { side: 'debit',  account_number: '1930', percent: 100 },
      { side: 'credit', account_number: '3010', percent: 80  },
      { side: 'credit', account_number: '2610', percent: 20  },
    ]
    const result = generateJournalLines(txOdd, tplSimple)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const d = result.value.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
    const c = result.value.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
    expect(Math.abs(d - c)).toBeLessThan(0.005)
  })
})

// ---------------------------------------------------------------------------
// validateEntryLines tests
// ---------------------------------------------------------------------------

describe('validateEntryLines', () => {
  it('accepts balanced 2-line entry', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '1930', amount: 1250 },
      { side: 'credit', account_number: '3010', amount: 1250 },
    ])
    expect(result.ok).toBe(true)
  })

  it('accepts balanced 3-line entry', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '1930', amount: 1250 },
      { side: 'credit', account_number: '3010', amount: 1000 },
      { side: 'credit', account_number: '2610', amount: 250  },
    ])
    expect(result.ok).toBe(true)
  })

  it('rejects single-line entry', () => {
    const result = validateEntryLines([
      { side: 'debit', account_number: '1930', amount: 1250 },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_LINES')
  })

  it('rejects empty lines array', () => {
    const result = validateEntryLines([])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_LINES')
  })

  it('rejects unbalanced entry', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '1930', amount: 1250 },
      { side: 'credit', account_number: '3010', amount: 1000 }, // 250 short
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNBALANCED_ENTRY')
  })

  it('rejects invalid account number format', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: 'BANK', amount: 1250 },
      { side: 'credit', account_number: '3010', amount: 1250 },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ACCOUNT_NUMBER')
  })

  it('rejects zero amount', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '1930', amount: 0    },
      { side: 'credit', account_number: '3010', amount: 0    },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_AMOUNT')
  })

  it('rejects negative amount', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '1930', amount: -100 },
      { side: 'credit', account_number: '3010', amount: -100 },
    ])
    expect(result.ok).toBe(false)
  })

  it('tolerates tiny floating point differences (< 0.005)', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '1930', amount: 100.001 },
      { side: 'credit', account_number: '3010', amount: 100     },
    ])
    expect(result.ok).toBe(true)
  })

  it('rejects account number with too many digits', () => {
    const result = validateEntryLines([
      { side: 'debit',  account_number: '19300', amount: 1250 }, // 5 digits
      { side: 'credit', account_number: '3010',  amount: 1250 },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ACCOUNT_NUMBER')
  })
})

// ---------------------------------------------------------------------------
// classifyTransaction (rule engine integration)
// ---------------------------------------------------------------------------

describe('classifyTransaction (rule engine)', () => {
  it('classifies Stripe SE sale as auto_post when rule matches', () => {
    const tx   = { ...makeTx(), tax_result: makeTaxResult() } as any
    const rule = makeRule()
    const result = classifyTransaction(tx, [rule])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.action).toBe('auto_post')
    expect(result.value.lines).not.toBeNull()
    expect(result.value.needs_ai).toBe(false)
  })

  it('queues transaction when no rule matches', () => {
    const tx     = { ...makeTx({ source: 'unknown_source' }), tax_result: makeTaxResult() } as any
    const rule   = makeRule()
    const result = classifyTransaction(tx, [rule])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.action).toBe('queue')
    expect(result.value.needs_ai).toBe(true)
  })

  it('skips transaction when rule action is skip', () => {
    const tx   = { ...makeTx(), tax_result: makeTaxResult() } as any
    const rule = makeRule({ action: 'skip' })
    const result = classifyTransaction(tx, [rule])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.action).toBe('skip')
    expect(result.value.needs_ai).toBe(false)
  })
})
