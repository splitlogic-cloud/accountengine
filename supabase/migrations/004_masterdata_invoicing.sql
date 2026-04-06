-- =============================================================================
-- AccountEngine — Migration 004: Masterdata, Invoicing & Payments
-- Author: AccountEngine CTO
-- Description: Customer register, supplier register, invoicing, payments,
--              payment allocation (open-item accounting), and reminders.
--              GDPR: personal data is separated into customer_data table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: customer_data (GDPR-separated personal data)
-- Personal data is stored here, not directly on invoices/journal lines.
-- customer_token is the stable reference used throughout the accounting system.
-- On GDPR erasure request: NULL out all personal fields here.
-- Journal lines reference customer_token, not customer name.
-- ---------------------------------------------------------------------------
CREATE TABLE customer_data (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  customer_token  text    NOT NULL,   -- stable opaque token, never changes
  name            text,               -- can be NULLed on GDPR erasure
  email           text,
  phone           text,
  org_number      text,
  vat_number      text,
  address_line1   text,
  address_line2   text,
  postal_code     text,
  city            text,
  country         char(2),
  gdpr_erased_at  timestamptz,        -- timestamp of erasure, keeps token+dates
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, customer_token)
);

CREATE TRIGGER customer_data_updated_at
  BEFORE UPDATE ON customer_data
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_customer_data_company   ON customer_data (company_id);
CREATE INDEX idx_customer_data_token     ON customer_data (customer_token);
-- Partial index for non-erased records
CREATE INDEX idx_customer_data_name_trgm ON customer_data USING gin (name gin_trgm_ops)
  WHERE gdpr_erased_at IS NULL;

-- ---------------------------------------------------------------------------
-- Table: customers
-- Business-level customer record (accounting entity).
-- References customer_data via token for personal info.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  customer_token        text    NOT NULL,   -- links to customer_data
  customer_type         customer_type_enum NOT NULL DEFAULT 'b2c',
  default_currency      char(3) NOT NULL DEFAULT 'SEK',
  default_vat_treatment tax_treatment,     -- pre-classified for speed
  payment_terms_days    int     NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  credit_limit          numeric,
  is_active             bool    NOT NULL DEFAULT true,
  external_id           text,              -- ID in source system (Fortnox, etc.)
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, customer_token)
);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_customers_company_id ON customers (company_id);
CREATE INDEX idx_customers_active     ON customers (company_id, is_active);

-- ---------------------------------------------------------------------------
-- Table: suppliers
-- Supplier register. Includes bank details for payment file generation.
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name                  text    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  org_number            text,
  vat_number            text,
  country               char(2) NOT NULL DEFAULT 'SE',
  address_line1         text,
  postal_code           text,
  city                  text,
  email                 text,
  phone                 text,
  bankgiro              text,
  plusgiro              text,
  iban                  text,
  bic                   text,
  payment_terms_days    int     NOT NULL DEFAULT 30,
  default_account       text,              -- default expense account e.g. '6212'
  default_vat_rate      numeric CHECK (default_vat_rate IS NULL OR default_vat_rate IN (0, 6, 12, 25)),
  default_rule_id       uuid    REFERENCES rules (id) ON DELETE SET NULL,
  is_active             bool    NOT NULL DEFAULT true,
  external_id           text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, org_number)
);

CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_suppliers_company_id  ON suppliers (company_id);
CREATE INDEX idx_suppliers_name_trgm   ON suppliers USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Table: invoices (customer invoices)
-- ---------------------------------------------------------------------------
CREATE TABLE invoices (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid    NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  customer_id       uuid    NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  invoice_number    text    NOT NULL,
  status            text    NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'credited', 'cancelled', 'uncollectable')),
  invoice_date      date    NOT NULL,
  due_date          date    NOT NULL,
  delivery_date     date,               -- for VAT period determination
  currency          char(3) NOT NULL DEFAULT 'SEK',
  exchange_rate     numeric,
  subtotal          numeric NOT NULL DEFAULT 0,  -- ex VAT
  vat_amount        numeric NOT NULL DEFAULT 0,
  total             numeric NOT NULL DEFAULT 0,  -- incl VAT
  paid_amount       numeric NOT NULL DEFAULT 0,
  reference         text,               -- OCR number for bank matching
  our_reference     text,
  your_reference    text,
  peppol_id         text,               -- customer's Peppol ID if e-invoice
  notes             text,
  payment_terms_text text,
  bankgiro          text,               -- our BG for payment
  entry_id          uuid    REFERENCES journal_entries (id) ON DELETE SET NULL,
  credit_note_of    uuid    REFERENCES invoices (id) ON DELETE SET NULL,
  pdf_path          text,               -- Supabase Storage path
  sent_at           timestamptz,
  paid_at           timestamptz,
  overdue_since     date,
  created_by        uuid    REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, invoice_number),
  CONSTRAINT invoice_dates_valid CHECK (due_date >= invoice_date),
  CONSTRAINT invoice_amounts_valid CHECK (
    subtotal >= 0 AND vat_amount >= 0 AND total >= 0 AND paid_amount >= 0
  )
);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_invoices_company_id  ON invoices (company_id);
CREATE INDEX idx_invoices_customer_id ON invoices (customer_id);
CREATE INDEX idx_invoices_status      ON invoices (company_id, status);
CREATE INDEX idx_invoices_due_date    ON invoices (company_id, due_date) WHERE status IN ('sent', 'partial', 'overdue');

-- ---------------------------------------------------------------------------
-- Table: invoice_lines
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_lines (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid    NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_number     int     NOT NULL CHECK (line_number > 0),
  description     text    NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  quantity        numeric NOT NULL DEFAULT 1,
  unit            text    DEFAULT 'st',
  unit_price      numeric NOT NULL,     -- ex VAT
  vat_rate        numeric NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  vat_amount      numeric NOT NULL DEFAULT 0,
  line_total      numeric NOT NULL,     -- ex VAT
  discount_pct    numeric NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  account_number  text    NOT NULL DEFAULT '3010',
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, line_number)
);

CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines (invoice_id);

-- ---------------------------------------------------------------------------
-- Table: supplier_invoices
-- Incoming invoices from suppliers. Includes OCR data when scanned.
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_invoices (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  supplier_id     uuid    REFERENCES suppliers (id) ON DELETE SET NULL,
  status          text    NOT NULL DEFAULT 'pending_ocr'
    CHECK (status IN ('pending_ocr', 'pending_approval', 'approved', 'scheduled', 'paid', 'overdue', 'disputed', 'cancelled')),
  invoice_number  text,               -- supplier's invoice number
  invoice_date    date,
  due_date        date,
  currency        char(3) NOT NULL DEFAULT 'SEK',
  exchange_rate   numeric,
  subtotal        numeric,
  vat_amount      numeric,
  total           numeric,
  paid_amount     numeric NOT NULL DEFAULT 0,
  bankgiro        text,               -- supplier's BG for payment
  plusgiro        text,
  iban            text,
  payment_ref     text,               -- OCR reference for payment
  scheduled_date  date,               -- when scheduled for payment
  ocr_confidence  numeric CHECK (ocr_confidence IS NULL OR ocr_confidence BETWEEN 0 AND 100),
  ocr_raw         jsonb,              -- raw OCR output for audit
  expense_account text,               -- e.g. '6212'
  entry_id        uuid    REFERENCES journal_entries (id) ON DELETE SET NULL,
  document_path   text,               -- Supabase Storage path to PDF
  paid_at         timestamptz,
  created_by      uuid    REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER supplier_invoices_updated_at
  BEFORE UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_si_company_id ON supplier_invoices (company_id, status);
CREATE INDEX idx_si_due_date   ON supplier_invoices (company_id, due_date) WHERE status IN ('approved', 'scheduled');
CREATE INDEX idx_si_supplier   ON supplier_invoices (supplier_id);

-- ---------------------------------------------------------------------------
-- Table: payments
-- Inbound (from customers) or outbound (to suppliers) money movements.
-- A payment may be allocated to one or more invoices.
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid             NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  payment_type    payment_direction NOT NULL,
  amount          numeric          NOT NULL CHECK (amount > 0),
  currency        char(3)          NOT NULL DEFAULT 'SEK',
  amount_sek      numeric,
  exchange_rate   numeric,
  payment_date    date             NOT NULL,
  payment_method  text             CHECK (payment_method IN ('bank', 'bankgiro', 'plusgiro', 'swish', 'card', 'cash', 'iban')),
  reference       text,            -- OCR number or free text
  status          payment_status   NOT NULL DEFAULT 'unmatched',
  bank_tx_id      uuid,            -- FK added after bank_transactions table
  entry_id        uuid             REFERENCES journal_entries (id) ON DELETE SET NULL,
  fx_gain_loss    numeric NOT NULL DEFAULT 0,  -- realised currency gain/loss
  notes           text,
  created_by      uuid             REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz      NOT NULL DEFAULT NOW(),
  updated_at      timestamptz      NOT NULL DEFAULT NOW()
);

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_payments_company_id ON payments (company_id, payment_date DESC);
CREATE INDEX idx_payments_status     ON payments (company_id, status) WHERE status IN ('unmatched', 'partial');
CREATE INDEX idx_payments_reference  ON payments (company_id, reference) WHERE reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: payment_allocations
-- How a payment is distributed across invoices (open-item accounting).
-- One payment can partially pay multiple invoices.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_allocations (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid    NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  invoice_id      uuid    REFERENCES invoices (id) ON DELETE SET NULL,
  supplier_invoice_id uuid REFERENCES supplier_invoices (id) ON DELETE SET NULL,
  allocated_amount numeric NOT NULL CHECK (allocated_amount > 0),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT allocation_target CHECK (
    (invoice_id IS NOT NULL AND supplier_invoice_id IS NULL) OR
    (invoice_id IS NULL AND supplier_invoice_id IS NOT NULL)
  )
);

CREATE INDEX idx_pa_payment_id         ON payment_allocations (payment_id);
CREATE INDEX idx_pa_invoice_id         ON payment_allocations (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_pa_supplier_invoice   ON payment_allocations (supplier_invoice_id) WHERE supplier_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: reminders
-- Automated reminder workflow for overdue customer invoices.
-- reminder_number: 1 = first reminder (no fee), 2 = fee, 3 = pre-collection.
-- ---------------------------------------------------------------------------
CREATE TABLE reminders (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid            NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  invoice_id      uuid            NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  customer_id     uuid            NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  reminder_number int             NOT NULL CHECK (reminder_number BETWEEN 1 AND 3),
  reminder_date   date            NOT NULL,
  due_date        date            NOT NULL,
  amount_due      numeric         NOT NULL CHECK (amount_due > 0),
  fee_amount      numeric         NOT NULL DEFAULT 0,
  interest_amount numeric         NOT NULL DEFAULT 0,
  total_amount    numeric         GENERATED ALWAYS AS (amount_due + fee_amount + interest_amount) STORED,
  status          reminder_status NOT NULL DEFAULT 'draft',
  sent_at         timestamptz,
  sent_via        text            CHECK (sent_via IN ('email', 'peppol', 'post', 'manual')),
  fee_entry_id    uuid            REFERENCES journal_entries (id) ON DELETE SET NULL,
  pdf_path        text,
  created_at      timestamptz     NOT NULL DEFAULT NOW(),
  updated_at      timestamptz     NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, reminder_number)
);

CREATE TRIGGER reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_reminders_company_id ON reminders (company_id, status);
CREATE INDEX idx_reminders_invoice_id ON reminders (invoice_id);

-- ---------------------------------------------------------------------------
-- Table: bank_accounts
-- Physical bank accounts linked to GL accounts.
-- ---------------------------------------------------------------------------
CREATE TABLE bank_accounts (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  account_number  text    NOT NULL,
  iban            text,
  bic             text,
  bank_name       text,
  currency        char(3) NOT NULL DEFAULT 'SEK',
  gl_account      text    NOT NULL,   -- corresponding GL account e.g. '1930'
  is_active       bool    NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, account_number)
);

CREATE TRIGGER bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: bank_transactions
-- Imported from bank files (camt.053, SEB CSV, etc.)
-- Matched against journal_entries for bank reconciliation.
-- ---------------------------------------------------------------------------
CREATE TABLE bank_transactions (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid    NOT NULL REFERENCES bank_accounts (id) ON DELETE CASCADE,
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  amount          numeric NOT NULL,   -- positive = credit (money in), negative = debit (money out)
  currency        char(3) NOT NULL DEFAULT 'SEK',
  value_date      date    NOT NULL,
  booking_date    date,
  description     text,
  reference       text,
  counterpart     text,
  counterpart_iban text,
  match_status    text    NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'partial', 'excluded')),
  matched_entry_id uuid   REFERENCES journal_entries (id) ON DELETE SET NULL,
  matched_payment_id uuid REFERENCES payments (id) ON DELETE SET NULL,
  fingerprint     text    NOT NULL,
  raw_data        jsonb,
  import_id       uuid    REFERENCES imports (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (bank_account_id, fingerprint)
);

CREATE INDEX idx_bank_tx_bank_account  ON bank_transactions (bank_account_id, value_date DESC);
CREATE INDEX idx_bank_tx_company_id    ON bank_transactions (company_id);
CREATE INDEX idx_bank_tx_match_status  ON bank_transactions (company_id, match_status) WHERE match_status = 'unmatched';

-- Add FK from payments to bank_transactions (now that table exists)
ALTER TABLE payments
  ADD CONSTRAINT fk_payments_bank_tx
  FOREIGN KEY (bank_tx_id) REFERENCES bank_transactions (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Table: filings
-- Tracks all regulatory filings: VAT, OSS, AGI, Annual report.
-- ---------------------------------------------------------------------------
CREATE TABLE filings (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid         NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  filing_type     filing_type  NOT NULL,
  fiscal_year     int          NOT NULL,
  period_month    int          CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  period_quarter  int          CHECK (period_quarter IS NULL OR period_quarter BETWEEN 1 AND 4),
  status          filing_status NOT NULL DEFAULT 'draft',
  due_date        date,
  data            jsonb        NOT NULL DEFAULT '{}',  -- computed filing data
  errors          jsonb,                               -- validation errors
  submitted_at    timestamptz,
  submitted_by    uuid         REFERENCES auth.users (id) ON DELETE SET NULL,
  accepted_at     timestamptz,
  rejected_reason text,
  created_at      timestamptz  NOT NULL DEFAULT NOW(),
  updated_at      timestamptz  NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, filing_type, fiscal_year, period_month, period_quarter)
);

CREATE TRIGGER filings_updated_at
  BEFORE UPDATE ON filings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_filings_company_id ON filings (company_id, status);
CREATE INDEX idx_filings_due_date   ON filings (company_id, due_date) WHERE status IN ('draft', 'validated');

-- ---------------------------------------------------------------------------
-- Table: documents
-- File attachments for journal entries, invoices, supplier invoices.
-- Files stored in Supabase Storage with RLS-protected buckets.
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  file_name       text    NOT NULL,
  file_type       text    NOT NULL CHECK (file_type IN ('pdf', 'xml', 'csv', 'image', 'sie4', 'camt053', 'other')),
  mime_type       text    NOT NULL,
  storage_path    text    NOT NULL,   -- Supabase Storage path
  file_size_bytes int,
  -- Polymorphic associations
  entry_id            uuid REFERENCES journal_entries (id) ON DELETE SET NULL,
  invoice_id          uuid REFERENCES invoices (id) ON DELETE SET NULL,
  supplier_invoice_id uuid REFERENCES supplier_invoices (id) ON DELETE SET NULL,
  import_id           uuid REFERENCES imports (id) ON DELETE SET NULL,
  -- OCR
  ocr_processed   bool    NOT NULL DEFAULT false,
  ocr_text        text,
  uploaded_by     uuid    REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_company_id ON documents (company_id);
CREATE INDEX idx_documents_entry_id   ON documents (entry_id) WHERE entry_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE customer_data       ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE filings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents           ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Generic company-scoped RLS
-- Only tables that have a direct company_id column go here.
-- Tables without company_id (invoice_lines, payment_allocations) get
-- join-based policies below.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_data', 'customers', 'suppliers',
    'invoices', 'supplier_invoices',
    'payments', 'reminders', 'bank_accounts',
    'bank_transactions', 'filings', 'documents'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT
         USING (company_id IN (SELECT accessible_company_ids()));
       CREATE POLICY %I_insert ON %I FOR INSERT
         WITH CHECK (company_id IN (SELECT accessible_company_ids()));
       CREATE POLICY %I_update ON %I FOR UPDATE
         USING (company_id IN (SELECT accessible_company_ids()));',
      t, t, t, t, t, t
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- invoice_lines: no company_id — join via invoices
-- ---------------------------------------------------------------------------
CREATE POLICY il_select ON invoice_lines FOR SELECT
  USING (invoice_id IN (
    SELECT id FROM invoices WHERE company_id IN (SELECT accessible_company_ids())
  ));

CREATE POLICY il_insert ON invoice_lines FOR INSERT
  WITH CHECK (invoice_id IN (
    SELECT id FROM invoices WHERE company_id IN (SELECT accessible_company_ids())
  ));

CREATE POLICY il_update ON invoice_lines FOR UPDATE
  USING (invoice_id IN (
    SELECT id FROM invoices WHERE company_id IN (SELECT accessible_company_ids())
  ));

CREATE POLICY il_delete ON invoice_lines FOR DELETE
  USING (invoice_id IN (
    SELECT id FROM invoices WHERE company_id IN (SELECT accessible_company_ids())
  ));

-- ---------------------------------------------------------------------------
-- payment_allocations: no company_id — join via payments
-- ---------------------------------------------------------------------------
CREATE POLICY pa_select ON payment_allocations FOR SELECT
  USING (payment_id IN (
    SELECT id FROM payments WHERE company_id IN (SELECT accessible_company_ids())
  ));

CREATE POLICY pa_insert ON payment_allocations FOR INSERT
  WITH CHECK (payment_id IN (
    SELECT id FROM payments WHERE company_id IN (SELECT accessible_company_ids())
  ));

CREATE POLICY pa_update ON payment_allocations FOR UPDATE
  USING (payment_id IN (
    SELECT id FROM payments WHERE company_id IN (SELECT accessible_company_ids())
  ));
