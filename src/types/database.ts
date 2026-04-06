// =============================================================================
// AccountEngine — Database Types
// Generated from PostgreSQL schema. Do not edit manually.
// Re-generate with: npx supabase gen types typescript --local
// =============================================================================

export type AccountType    = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'tax'
export type NormalSide     = 'debit' | 'credit'
export type EntryStatus    = 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void'
export type EntrySource    = 'manual' | 'rule' | 'ai' | 'import' | 'correction' | 'opening_balance' | 'payroll' | 'depreciation'
export type PeriodStatus   = 'open' | 'closed' | 'locked'
export type ImportStatus   = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type BatchStatus    = 'pending' | 'preview_ready' | 'approved' | 'posting' | 'posted' | 'failed' | 'reversed'
export type TxType         = 'sale' | 'refund' | 'fee' | 'payout' | 'adjustment' | 'transfer' | 'chargeback' | 'reversal' | 'interest' | 'subscription'
export type TxStatus       = 'unprocessed' | 'classified' | 'batched' | 'posted' | 'skipped' | 'error'
export type TaxTreatment   = 'domestic_vat' | 'eu_oss' | 'eu_b2b_reverse_charge' | 'export_outside_eu' | 'outside_scope' | 'exempt' | 'unknown'
export type CustomerType   = 'b2b' | 'b2c' | 'unknown'
export type PaymentDir     = 'inbound' | 'outbound'
export type PaymentStatus  = 'unmatched' | 'partial' | 'matched' | 'excess' | 'void'
export type FilingType     = 'vat_return' | 'oss' | 'agi' | 'annual' | 'intrastat'
export type FilingStatus   = 'draft' | 'validated' | 'submitted' | 'accepted' | 'rejected' | 'archived'
export type ReminderStatus = 'draft' | 'sent' | 'paid' | 'cancelled'
export type RuleAction     = 'auto_post' | 'queue' | 'skip'
export type CompanyStatus  = 'active' | 'inactive' | 'suspended' | 'onboarding'
export type MemberRole     = 'owner' | 'admin' | 'accountant' | 'reader' | 'auditor'
export type BureauPlan     = 'starter' | 'professional' | 'enterprise'

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface Bureau {
  id:             string
  name:           string
  org_number:     string | null
  vat_number:     string | null
  plan:           BureauPlan
  max_companies:  number
  settings:       Record<string, unknown>
  is_active:      boolean
  created_at:     string
  updated_at:     string
}

export interface Profile {
  id:             string
  bureau_id:      string | null
  full_name:      string | null
  email:          string
  phone:          string | null
  avatar_url:     string | null
  locale:         string
  timezone:       string
  last_seen_at:   string | null
  created_at:     string
  updated_at:     string
}

export interface Company {
  id:                   string
  bureau_id:            string
  name:                 string
  slug:                 string
  org_number:           string | null
  vat_number:           string | null
  country:              string
  currency:             string
  fiscal_year_start:    number
  accounting_method:    'accrual' | 'cash'
  status:               CompanyStatus
  vat_period:           'monthly' | 'quarterly' | 'yearly'
  oss_registered:       boolean
  address_line1:        string | null
  address_line2:        string | null
  postal_code:          string | null
  city:                 string | null
  email:                string | null
  phone:                string | null
  website:              string | null
  settings:             Record<string, unknown>
  modules_enabled:      { invoicing: boolean; payroll: boolean; fixed_assets: boolean }
  created_at:           string
  updated_at:           string
}

export interface CompanyMember {
  id:           string
  company_id:   string
  user_id:      string
  role:         MemberRole
  is_primary:   boolean
  invited_by:   string | null
  invited_at:   string | null
  accepted_at:  string | null
  created_at:   string
  updated_at:   string
}

// ---------------------------------------------------------------------------
// Accounting core
// ---------------------------------------------------------------------------

export interface Account {
  id:               string
  company_id:       string
  account_number:   string
  name:             string
  account_type:     AccountType
  normal_side:      NormalSide
  vat_code:         string | null
  is_active:        boolean
  is_system:        boolean
  opening_balance:  number
  description:      string | null
  parent_account:   string | null
  sort_order:       number
  created_at:       string
  updated_at:       string
}

export interface AccountingPeriod {
  id:             string
  company_id:     string
  fiscal_year:    number
  month:          number
  status:         PeriodStatus
  closed_at:      string | null
  closed_by:      string | null
  locked_at:      string | null
  locked_by:      string | null
  reopened_at:    string | null
  reopened_by:    string | null
  reopen_reason:  string | null
  created_at:     string
  updated_at:     string
}

export interface JournalEntry {
  id:               string
  company_id:       string
  entry_number:     string
  entry_date:       string
  fiscal_year:      number
  period_month:     number
  description:      string
  status:           EntryStatus
  source:           EntrySource
  source_ref:       string | null
  source_batch_id:  string | null
  reversal_of:      string | null
  reversed_by:      string | null
  approved_by:      string | null
  approved_at:      string | null
  posted_by:        string | null
  posted_at:        string | null
  voided_by:        string | null
  voided_at:        string | null
  void_reason:      string | null
  created_by:       string
  created_at:       string
  updated_at:       string
  // Relations (populated by joins)
  lines?:           JournalLine[]
}

export interface JournalLine {
  id:             string
  entry_id:       string
  company_id:     string
  line_number:    number
  side:           NormalSide
  account_id:     string
  account_number: string
  account_name:   string
  amount:         number
  currency:       string
  amount_sek:     number | null
  exchange_rate:  number | null
  description:    string | null
  vat_code:       string | null
  vat_amount:     number
  cost_center:    string | null
  project_code:   string | null
  created_at:     string
}

export interface GeneralLedgerRow {
  company_id:          string
  account_number:      string
  account_name:        string
  account_type:        AccountType
  normal_side:         NormalSide
  entry_id:            string
  entry_number:        string
  entry_date:          string
  fiscal_year:         number
  period_month:        number
  entry_description:   string
  line_description:    string | null
  side:                NormalSide
  amount:              number
  currency:            string
  amount_sek:          number | null
  vat_code:            string | null
  vat_amount:          number
  net_amount:          number
  source:              EntrySource
  source_ref:          string | null
  posted_at:           string | null
  posted_by:           string | null
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

export interface CurrencyRate {
  id:             string
  rate_date:      string
  from_currency:  string
  to_currency:    string
  rate:           number
  source:         string
  created_at:     string
}

export interface Integration {
  id:               string
  company_id:       string
  source:           'stripe' | 'shopify' | 'paypal' | 'bank_file' | 'fortnox' | 'sie4'
  display_name:     string | null
  status:           'active' | 'inactive' | 'error' | 'pending'
  credentials:      string | null   // encrypted
  key_version:      number
  config:           Record<string, unknown>
  last_synced_at:   string | null
  last_error:       string | null
  last_error_at:    string | null
  created_at:       string
  updated_at:       string
}

export interface Import {
  id:               string
  company_id:       string
  integration_id:   string | null
  source:           string
  status:           ImportStatus
  from_date:        string | null
  to_date:          string | null
  raw_count:        number
  tx_count:         number
  skip_count:       number
  error_count:      number
  error_message:    string | null
  error_detail:     Record<string, unknown> | null
  inngest_event:    string | null
  started_at:       string | null
  completed_at:     string | null
  created_by:       string | null
  created_at:       string
  updated_at:       string
}

export interface Transaction {
  id:                 string
  company_id:         string
  import_id:          string | null
  source:             string
  external_id:        string | null
  external_ref:       string | null
  fingerprint:        string
  transaction_type:   TxType
  amount:             number
  currency:           string
  amount_sek:         number | null
  exchange_rate:      number | null
  exchange_rate_id:   string | null
  transaction_date:   string
  value_date:         string | null
  description:        string | null
  counterpart_name:   string | null
  counterpart_ref:    string | null
  customer_country:   string | null
  customer_type:      CustomerType
  customer_vat_number: string | null
  status:             TxStatus
  raw_data:           Record<string, unknown> | null
  created_at:         string
  updated_at:         string
  // Relations
  tax_result?:        TransactionTaxResult
}

export interface TransactionTaxResult {
  id:               string
  transaction_id:   string
  company_id:       string
  tax_treatment:    TaxTreatment
  vat_rate:         number | null
  vat_amount:       number
  taxable_amount:   number
  jurisdiction:     string | null
  scheme:           'standard' | 'oss' | 'reverse_charge' | 'none' | null
  classified_by:    'rule' | 'ai' | 'manual'
  rule_id:          string | null
  ai_confidence:    number | null
  ai_reasoning:     string | null
  ai_model:         string | null
  evidence:         Record<string, unknown>
  needs_review:     boolean
  reviewed_by:      string | null
  reviewed_at:      string | null
  created_at:       string
  updated_at:       string
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleCondition {
  field:    'source' | 'transaction_type' | 'tax_treatment' | 'customer_country' | 'customer_type' | 'counterpart_name' | 'counterpart_ref' | 'amount'
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'between' | 'in' | 'not_in'
  value:    string
  value2?:  string  // used for 'between'
}

export interface JournalLineTemplate {
  side:           NormalSide
  account_number: string
  percent:        number   // must sum to 100 per side
  description?:   string
}

export interface Rule {
  id:                       string
  company_id:               string
  bureau_id:                string | null
  scope:                    'bureau' | 'company'
  name:                     string
  description:              string | null
  priority:                 number
  is_active:                boolean
  action:                   RuleAction
  auto_post_min_confidence: number
  conditions:               RuleCondition[]
  journal_template:         JournalLineTemplate[]
  match_count:              number
  last_matched_at:          string | null
  version:                  number
  created_by:               string | null
  created_at:               string
  updated_at:               string
}

// ---------------------------------------------------------------------------
// Batch engine
// ---------------------------------------------------------------------------

export interface Batch {
  id:             string
  company_id:     string
  import_id:      string | null
  source:         string
  batch_ref:      string | null
  fiscal_year:    number
  period_month:   number
  status:         BatchStatus
  tx_count:       number
  total_debit:    number
  total_credit:   number
  preview_data:   BatchPreview | null
  blocker_count:  number
  blockers:       BatchBlocker[] | null
  approved_by:    string | null
  approved_at:    string | null
  entry_id:       string | null
  error_message:  string | null
  created_at:     string
  updated_at:     string
}

export interface BatchPreview {
  entry_description: string
  lines: PreviewLine[]
  total_debit:  number
  total_credit: number
  is_balanced:  boolean
  vat_summary:  VatSummaryLine[]
}

export interface PreviewLine {
  side:           NormalSide
  account_number: string
  account_name:   string
  amount:         number
  description:    string
  vat_code:       string | null
  vat_amount:     number
  source_tx_ids:  string[]
  rule_name:      string | null
  ai_confidence:  number | null
}

export interface BatchBlocker {
  type:         'missing_account' | 'unclassified_tx' | 'missing_exchange_rate' | 'period_locked' | 'rule_error'
  message:      string
  tx_id?:       string
  account_number?: string
}

export interface VatSummaryLine {
  treatment:    TaxTreatment
  jurisdiction: string | null
  vat_rate:     number | null
  taxable:      number
  vat_amount:   number
  tx_count:     number
}

// ---------------------------------------------------------------------------
// Invoicing & payments
// ---------------------------------------------------------------------------

export interface Customer {
  id:                   string
  company_id:           string
  customer_token:       string
  customer_type:        CustomerType
  default_currency:     string
  default_vat_treatment: TaxTreatment | null
  payment_terms_days:   number
  credit_limit:         number | null
  is_active:            boolean
  external_id:          string | null
  notes:                string | null
  created_at:           string
  updated_at:           string
  // Populated via join with customer_data
  data?: CustomerData
}

export interface CustomerData {
  id:             string
  company_id:     string
  customer_token: string
  name:           string | null
  email:          string | null
  phone:          string | null
  org_number:     string | null
  vat_number:     string | null
  address_line1:  string | null
  address_line2:  string | null
  postal_code:    string | null
  city:           string | null
  country:        string | null
  gdpr_erased_at: string | null
  created_at:     string
  updated_at:     string
}

export interface Supplier {
  id:                 string
  company_id:         string
  name:               string
  org_number:         string | null
  vat_number:         string | null
  country:            string
  address_line1:      string | null
  postal_code:        string | null
  city:               string | null
  email:              string | null
  phone:              string | null
  bankgiro:           string | null
  plusgiro:           string | null
  iban:               string | null
  bic:                string | null
  payment_terms_days: number
  default_account:    string | null
  default_vat_rate:   number | null
  default_rule_id:    string | null
  is_active:          boolean
  external_id:        string | null
  notes:              string | null
  created_at:         string
  updated_at:         string
}

export interface Invoice {
  id:               string
  company_id:       string
  customer_id:      string
  invoice_number:   string
  status:           'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'credited' | 'cancelled' | 'uncollectable'
  invoice_date:     string
  due_date:         string
  delivery_date:    string | null
  currency:         string
  exchange_rate:    number | null
  subtotal:         number
  vat_amount:       number
  total:            number
  paid_amount:      number
  reference:        string | null
  our_reference:    string | null
  your_reference:   string | null
  peppol_id:        string | null
  notes:            string | null
  payment_terms_text: string | null
  bankgiro:         string | null
  entry_id:         string | null
  credit_note_of:   string | null
  pdf_path:         string | null
  sent_at:          string | null
  paid_at:          string | null
  overdue_since:    string | null
  created_by:       string | null
  created_at:       string
  updated_at:       string
  // Relations
  lines?:           InvoiceLine[]
  customer?:        Customer
}

export interface InvoiceLine {
  id:             string
  invoice_id:     string
  line_number:    number
  description:    string
  quantity:       number
  unit:           string | null
  unit_price:     number
  vat_rate:       number
  vat_amount:     number
  line_total:     number
  discount_pct:   number
  account_number: string
  created_at:     string
}

export interface Payment {
  id:             string
  company_id:     string
  payment_type:   PaymentDir
  amount:         number
  currency:       string
  amount_sek:     number | null
  exchange_rate:  number | null
  payment_date:   string
  payment_method: string | null
  reference:      string | null
  status:         PaymentStatus
  bank_tx_id:     string | null
  entry_id:       string | null
  fx_gain_loss:   number
  notes:          string | null
  created_by:     string | null
  created_at:     string
  updated_at:     string
  allocations?:   PaymentAllocation[]
}

export interface PaymentAllocation {
  id:                   string
  payment_id:           string
  invoice_id:           string | null
  supplier_invoice_id:  string | null
  allocated_amount:     number
  created_at:           string
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id:           number   // bigserial
  company_id:   string | null
  bureau_id:    string | null
  user_id:      string | null
  action:       string
  entity_type:  string
  entity_id:    string | null
  before_data:  Record<string, unknown> | null
  after_data:   Record<string, unknown> | null
  metadata:     Record<string, unknown>
  ip_address:   string | null
  user_agent:   string | null
  created_at:   string
}

// ---------------------------------------------------------------------------
// Application-layer DTOs (not DB tables)
// ---------------------------------------------------------------------------

export interface CreateJournalEntryDTO {
  company_id:   string
  entry_date:   string
  description:  string
  source?:      EntrySource
  source_ref?:  string
  lines:        CreateJournalLineDTO[]
}

export interface CreateJournalLineDTO {
  side:           NormalSide
  account_number: string
  amount:         number
  currency?:      string
  description?:   string
  vat_code?:      string
  vat_amount?:    number
  cost_center?:   string
  project_code?:  string
}

export interface PostBatchParams {
  batch_id:     string
  company_id:   string
  approved_by:  string
  entry_date:   string
  description?: string
}

export interface ClassifyTransactionParams {
  transaction_id: string
  company_id:     string
}

export interface ClassificationResult {
  treatment:    TaxTreatment
  vat_rate:     number | null
  vat_amount:   number
  taxable:      number
  jurisdiction: string | null
  scheme:       string | null
  confidence:   number
  reasoning:    string
  classified_by: 'rule' | 'ai'
  rule_id?:     string
}

// ---------------------------------------------------------------------------
// Result types for service layer
// ---------------------------------------------------------------------------

export type Result<T, E = Error> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

export function ok<T, E extends Error = Error>(value: T): Result<T, E> {
  return { ok: true, value }
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error }
}
