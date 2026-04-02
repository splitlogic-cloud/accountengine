import { describe, test, expect } from 'vitest'
import { evaluateRules, generateJournalLines } from '../engine'
import type { Transaction, Rule } from '@/lib/types/database'

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1', company_id: 'co-1', bureau_id: 'bu-1',
    source: 'bank', external_id: null, external_ref: null,
    transaction_type: 'supplier_invoice', amount: 14500, currency: 'SEK',
    transaction_date: '2026-03-15', description: null,
    counterpart_name: null, counterpart_org: null, customer_country: null,
    tax_treatment: 'unknown', vat_rate: null, posting_status: 'pending',
    pipeline_stage: 'imported', rule_id: null,
    ai_confidence: null, ai_reasoning: null, ai_model: null, ai_classified_at: null,
    source_checksum: null, fingerprint: null, version: 1, last_seen_at: null,
    raw_data: null, created_at: '2026-03-15T00:00:00Z', updated_at: '2026-03-15T00:00:00Z',
    ...overrides,
  }
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1', bureau_id: 'bu-1', company_id: null, scope: 'bureau',
    name: 'Test rule', description: null, priority: 10, is_active: true,
    action: 'auto_post',
    journal_lines: [
      { side: 'debit', account: '6212', percent: 80 },
      { side: 'debit', account: '2641', percent: 20 },
      { side: 'credit', account: '2440', percent: 100 },
    ],
    match_count: 0, last_matched_at: null,
    created_at: '2026-03-15T00:00:00Z', updated_at: '2026-03-15T00:00:00Z',
    created_by: null, conditions: [],
    ...overrides,
  }
}

describe('evaluateRules — contains', () => {
  const teliaRule = makeRule({
    conditions: [{ id: 'c1', rule_id: 'rule-1', sort_order: 0,
      field: 'counterpart_name', operator: 'contains', value: 'telia', value2: null }]
  })
  test('matches Telia Sverige AB', () => {
    const result = evaluateRules(makeTx({ counterpart_name: 'Telia Sverige AB' }), [teliaRule])
    expect(result.matched).toBe(true)
    expect(result.action).toBe('auto_post')
  })
  test('case-insensitive', () => {
    expect(evaluateRules(makeTx({ counterpart_name: 'TELIA SONERA' }), [teliaRule]).matched).toBe(true)
  })
  test('does not match Tele2', () => {
    expect(evaluateRules(makeTx({ counterpart_name: 'Tele2 Sverige' }), [teliaRule]).matched).toBe(false)
  })
  test('does not match null', () => {
    expect(evaluateRules(makeTx({ counterpart_name: null }), [teliaRule]).matched).toBe(false)
  })
})

describe('evaluateRules — priority', () => {
  test('picks lowest priority number', () => {
    const high = makeRule({ id: 'r1', name: 'High', priority: 5,
      conditions: [{ id: 'c1', rule_id: 'r1', sort_order: 0,
        field: 'counterpart_name', operator: 'contains', value: 'telia', value2: null }] })
    const low = makeRule({ id: 'r2', name: 'Low', priority: 100,
      conditions: [{ id: 'c2', rule_id: 'r2', sort_order: 0,
        field: 'counterpart_name', operator: 'contains', value: 'telia', value2: null }] })
    const result = evaluateRules(makeTx({ counterpart_name: 'Telia AB' }), [low, high])
    expect(result.rule?.name).toBe('High')
  })
  test('skips inactive rules', () => {
    const inactive = makeRule({ is_active: false,
      conditions: [{ id: 'c1', rule_id: 'rule-1', sort_order: 0,
        field: 'counterpart_name', operator: 'contains', value: 'telia', value2: null }] })
    expect(evaluateRules(makeTx({ counterpart_name: 'Telia AB' }), [inactive]).matched).toBe(false)
  })
})

describe('generateJournalLines', () => {
  test('generates correct amounts', () => {
    const lines = generateJournalLines(makeTx({ amount: 14500 }), makeRule())
    expect(lines[0]).toMatchObject({ side: 'debit', account: '6212', amount: 11600 })
    expect(lines[1]).toMatchObject({ side: 'debit', account: '2641', amount: 2900 })
    expect(lines[2]).toMatchObject({ side: 'credit', account: '2440', amount: 14500 })
  })
  test('debit equals credit', () => {
    const lines = generateJournalLines(makeTx({ amount: 14500 }), makeRule())
    const debit  = lines.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
    const credit = lines.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
    expect(debit).toBe(credit)
  })
})
