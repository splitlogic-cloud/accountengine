import { describe, it, expect } from 'vitest'
import { classifyTaxDeterministic } from '@/lib/tax/classifier'

type Input = Parameters<typeof classifyTaxDeterministic>[0]

function makeInput(overrides: Partial<Input> = {}): Input {
  return {
    amount:              1250,
    currency:            'SEK',
    transaction_type:    'sale',
    customer_country:    'SE',
    customer_type:       'b2c',
    customer_vat_number: null,
    source:              'stripe',
    description:         'Test charge',
    company_country:     'SE',
    ...overrides,
  }
}

describe('classifyTaxDeterministic', () => {

  describe('Domestic (SE → SE)', () => {
    it('SE B2C → domestic_vat 25%', () => {
      const result = classifyTaxDeterministic(makeInput())
      expect(result).not.toBeNull()
      expect(result!.treatment).toBe('domestic_vat')
      expect(result!.vat_rate).toBe(25)
      expect(result!.jurisdiction).toBe('SE')
      expect(result!.confidence).toBe(100)
    })

    it('SE B2B → domestic_vat 25% (B2B domestic still has VAT)', () => {
      const result = classifyTaxDeterministic(makeInput({ customer_type: 'b2b' }))
      expect(result!.treatment).toBe('domestic_vat')
      expect(result!.vat_rate).toBe(25)
    })

    it('Null country → treated as domestic', () => {
      const result = classifyTaxDeterministic(makeInput({ customer_country: null }))
      expect(result!.treatment).toBe('domestic_vat')
    })

    it('VAT amount is correctly calculated (1250 incl. 25%)', () => {
      const result = classifyTaxDeterministic(makeInput({ amount: 1250 }))
      // 1250 * 25/125 = 250
      expect(result!.vat_amount).toBe(250)
      expect(result!.taxable).toBe(1000)
    })
  })

  describe('Export (SE → non-EU)', () => {
    it('US → export_outside_eu, 0%', () => {
      const result = classifyTaxDeterministic(makeInput({ customer_country: 'US' }))
      expect(result!.treatment).toBe('export_outside_eu')
      expect(result!.vat_rate).toBe(0)
      expect(result!.vat_amount).toBe(0)
      expect(result!.confidence).toBe(100)
    })

    it('GB → export_outside_eu (post-Brexit)', () => {
      const result = classifyTaxDeterministic(makeInput({ customer_country: 'GB' }))
      expect(result!.treatment).toBe('export_outside_eu')
    })

    it('NO → export_outside_eu (Norway not in EU)', () => {
      const result = classifyTaxDeterministic(makeInput({ customer_country: 'NO' }))
      expect(result!.treatment).toBe('export_outside_eu')
    })

    it('AU → export_outside_eu', () => {
      const result = classifyTaxDeterministic(makeInput({ customer_country: 'AU' }))
      expect(result!.treatment).toBe('export_outside_eu')
    })
  })

  describe('EU OSS (SE → EU B2C)', () => {
    it('DE B2C → eu_oss 19%', () => {
      const result = classifyTaxDeterministic(makeInput({
        customer_country: 'DE',
        customer_type:    'b2c',
      }))
      expect(result!.treatment).toBe('eu_oss')
      expect(result!.vat_rate).toBe(19)
      expect(result!.jurisdiction).toBe('DE')
      expect(result!.scheme).toBe('oss')
    })

    it('FR B2C → eu_oss 20%', () => {
      const result = classifyTaxDeterministic(makeInput({
        customer_country: 'FR',
        customer_type:    'b2c',
      }))
      expect(result!.treatment).toBe('eu_oss')
      expect(result!.vat_rate).toBe(20)
    })

    it('DK B2C → eu_oss 25%', () => {
      const result = classifyTaxDeterministic(makeInput({
        customer_country: 'DK',
        customer_type:    'b2c',
      }))
      expect(result!.treatment).toBe('eu_oss')
      expect(result!.vat_rate).toBe(25)
    })

    it('EU B2C unknown type → eu_oss with lower confidence', () => {
      const result = classifyTaxDeterministic(makeInput({
        customer_country: 'DE',
        customer_type:    'unknown',
      }))
      expect(result!.treatment).toBe('eu_oss')
      expect(result!.confidence).toBeLessThan(90)
    })
  })

  describe('EU B2B Reverse Charge', () => {
    it('DE B2B with VAT number → eu_b2b_reverse_charge', () => {
      const result = classifyTaxDeterministic(makeInput({
        customer_country:    'DE',
        customer_type:       'b2b',
        customer_vat_number: 'DE123456789',
      }))
      expect(result!.treatment).toBe('eu_b2b_reverse_charge')
      expect(result!.vat_rate).toBe(0)
      expect(result!.vat_amount).toBe(0)
      expect(result!.scheme).toBe('reverse_charge')
    })

    it('EU B2B without VAT number → eu_oss (cannot confirm B2B)', () => {
      const result = classifyTaxDeterministic(makeInput({
        customer_country:    'DE',
        customer_type:       'b2b',
        customer_vat_number: null,   // No VAT number → treat as B2C
      }))
      // Without VAT number we cannot confirm reverse charge → OSS
      expect(result!.treatment).toBe('eu_oss')
    })
  })

  describe('Outside scope (non-taxable types)', () => {
    it('fee → outside_scope', () => {
      const result = classifyTaxDeterministic(makeInput({ transaction_type: 'fee' }))
      expect(result!.treatment).toBe('outside_scope')
      expect(result!.vat_amount).toBe(0)
    })

    it('payout → outside_scope', () => {
      const result = classifyTaxDeterministic(makeInput({ transaction_type: 'payout' }))
      expect(result!.treatment).toBe('outside_scope')
    })

    it('transfer → outside_scope', () => {
      const result = classifyTaxDeterministic(makeInput({ transaction_type: 'transfer' }))
      expect(result!.treatment).toBe('outside_scope')
    })

    it('adjustment → outside_scope', () => {
      const result = classifyTaxDeterministic(makeInput({ transaction_type: 'adjustment' }))
      expect(result!.treatment).toBe('outside_scope')
    })

    it('chargeback → outside_scope', () => {
      const result = classifyTaxDeterministic(makeInput({ transaction_type: 'chargeback' }))
      expect(result!.treatment).toBe('outside_scope')
    })
  })

  describe('Refunds', () => {
    it('SE refund → domestic_vat (negative amount)', () => {
      const result = classifyTaxDeterministic(makeInput({
        transaction_type: 'refund',
        amount:           -1250,
        customer_country: 'SE',
      }))
      expect(result!.treatment).toBe('domestic_vat')
      expect(result!.vat_amount).toBe(250)  // abs amount used for VAT calc
    })
  })

  describe('Unknown/ambiguous cases', () => {
    it('returns null for unknown transaction type (let AI handle it)', () => {
      const result = classifyTaxDeterministic(makeInput({ transaction_type: 'interest' }))
      // 'interest' is not in the deterministic list → null
      expect(result).toBeNull()
    })
  })
})
