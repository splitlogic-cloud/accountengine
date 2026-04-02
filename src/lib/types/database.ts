export type UserRole = 'system_admin' | 'admin' | 'accountant' | 'reader'
export type CompanyStatus = 'active' | 'inactive' | 'error' | 'pending'
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'
export type TransactionType =
  | 'charge' | 'refund' | 'payout' | 'fee' | 'transfer'
  | 'bank_debit' | 'bank_credit' | 'manual' | 'supplier_invoice'
  | 'stripe_charge' | 'stripe_refund' | 'stripe_payout' | 'stripe_fee'
  | 'shopify_order' | 'paypal_payment'
export type TaxTreatment =
  | 'domestic_vat' | 'eu_oss' | 'export_outside_eu'
  | 'eu_b2b_reverse_charge' | 'outside_scope' | 'unknown'
export type PostingStatus = 'pending' | 'queued' | 'posted' | 'rejected' | 'skipped'
export type RuleAction = 'auto_post' | 'queue' | 'skip'
export type RuleScope = 'bureau' | 'company'
export type ConditionOperator =
  | 'equals' | 'contains' | 'starts_with' | 'ends_with'
  | 'greater_than' | 'less_than' | 'between' | 'in' | 'not_in'
export type ConditionField =
  | 'counterpart_name' | 'counterpart_org' | 'transaction_type'
  | 'amount' | 'description' | 'customer_country' | 'tax_treatment' | 'source'
export type PipelineStage =
  | 'imported' | 'rules_applied' | 'ai_classified' | 'queued' | 'posted' | 'rejected'

export interface Bureau {
  id: string
  name: string
  slug: string
  org_number: string | null
  plan: string
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface BureauUser {
  id: string
  bureau_id: string
  user_id: string
  role: UserRole
  full_name: string | null
  email: string | null
  created_at: string
}

export interface Company {
  id: string
  bureau_id: string
  name: string
  slug: string
  org_number: string | null
  vat_number: string | null
  status: CompanyStatus
  fortnox_access_token: string | null
  fortnox_refresh_token: string | null
  fortnox_token_expires: string | null
  fortnox_company_id: string | null
  sync_status: SyncStatus
  last_synced_at: string | null
  sync_error: string | null
  settings: Record<string, unknown>
  modules_enabled: Record<string, boolean>
  created_at: string
  updated_at: string
}

export interface Transaction {
  id: string
  company_id: string
  bureau_id: string
  source: string
  external_id: string | null
  external_ref: string | null
  transaction_type: TransactionType
  amount: number
  currency: string
  transaction_date: string
  description: string | null
  counterpart_name: string | null
  counterpart_org: string | null
  customer_country: string | null
  tax_treatment: TaxTreatment
  vat_rate: number | null
  posting_status: PostingStatus
  pipeline_stage: PipelineStage
  rule_id: string | null
  ai_confidence: number | null
  ai_reasoning: string | null
  ai_model: string | null
  ai_classified_at: string | null
  source_checksum: string | null
  fingerprint: string | null
  version: number
  last_seen_at: string | null
  raw_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Rule {
  id: string
  bureau_id: string
  company_id: string | null
  scope: RuleScope
  name: string
  description: string | null
  priority: number
  is_active: boolean
  action: RuleAction
  journal_lines: JournalLineTemplate[]
  match_count: number
  last_matched_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  conditions?: RuleCondition[]
}

export interface RuleCondition {
  id: string
  rule_id: string
  field: ConditionField
  operator: ConditionOperator
  value: string
  value2: string | null
  sort_order: number
}

export interface JournalLineTemplate {
  side: 'debit' | 'credit'
  account: string
  percent: number
  description?: string
}

export interface ConnectorConfig {
  id: string
  company_id: string
  bureau_id: string
  connector: 'stripe' | 'shopify' | 'paypal' | 'bank_file' | 'fortnox'
  is_active: boolean
  credentials: string
  key_version: number
  last_synced_at: string | null
  last_sync_error: string | null
  created_at: string
  updated_at: string
}

export interface StripeCredentials { secret_key: string; webhook_secret?: string }
export interface ShopifyCredentials { shop: string; access_token: string }
export interface PayPalCredentials { client_id: string; client_secret: string; environment: 'sandbox' | 'live' }

export interface CompanyWithStats extends Company {
  pending_count?: number
  queued_count?: number
}
