import 'server-only'
import type { Company } from '@/lib/types/database'

export type NormalizedTransaction = {
  company_id: string
  bureau_id: string
  source: string
  external_id: string | null
  external_ref: string | null
  transaction_type: 'charge' | 'refund' | 'payout' | 'fee' | 'transfer' | 'bank_debit' | 'bank_credit' | 'manual' | 'supplier_invoice' | 'stripe_charge' | 'stripe_refund' | 'stripe_payout' | 'stripe_fee' | 'shopify_order' | 'paypal_payment'
  amount: number
  currency: string
  transaction_date: string
  description: string | null
  counterpart_name: string | null
  counterpart_org: string | null
  customer_country: string | null
  tax_treatment: 'unknown' | 'domestic_vat' | 'eu_oss' | 'export_outside_eu' | 'eu_b2b_reverse_charge' | 'outside_scope'
  vat_rate: null
  posting_status: 'pending'
  rule_id: null
  raw_data: Record<string, unknown> | null
}

export interface SyncResult {
  imported: number
  skipped: number
  errors: string[]
  dlq_count?: number
}

export interface DataSourceConnector {
  readonly name: string
  canSync(company: Company): boolean
  sync(company: Company): Promise<NormalizedTransaction[]>
}

export class ConnectorRegistry {
  private connectors: DataSourceConnector[] = []
  register(connector: DataSourceConnector): this {
    this.connectors.push(connector)
    return this
  }
  getActive(company: Company): DataSourceConnector[] {
    return this.connectors.filter(c => c.canSync(company))
  }
}

export const registry = new ConnectorRegistry()
